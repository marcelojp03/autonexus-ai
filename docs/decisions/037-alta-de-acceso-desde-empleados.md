# 037 — Configuración de acceso desde el registro de empleados

Fecha: 2026-11-10. Incremento local solicitado por el usuario, sin publicación Git.

El usuario pidió registrar un empleado con usuario, rol y contraseña permanente, y habilitar
empleados existentes sin volver a registrarlos. Extiende la presentación CU03 y coordina CU02/CU01;
no cambia los requisitos académicos ni declara nuevos puntos de aceptación.

La web conserva el alta laboral idempotente y encadena identidad, rol CU02 y credencial.
Una falla posterior conserva el empleado y permite reintentar desde su ficha. No simula una
transacción global: muestra resultado parcial y solo confirma acceso después de confirmar rol
y credencial. La asignación conserva otros roles. Los cargos/especialidades siguen separados.

`configureEmployeeLogin` se adapta en BFF a `POST /employees/:id/access/login`; ambos exigen
employees:write y security:write. El propietario valida identidad activa/sincronizada, pertenencia
del subject y atributo employeeId, nombre único y permisos del objetivo inferiores o iguales al actor.
Las operaciones de seguridad existentes siguen validando que no se concedan permisos superiores.
Se conservan locks por empleado y de seguridad para no competir con desactivación/asignación.

Usuario 3–64 caracteres canónicos, contraseña 8–128 sin controles, más política IdP. Keycloak
recibe temporary=false. No se envían credenciales en los comandos de creación/actualización laboral,
ni se almacenan en logs, respuestas, snapshots, hashes de idempotencia o historial. La migración
aditiva `CreateLoginCommands1794312000000` conserva solo metadatos de actor/operación/usuario,
estado/código y fechas; un replay confirmado no aplica otra contraseña. El resultado es histórico,
no una nueva autorización ni prueba de vigencia de credenciales tras cambios posteriores.

La contraseña vive en memoria del formulario hasta éxito o salida; no se persiste en el navegador.
Un fallo/timeout exige reintento explícito; no confirma que el proveedor rechazara el cambio.
Renombrar preserva subject/employeeId; la sincronización laboral por subject comprueba propiedad
sin imponer nuevamente el nombre automático anterior. No se publica la consola administrativa.

La integración real detectó `editUsernameAllowed=false`: Keycloak devolvía username read-only.
El seed habilita esta política y el bootstrap migra exclusivamente false→true después de comprobar
el resto de ajustes, conservando las demás políticas y cuentas. El provisionador independiente de
Empleados también contempla el ajuste. Con nombres editables, Keycloak exige username en el PUT
de perfil; la sincronización envía el nombre actual, sin reemplazar el elegido por el automático.

Contratos actualizados: GraphQL Empleados, OpenAPI y `contracts/auth/employees.md`.
La capacidad utiliza el cliente técnico de Empleados existente, sin aumentar sus permisos.
La autoridad realm-wide de manage-users/manage-realm ya documentada sigue siendo un límite del IdP.

Verificaciones y limitaciones finales se registran en STATUS. No se modifican cuentas reales del
usuario durante la prueba: las altas de aceptación usan datos sintéticos con prefijo de prueba.
