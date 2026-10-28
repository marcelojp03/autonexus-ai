---
status: delivered
updated: 2026-10-27
source: work/marcelo
---
## Report

**What was built** — CU02 de punta a punta sobre Empleados, el BFF y `mf-employees`: catálogo cerrado de seis permisos, roles y asignaciones persistidos en el esquema propio de Empleados (migración `1793196000000`) y materializados en Keycloak como realm roles, autorización por permiso en REST y GraphQL, sección `/employees/security` con matriz de permisos, asignación/retiro por empleado y reintento de sincronización. Reglas de seguridad: sin escalamiento, nunca sin administrador (con lock y validación dentro de la transacción), empleado activo con identidad para asignar, idempotencia, versionado y auditoría append-only. Los cinco roles iniciales conservan la autoridad previa: CU03 sigue administrador-only y CU04 no gana alcance.

**Verification** — Empleados 89 pruebas y build; API real 13 etapas (permisos efectivos, materialización en el IdP, dos reglas de último administrador, escalamiento con token limitado, revocación efectiva sobre un token ya emitido, retry, auditoría); BFF 16 unitarias + 13 HTTP y BFF real 7 etapas por GraphQL; navegador real 9 etapas; regresión CU03 11, CU04 8 y CU01 API 10, todas exit 0. El smoke CU01 detectó que añadir `permissions` a `/technical/session` rompía su contrato y se revirtió.

**Review** — Registro en `docs/context/STATUS.md`: revisión directa declarada como tal si el revisor independiente no arranca.

# CU02 — Administrar roles y permisos

## [S1] Problem

Hoy la autorización depende de cinco nombres de rol fijados en el código (`administrador`, `recepcionista`, `mecanico`, `jefe_taller`, `responsable_financiero`) y de la lista de roles del token. No existe forma de que el administrador consulte, cree o modifique roles, configure sus permisos ni asigne o retire roles a empleados. Consecuencias concretas:

- Los permisos no son un catálogo explícito: están dispersos en `ROOT_POLICY` del BFF y en `@RequireRoles` de Empleados, y no se pueden auditar ni comunicar.
- Un rol nuevo creado en Keycloak no serviría de nada: los guards seguirían aceptando solo los cinco nombres conocidos.
- No hay auditoría de cambios de permisos ni protección contra quedarse sin administrador habilitado.
- El usuario necesita saber cuándo se aplican los cambios, porque los JWT ya emitidos conservan sus roles hasta exp+5 s.

## [S2] Design

### [S2.1] Catálogo explícito de permisos

`contracts/auth/permissions.ts` (tipos puros, sin lógica) publica el catálogo cerrado. Cada permiso se deriva de un CU entregado; no se inventan módulos:

| Permiso | Módulo | Cubre |
| --- | --- | --- |
| `employees:read` | Empleados | Listado, detalle e historial (CU03) |
| `employees:write` | Empleados | Alta, edición, desactivación y reintento de acceso (CU03) |
| `schedules:read` | Horarios | Empleados planificables, horario y disponibilidad (CU04) |
| `schedules:write` | Horarios | Turnos, descansos y ausencias (CU04) |
| `security:read` | Seguridad | Catálogo, roles, asignaciones e historial de seguridad (CU02) |
| `security:write` | Seguridad | Crear/modificar roles, asignar/retirar y reintentar sincronización (CU02) |

Reglas del catálogo: identificador `modulo:operacion` en minúsculas ASCII; conjunto cerrado; cualquier permiso desconocido se rechaza con `VALIDATION_ERROR`. El catálogo se publica por REST (`GET /security/permissions`) y por GraphQL (`securityCatalog`), de modo que la UI y el BFF lo consumen en vez de duplicarlo.

### [S2.2] Rol = nombre + permisos, persistido en Empleados

Un rol de negocio es `{name, description, permissions[], system, version, syncStatus, syncErrorCode}`. Roles iniciales sembrados por migración con `system=true`, no renombrables y sin borrado:

| Rol | Permisos | Motivo |
| --- | --- | --- |
| `administrador` | los seis | Reproduce exactamente la autoridad actual |
| `jefe_taller` | `schedules:read`, `schedules:write` | CU04 planificación |
| `recepcionista` | — | Sin gestión en los módulos entregados |
| `mecanico` | — | Idem |
| `responsable_financiero` | — | Finanzas no está implementado |

Con esto **CU03 sigue siendo solo administrador** y CU04 sigue admitiendo administrador y jefe de taller: no se amplía ningún permiso existente. Un rol nuevo se crea con al menos un permiso del catálogo y nombre `^[a-z][a-z0-9_]{2,63}$` que no colisione con otro rol (incluidos los iniciales).

**Separación explícita**: cargo laboral (`jobTitle`), especialidad (`specialties`), rol de seguridad (esta entrega) y permiso (catálogo) son conceptos distintos y no se derivan entre sí. CU02 no toca `jobTitle` ni `specialties`.

### [S2.3] Resolución de permisos en servidor

Los permisos efectivos de una petición se calculan así:

1. Se validan el token y sus roles con el guard existente (RS256, issuer, audiencia, exp, `typ=Bearer`, tolerancia 5 s) → 401 si falla.
2. Para cada rol del token **reconocido** por el catálogo persistido se suman sus permisos.
3. Si el `sub` del token está vinculado a un empleado (`access.subject`), solo cuentan las asignaciones **vigentes** de ese subject; un rol que el token todavía lleva pero ya fue retirado no aporta permisos.
4. Un rol del token que no existe en el catálogo no aporta nada (fallo cerrado). Los cinco roles iniciales existen siempre por migración, así que las cuentas de infraestructura y de prueba conservan su comportamiento actual sin asignaciones.

El punto 3 es lo que hace que retirar un rol tenga efecto en la siguiente petición, sin prometer revocación del JWT: el token solo delimita qué roles puede reclamar el portador.

### [S2.4] Política por operación

- Empleados REST: `@RequirePermissions('employees:read'|'employees:write'|'schedules:read'|'schedules:write'|'security:read'|'security:write')`. `/technical/session` sigue exigiendo algún rol reconocido; `/technical/admin` pasa a exigir `security:write`.
- BFF GraphQL: `FIELD_PERMISSION` reemplaza a `ROOT_POLICY` (nombre de rol). El BFF resuelve los permisos del actor con `GET /security/permissions` reenviando el token del usuario, con caché de 30 s por `sub`+roles. Si no puede resolver (Empleados caído) falla cerrado con `SERVICE_UNAVAILABLE`: no convierte una duda en autorización.
- No se amplía nada más: las operaciones de empleados siguen exigiendo `employees:write`, que solo tiene `administrador`.

### [S2.5] Reglas de seguridad

- **Sin escalamiento**: el actor no puede crear ni modificar un rol con permisos que él no posee → `PERMISSION_ESCALATION` (409). Tampoco puede asignar un rol (la asignación exige `security:write` y el rol asignado se valida contra el catálogo).
- **Nunca sin administrador**: dentro de una transacción con `pg_advisory_xact_lock` sobre la clave `security:administrators`, se cuentan las asignaciones vigentes a empleados activos cuyos roles otorgan `security:write`.
  - Retirar la última → `LAST_ADMINISTRATOR` (409).
  - Modificar un rol quitándole `security:write` cuando era el único que lo otorgaba a un empleado activo → `LAST_ADMINISTRATOR` (409).
  - La comprobación ocurre dentro de la transacción, así que dos peticiones concurrentes no pueden dejar el sistema sin administrador.
- **Asignación**: el empleado debe existir (`EMPLOYEE_NOT_FOUND`), estar activo (`EMPLOYEE_INACTIVE`) y tener identidad (``access.subject`` no nulo) para poder materializar el rol en el IdP (`EMPLOYEE_WITHOUT_IDENTITY`). Una asignación duplicada vigente → `ROLE_ALREADY_ASSIGNED`; retirar algo ya retirado → `ASSIGNMENT_NOT_ACTIVE`.
- **Idempotencia**: `operationId` UUID obligatorio en toda mutación, con huella `actor+acción+destino+contenido+expectedVersion`; replay devuelve el resultado guardado con `replayed:true`; contenido distinto → `IDEMPOTENCY_CONFLICT`. `expectedVersion` obligatorio en `PUT` de rol, revocación y reintentos.
- **Auditoría**: `security_history` append-only con `{id, entity, entityId, action, actorSubject, occurredAt, version, snapshot}` para `role-created`, `role-updated`, `role-synced`, `role-assigned`, `role-revoked`. Sin secretos, tokens ni cuerpos del IdP.
- **Versión**: crear rol ⇒ `version=1`; toda modificación efectiva incrementa una vez; reintentar sincronización no incrementa versión.

### [S2.6] Keycloak: materialización y fallo proporcional

- El rol de negocio se materializa como **realm role** homónimo con el atributo informativo `permissions` (JSON). Crear/actualizar rol ⇒ `POST`/`PUT /admin/realms/autonexus/roles`.
- Asignar ⇒ añadir el realm role al usuario identificado por el atributo managed `employeeId` (ownership verificado, igual que CU03); retirar ⇒ `DELETE` del role mapping.
- Estado de sincronización por rol y por asignación: `synced | pending | failed` con `errorCode` (`IDP_UNAVAILABLE`, `IDP_TIMEOUT`, `IDP_FORBIDDEN`, `IDP_RESPONSE_INVALID`, `ROLE_NAME_CONFLICT`). Un fallo del IdP **no revierte** el guardado local: queda `failed` y `POST .../retry-sync` reconcilia. No se presenta PostgreSQL+Keycloak como transacción atómica.
- La identidad técnica `autonexus-employees-admin` necesita además `view-realm` (leer roles) y `manage-realm` (crear/actualizar roles) junto al `manage-users` ya existente. Es el mínimo disponible; `manage-realm` permite más escrituras de configuración del realm, así que el adaptador solo llama a los endpoints de roles y nunca a otros, y lo documenta. El navegador no recibe ninguna credencial administrativa.

### [S2.7] Ventana de vigencia (se muestra al usuario)

- Cambiar los permisos de un rol o retirar una asignación: efecto en la **siguiente petición** a Empleados; el BFF puede tardar hasta **30 s** por su caché.
- Un JWT ya emitido conserva la lista de roles hasta `exp+5 s` (60 s + 5 s). Como los permisos se resuelven contra el catálogo y las asignaciones persistidas, un rol retirado deja de aportar permisos aunque el token lo mencione; no se promete revocación del token en sí ni de sesiones abiertas.
- La UI muestra estas dos frases junto a la matriz de permisos.

### [S2.8] Contrato CU15

`contracts/rest/staffing.md` aclara que la consulta de disponibilidad es **informativa**: la futura operación de reserva/confirmación (CU15) debe revalidar y escribir atómicamente en Empleados, controlando reservas y asignaciones concurrentes contra el turno y las ausencias vigentes. CU02 no implementa la Saga ni la reserva.

### [S2.9] Contratos

Ver `contracts/rest/security.openapi.yaml`, `contracts/graphql/security.graphql`, `contracts/auth/permissions.md`.

## [S3] Verification

- Unitarias de dominio/casos de uso: catálogo cerrado, validación de rol, escalamiento, último administrador, transiciones de versión, idempotencia.
- API real (`scripts/cu02/verify-security-real.mjs`): permisos efectivos, crear rol con sincronización real en Keycloak, asignar a empleado con identidad, comprobar permisos efectivos con un token del rol nuevo, denegación de un rol sin permiso, escalamiento, último administrador (retiro y reducción de permisos), retiro de rol, auditoría e idempotencia.
- BFF/GraphQL real: catálogo, roles, mutaciones, `403` para jefe de taller y regresión de las operaciones CU03/CU04.
- Navegador real (`scripts/cu02/verify-security-web.mjs`): sección Seguridad, crear rol, asignarlo, ver permisos, retirarlo.
- Regresión focalizada CU01 (API), CU03 y CU04 (navegador).

## [S4] Limits

- No hay borrado de roles ni renombrado: un rol `system` no se renombra y ningún rol se elimina, para no dejar roles huérfanos en el IdP.
- No se gestionan credenciales de usuario ni contraseñas: un empleado con identidad creada pero sin credencial habilitada no puede iniciar sesión. CU02 asigna roles, no habilita acceso.
- Los permisos por registro (p. ej. "solo su propia ficha") no se implementan: CU02 gobierna operaciones por módulo.
- `Operaciones` (Spring) conserva su política técnica por nombre de rol; migrarla a permisos requiere el mismo catálogo en ese servicio y queda fuera de esta entrega, declarado como límite.
