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
| receptions:read | Recepción | read | Consultar recepciones (CU11) |
| receptions:write | Recepción | write | Recepcionar e inspeccionar con textos (CU11) |
| orders:read | Órdenes | read | Consultar órdenes (CU12) |
| orders:write | Órdenes | write | Crear órdenes (CU12) |
| quotes:read | Cotizaciones | read | Consultar cotizaciones/versiones (CU13) |
| quotes:write | Cotizaciones | write | Elaborar y revisar cotizaciones (CU13) |
| quotes:decide | Cotizaciones | decide | Registrar la decisión del cliente (CU14) |
| confirmations:read | Confirmaciones | read | Progreso, resultados y proyección de mecánicos (CU15) |
| confirmations:write | Confirmaciones | write | Iniciar y solicitar recuperación de la Saga (CU15) |
| agenda:read:self | Agenda propia | read:self | Consultar listado/detalle del empleado vigente autenticado (CU05 online) |
| agenda:read:team | Agenda del equipo | read:team | Consulta explícita de equipo y selector laboral mínimo (CU05 online) |

Reglas: identificador modulo:operacion y, para CU05, modulo:operacion:alcance, en minúsculas ASCII; conjunto cerrado, sin herencia por prefijo. Un permiso desconocido produce VALIDATION_ERROR. El catálogo se publica por GET /security/permissions y securityCatalog. CU05 añade solo dos permisos de lectura acotada, no acceso general a órdenes, clientes, documentos o cotizaciones.

## Roles iniciales

| Rol | Permisos | Motivo |
| --- | --- | --- |
| `administrador` | los veinticinco del catálogo CU05 | Autoridad completa, con vínculo laboral activo adicional obligatorio para CU05 |
| `jefe_taller` | schedules:read/write, customers:read, vehicles:read, catalog:read/write, appointments:read/write, receptions:read, orders:read/write, quotes:read/decide, confirmations:read/write, agenda:read:self/team | Planificación, catálogo, órdenes, decisión financiera y confirmación CU15 |
| `recepcionista` | customers:read/write, vehicles:read/write, catalog:read, appointments:read/write, receptions:read/write, orders:read/write, quotes:read/decide | Recepción, órdenes y decisión del cliente; no elabora cotizaciones |
| `mecanico` | receptions:read/write, agenda:read:self | Recepción CU11 y agenda propia CU05; sin CRUD general ni agenda del equipo |
| `responsable_financiero` | orders:read, quotes:read/write/decide | Cotizaciones y decisiones CU13/CU14; aprobar no confirma el servicio |

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
- REST de Operaciones: customers:*, vehicles:*, catalog:*, appointments:*, receptions:*, orders:*; Finanzas usa quotes:read/write/decide. /technical/session y /technical/admin conservan la política y el cuerpo de CU01.
- BFF GraphQL: el permiso declarado por campo; `securityCatalog` no exige permiso porque solo devuelve el catálogo y los permisos del propio portador.

## Ampliación CU15 implementada

confirmations:read (progreso/resultados/proyección de mecánicos CU15) y confirmations:write (inicio/reintento) forman parte del catálogo ejecutable de 23 permisos. La migración 1793455200000 los añade a administrador y jefe_taller sin borrar personalizaciones previas. Un rol nuevo puede recibirlos como los demás permisos, sin guards por nombre de rol.

La identidad técnica autonexus-cu15-coordinator es un cliente separado client_credentials con scopes cerrados cu15.staffing.read/reserve/confirm/release y cu15.finance.read/authorize/cancel. No son permisos humanos asignables mediante CU02, no van en clientes públicos y no conceden CRUD de empleados, aprobación de cotizaciones ni realm-management. Los handlers internos comprueban azp/cliente, audiencia y scope además de firma/exp/issuer; no aceptan JWT del navegador por tener confirmations:write.

El campo aprobado mechanicEnabled describe habilitación laboral en Empleados, no un permiso/rol Keycloak; no se concede automáticamente por cargo o por el rol de acceso mecanico. Detalle y aprobación registrados en docs/compose/spec/cu15-confirmation-saga.md y contracts/rest/saga.md.

## Garantías vigentes CU02

- **Sin escalamiento**: un actor no puede crear ni modificar un rol con permisos que no posee, ni asignar un rol cuyos permisos no tenga (`PERMISSION_ESCALATION`, 409).
- **Nunca sin administrador**: con `pg_advisory_xact_lock` sobre `security:administrators`, se cuentan dentro de la misma transacción las asignaciones vigentes a empleados activos con identidad resoluble cuyos roles otorgan `security:write`. Retirar la última o reducir el último rol que lo otorga responde `LAST_ADMINISTRATOR` (409). Dos peticiones concurrentes no pueden dejar la plataforma sin administrador; la contención de locks responde `409 CONCURRENT_OPERATION`.
- **Idempotencia**: `operationId` obligatorio con huella actor+acción+destino+contenido+versión; replay sin efectos; contenido distinto `IDEMPOTENCY_CONFLICT`.
- **Auditoría**: `security_history` solo se inserta: no existe endpoint de modificación ni de borrado y el servicio no ejecuta UPDATE/DELETE sobre ella. Sin tokens, secretos ni cuerpos del IdP. La inmutabilidad se garantiza en la aplicación.

## Ventana de vigencia

- Cambio de permisos o retiro de asignación: efecto en la siguiente petición a Empleados; en Operaciones y en el BFF hasta 30 s por su caché. Ese caché también recuerda un vacío: si Empleados no responde, la denegación se mantiene hasta 30 s aunque el servicio vuelva antes.
- Un JWT ya emitido conserva su lista de roles hasta `exp+5 s` (60 s + 5 s). Como los permisos se resuelven contra el catálogo y las asignaciones persistidas, un rol retirado deja de otorgar permisos en la siguiente petición, pero **no** se revocan tokens ni sesiones abiertas.
- Un empleado con identidad creada y sin credencial habilitada no puede iniciar sesión: CU02 asigna roles, no habilita acceso.

## CU05 online — vínculo obligatorio y alcance por registro

Contrato aprobado: [agenda REST](../rest/agenda.md) y [agenda GraphQL](../graphql/agenda.graphql). La ampliación ejecutable/roles requiere migración propietaria CU05; su publicación documental no acredita despliegue.

El subject debe resolver un empleado activo y su vínculo actual; las asignaciones de seguridad CU05 se contrastan bajo esa identidad. No se usa la excepción CU02 de cuentas no vinculadas, ni siquiera para administrador/jefe. Empleados revalida por petición; caches de BFF/guard general nunca autorizan por encima de ese contexto. Sin vínculo/permiso/actividad devuelve403 seguro, no vacío.

Propia no admite employeeId del navegador. Equipo exige su permiso y trata employeeId solo como filtro. Lista/detalle se autorizan independientemente; ID ajeno/inexistente404 indistinguible. DTO mínimo, sin datos administrativos/financieros; solo Oconfirmed+Sagaconfirmed y asignación Eactualcorrespondiente. Roles personalizados funcionan por estos permisos cerrados. No se cambian las políticas de otros CU.
