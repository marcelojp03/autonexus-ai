# 012 — CU02: roles y permisos por operación

Fecha: 2026-10-27. Diseño aprobado por Marcelo mediante compose-next en `docs/compose/spec/cu02-security.md`, implementado y verificado en `work/marcelo`. No implica despliegue productivo.

## Catálogo cerrado en lugar de nombres de rol

La autorización previa se apoyaba en cinco nombres de rol fijados en el código. Un rol nuevo creado en Keycloak no habría servido de nada. Se adopta un **catálogo cerrado de seis permisos** (`employees:read|write`, `schedules:read|write`, `security:read|write`), cada uno respaldado por un CU entregado, publicado por REST y GraphQL para que ningún consumidor lo duplique. `jobTitle` y `specialties` siguen siendo datos del puesto y nunca conceden acceso.

Los cinco roles iniciales se siembran como `system=true` con exactamente los permisos que reproducen el comportamiento vigente: `administrador` todos, `jefe_taller` horarios, los otros tres ninguno. Así CU03 sigue siendo administrador-only y CU04 no gana ni pierde autoridad.

## Resolución: token ∩ catálogo ∩ asignaciones

Los roles del token son la entrada, no la autoridad final. Si el `sub` está vinculado a un empleado, solo cuentan las asignaciones vigentes de ese subject a empleados activos; un rol retirado deja de otorgar permisos en la siguiente petición aunque el JWT lo mencione. Los roles del token que no existen en el catálogo no aportan nada (falla cerrado). Las cuentas de infraestructura y de prueba sin vínculo de empleado conservan la resolución por rol: CU02 gobierna empleados, no identidades técnicas.

Consecuencia deliberada: **no se promete revocación de tokens**, solo que un rol retirado no concede permisos. Un cambio de permisos aplica en la siguiente petición a Empleados y hasta 30 s después en el BFF por su caché. La UI muestra ambas frases.

## Un solo camino de escritura

El catálogo y las asignaciones viven en el esquema propio de Empleados (`security_roles`, `security_role_assignments`, `security_history`, `security_operations`). Keycloak se materializa después del commit local: realm role homónimo con atributo informativo `permissions` y role mapping al usuario verificado por el atributo `employeeId`. Un fallo del IdP deja `failed` con código seguro y `retry-sync` reconcilia; no se presenta PostgreSQL+Keycloak como transacción atómica.

La identidad técnica `autonexus-employees-admin` suma `view-realm` y `manage-realm` (crear/actualizar roles) a `manage-users`. Es el mínimo disponible; `manage-realm` habilita más escrituras de configuración del realm, así que el adaptador solo llama a endpoints de roles y nunca a otros, y el límite queda documentado. El navegador no recibe credenciales administrativas.

## Invariantes de seguridad

- **Sin escalamiento**: no se pueden crear ni modificar roles con permisos que el actor no posee (`PERMISSION_ESCALATION`).
- **Nunca sin administrador**: dentro de una transacción con `pg_advisory_xact_lock('security:administrators')` se cuentan las asignaciones vigentes a empleados activos cuyos roles otorgan `security:write`. Retirar la última asignación o reducir el último rol que lo otorga responde `LAST_ADMINISTRATOR`. Dos peticiones concurrentes no pueden dejar la plataforma sin administrador.
- Idempotencia `operationId` + `expectedVersion`, auditoría append-only con actor y versión. Sin borrado ni renombrado de roles para no dejar roles huérfanos en el IdP.

## Verificación

API real 13 etapas (permisos efectivos, rol materializado en el IdP, asignación con identidad, último administrador en sus dos reglas, escalamiento con token limitado, unión de asignaciones, revocación efectiva sobre un token ya emitido, retry, auditoría, inactividad). BFF real 7 etapas por GraphQL. Navegador real 9 etapas (crear, asignar, retirar, auditoría, denegación del jefe, consola limpia). Regresión CU03 11 etapas, CU04 8 etapas y CU01 API 10 comprobaciones.

El smoke CU01 detectó una regresión real durante el cierre: añadir `permissions` a `/technical/session` rompía el shape fijado de CU01. Se retiró; los permisos se publican solo en `/security/permissions`.

## Límites

- Sin permisos por registro: CU02 gobierna operaciones por módulo.
- CU02 asigna roles, no habilita credenciales: un empleado con identidad creada y sin contraseña no puede iniciar sesión.
- `Operaciones` (Spring) conserva su política técnica por nombre de rol; migrarla al catálogo requiere replicar la resolución en ese servicio.
- La consulta de disponibilidad de CU04 sigue siendo **informativa**; la reserva/confirmación de CU15 debe revalidar y escribir atómicamente en Empleados.
