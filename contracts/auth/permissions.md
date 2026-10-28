# Catálogo de permisos y autorización por operación

Contrato aprobado en `docs/compose/spec/cu02-security.md` y ampliado en `docs/compose/spec/operations-base.md`. Sustituye, para las operaciones empresariales, la autorización por nombre de rol fijo por autorización por **permiso** resuelta en el servidor. Los cinco roles iniciales conservan la autoridad que tenían en cada entrega.

## Catálogo cerrado

| Permiso | Módulo | Operación | Cubre |
| --- | --- | --- | --- |
| `employees:read` | Empleados | read | Listado, ficha e historial (CU03) |
| `employees:write` | Empleados | write | Alta, edición, desactivación y reintento de acceso (CU03) |
| `schedules:read` | Horarios | read | Empleados planificables, horario y disponibilidad (CU04) |
| `schedules:write` | Horarios | write | Turnos, descansos y ausencias (CU04) |
| `security:read` | Seguridad | read | Catálogo, roles, asignaciones e historial de seguridad (CU02) |
| `security:write` | Seguridad | write | Crear y modificar roles, asignar, retirar y reintentar sincronización (CU02) |
| `customers:read` | Clientes | read | Consultar clientes del taller (CU06) |
| `customers:write` | Clientes | write | Registrar, actualizar y desactivar clientes (CU06) |
| `vehicles:read` | Vehículos | read | Consultar vehículos y su propietario (CU07) |
| `vehicles:write` | Vehículos | write | Registrar, actualizar y desactivar vehículos (CU07) |
| `catalog:read` | Catálogo | read | Consultar el catálogo de servicios (CU09) |
| `catalog:write` | Catálogo | write | Crear, actualizar y desactivar servicios (CU09) |
| `appointments:read` | Citas | read | Consultar citas y la agenda del taller (CU10) |
| `appointments:write` | Citas | write | Registrar, reprogramar y cancelar citas (CU10) |

Reglas: identificador `modulo:operacion` en minúsculas ASCII; conjunto cerrado; un permiso desconocido produce `VALIDATION_ERROR`; el catálogo se publica por `GET /security/permissions` y por `securityCatalog` en GraphQL, de modo que Empleados, Operaciones y el BFF lo consumen en vez de duplicarlo. CU05 añadirá su permiso de agenda cuando existan órdenes reales; no se crean permisos para módulos sin caso de uso entregado.

## Roles iniciales

| Rol | Permisos | Motivo |
| --- | --- | --- |
| `administrador` | los catorce | Autoridad completa de la plataforma |
| `jefe_taller` | `schedules:read/write`, `customers:read`, `vehicles:read`, `catalog:read/write`, `appointments:read/write` | Planificación y catálogo (CU04 y CU09), lectura operativa y agenda (CU10) |
| `recepcionista` | `customers:read/write`, `vehicles:read/write`, `catalog:read`, `appointments:read/write` | Recepción de clientes, vehículos y citas (CU06, CU07, CU10) |
| `mecanico` | — | Sin operaciones de gestión entregadas |
| `responsable_financiero` | — | Finanzas no implementado |

Los roles iniciales son `system=true`: no se renombran y no se borran. Sus permisos sí pueden editarse, con las restricciones de último administrador. Un rol nuevo requiere nombre `^[a-z][a-z0-9_]{2,63}$`, distinto de cualquier otro, y al menos un permiso del catálogo.

**Cargo laboral, especialidad, rol y permiso son conceptos distintos.** `jobTitle` y `specialties` describen el puesto de trabajo y nunca conceden acceso.

## Resolución en servidor

1. Se valida el token (RS256, issuer, audiencia propia del servicio, `exp`, `sub`, `typ=Bearer`, tolerancia 5 s). Sin token válido: `401`.
2. Se toman los roles de realm del token y se conservan únicamente los que existen en el catálogo persistido.
3. Si el `sub` está vinculado a un empleado, solo cuentan las asignaciones **vigentes** de ese subject a empleados activos, con la identidad actual del empleado.
4. Los permisos efectivos son la unión de los permisos de esos roles. Sin permiso suficiente: `403`.
5. Un rol del token que no existe en el catálogo no aporta nada: falla cerrado. Las cuentas de infraestructura y de prueba sin empleado vinculado solo obtienen los roles iniciales, nunca un rol creado desde CU02.

El paso 3 es lo que hace que retirar una asignación tenga efecto en la siguiente petición, sin prometer revocación del JWT: el token delimita qué roles puede reclamar el portador.

## Quién resuelve

- **Empleados** (MS02): es el propietario del catálogo y de las asignaciones; resuelve localmente contra su base.
- **Operaciones** (MS01): valida el token y pide los permisos a `GET /security/permissions` de Empleados con el token del usuario, con caché de 30 s y timeout de 2 s. No consulta bases ajenas. Cada endpoint exige su permiso; sin poder resolver, deniega.
- **BFF**: cada campo raíz declara el permiso que exige y resuelve igual, con caché de 30 s y fallo cerrado (`503`). El BFF no decide por nombre de rol ni oculta botones como única defensa.

## Política por operación

- REST de Empleados: `employees:*`, `schedules:*`, `security:*`.
- REST de Operaciones: `customers:*`, `vehicles:*`, `catalog:*`, `appointments:*`. `/technical/session` y `/technical/admin` conservan la política y el cuerpo de CU01 (rol reconocido y rol `administrador`).
- BFF GraphQL: el permiso declarado por campo; `securityCatalog` no exige permiso porque solo devuelve el catálogo y los permisos del propio portador.

## Garantías

- **Sin escalamiento**: un actor no puede crear ni modificar un rol con permisos que no posee, ni asignar un rol cuyos permisos no tenga (`PERMISSION_ESCALATION`, 409).
- **Nunca sin administrador**: con `pg_advisory_xact_lock` sobre `security:administrators`, se cuentan dentro de la misma transacción las asignaciones vigentes a empleados activos con identidad resoluble cuyos roles otorgan `security:write`. Retirar la última o reducir el último rol que lo otorga responde `LAST_ADMINISTRATOR` (409). Dos peticiones concurrentes no pueden dejar la plataforma sin administrador; la contención de locks responde `409 CONCURRENT_OPERATION`.
- **Idempotencia**: `operationId` obligatorio con huella actor+acción+destino+contenido+versión; replay sin efectos; contenido distinto `IDEMPOTENCY_CONFLICT`.
- **Auditoría**: `security_history` solo se inserta: no existe endpoint de modificación ni de borrado y el servicio no ejecuta UPDATE/DELETE sobre ella. Sin tokens, secretos ni cuerpos del IdP. La inmutabilidad se garantiza en la aplicación.

## Ventana de vigencia

- Cambio de permisos o retiro de asignación: efecto en la siguiente petición a Empleados; en Operaciones y en el BFF hasta 30 s por su caché.
- Un JWT ya emitido conserva su lista de roles hasta `exp+5 s` (60 s + 5 s). Como los permisos se resuelven contra el catálogo y las asignaciones persistidas, un rol retirado deja de otorgar permisos en la siguiente petición, pero **no** se revocan tokens ni sesiones abiertas.
- Un empleado con identidad creada y sin credencial habilitada no puede iniciar sesión: CU02 asigna roles, no habilita acceso.
