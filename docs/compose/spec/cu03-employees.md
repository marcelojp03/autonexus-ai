---
feature: cu03-employees
status: in-progress
updated: 2026-10-26
source: feat/cu03-employees
---

# CU03 — Gestionar empleados e integración previa CU01

## Report

## [S1] Problem

Al orientar esta tarea, main y feat/cu01-keycloak ya apuntan a b8d8079. Falta comprobar su runtime definitivo y actualizar documentación histórica; no corresponde atribuir a esta tarea un merge anterior. CU03 carece de implementación empresarial. integration/bff solo contiene AGENTS y README: no hay aplicación disponible para integrar la interfaz.

## [S2] Design

### [S2.1] Integración previa CU01

Comprobar worktrees, cambios ajenos, ancestros y relación del commit final b8d8079 con el rango revisado 1963ce3..86d81af. Mantener ramas/worktrees y no hacer push. Runtime definitivo de CU01 en raíz principal: servicios y web en sus carpetas, PostgreSQL empresarial administrado por infra/compose e IdP por infra/keycloak. CU03 se desarrolla en .worktrees/cu03-employees, feat/cu03-employees, base main b8d8079; no administra Compose desde esa copia.

Resolver ownership real mediante labels/rutas/montajes antes de mover procesos. Copiar privados ausentes con creación exclusiva y comparación de bytes en memoria, sin imprimir secretos ni regenerarlos. Mantener volúmenes autonexus-backend-dev_postgres-data y autonexus-keycloak-dev_idp-postgres-data. Si hay recreación de contenedores por labels/binds, no borrar volúmenes ni reinicializar bases. Mantener verificaciones estrictas de ownership y rechazo desde copias históricas.

Smoke desde raíz: login Code/PKCE, navegación Empleados→Operaciones→Empleados sin recarga/login adicional, APIs protegidas 401/200/403 según identidad, logout y salud SQL/PostgreSQL. Compilar/probar únicamente lo afectado, sin repetir todas las suites por rutina. Documentar ubicación de cada aplicación y Compose.

### [S2.2] Datos y reglas propuestas para aprobación

Empleado con UUID estable generado en backend; nombres y apellidos obligatorios (1–100 caracteres cada uno), documento obligatorio (1–40), email obligatorio válido dot-atom ASCII/DNS-punycode (local máximo64, etiquetas1–63 sin guiones extremos, total254), teléfono obligatorio (7–25, dígitos y signos habituales), cargo laboral obligatorio (1–100), fecha de ingreso válida no futura y lista de especialidades (0–20 nombres distintos, 1–80 cada uno). Recortar/normalizar espacios; rechazar tipos inválidos y propiedades desconocidas. Documento normalizado y email case-insensitive únicos incluso para inactivos, respaldados por constraints SQL; nombres no son claves de duplicado. Cargo y especialidad no conceden permisos.

Alta activa, modificación con expectedVersion, desactivación conservando registro e historial; no DELETE ni borrado físico, incluso sin trabajo asociado. No consultar bases ajenas. Historial append-only por cambio con subject autenticado, fecha y snapshot/version empresarial, nunca tokens ni contraseñas. Consulta paginada limit 1–100/offset no negativo, filtros de estado y búsqueda acotada por nombre/documento con orden estable.

### [S2.3] REST, autorización y PostgreSQL

GET/POST /employees; GET/PUT /employees/:id; POST /employees/:id/deactivate; GET /employees/:id/history; POST /employees/:id/access/retry. Mutaciones con operationId UUID; modificación/desactivación con expectedVersion. Repetir operationId y contenido devuelve resultado registrado sin duplicar efectos; mismo ID con otro contenido→409. Política explícita administrador para cada operación y registro usando guard JWT existente, issuer/audiencia Empleados/firma/exp/roles realm. 401 sin sesión, 403 sin permiso, 400 inválido, 404 ausente, 409 duplicado/versión/idempotencia, 503 persistencia indisponible; errores sanitizados. No permitir mass assignment de subject o roles.

Dominio y casos de uso sin Nest/TypeORM, puertos de repositorio/identidad, adaptadores HTTP/PostgreSQL/Keycloak y composición siguiendo patrones locales. Migraciones versionadas en schema employees, con tablas empresariales, auditoría e intenciones/resultados idempotentes. synchronize/migrationsRun=false. Empleado, auditoría e intención IdP se confirman atómicamente solo en PostgreSQL propietario; constraints refuerzan unicidad y concurrencia. Nada de persistencia empresarial en otra base o archivo.

### [S2.4] Identidad opcional y recuperación

Sin solicitud explícita de acceso no llamar a Keycloak. access.requested=true crea cuenta dedicada con username determinista derivado del UUID y atributo employeeId; guardar keycloakSubject único al confirmar. No vincular por email ni apropiarse de cuentas existentes. Para cuentas vinculadas sincronizar cambios de nombres/email/enabled; desactivar empleado solicita deshabilitar cuenta sin borrarla. No asignar roles por cargo/especialidad ni implementar CU02. Cuenta nueva sin roles empresariales y sin contraseña recibida/devuelta por REST: documentar habilitación de credencial vía IdP como dependencia, no presentar un login listo.

Estados access not_requested/pending/synced/failed/conflict separados del estado laboral. Intención durable, intentos y código de error seguro; procesamiento fuera de transacción SQL. Respuesta distingue guardado empresarial de sincronización pendiente. Timeout no confirma rechazo ni revierte datos laborales. Retry administrativo explícito recupera intenciones tras reinicio. Verificar username/employeeId/subject antes de reutilizar identidad; pérdida de respuesta tras creación remota se resuelve encontrando la misma cuenta. Ownership incompatible→conflict sin tocar cuenta ajena. Serializar por empleado y versión deseada; una respuesta obsoleta no puede confirmar versión posterior. Si falla confirmación SQL tras éxito remoto, reconciliar sin crear otra cuenta. No transacción atómica PostgreSQL+Keycloak.

Identidad técnica confidencial de backend con client_credentials y permisos necesarios de administración de usuarios, nunca cuenta personal ni bootstrap como credencial habitual. Bootstrap solo puede provisionar inicialmente este cliente técnico; secreto nuevo de ese cliente en archivo privado separado, sin rotar secretos existentes. Documentar alcance efectivo de permisos y límites del adaptador. Atributo employeeId administrado solo por admin en User Profile, sin habilitar atributos arbitrarios al usuario. Preservar secretos y fixtures CU01, sin exposición en web/contratos/logs. Destinos confiables, timeout y errores sanitizados. Bloquear desactivación de la propia identidad administradora vinculada; gestión general de último administrador/roles permanece en CU02.

Amendment asentado: solo la creación puede solicitar enabled=true; al actualizar una identidad existente se conserva o deshabilita. Cuenta deshabilitada externamente devuelve failed/IDP_ACCOUNT_DISABLED sin reactivación por datos laborales. Habilitarla es acción autorizada separada del IdP, no CU02 implementado. synced es la última confirmación local, no lectura remota continua. Cada nuevo comando retry reconcilia estado vigente incluso desde synced, sin incrementar versión laboral; replay del mismo operationId sigue sin efectos. Si se pierde sesión/lock SQL durante red, no se promete orden absoluto del perfil remoto: se impide habilitar por escrituras tardías y se repara por retry explícito. Ante confirmación SQL fallida se conserva pending; no se publica IDP_CONFIRMATION_FAILED que no puede persistirse.

### [S2.5] Contratos para participante 2


Como BFF no está disponible, entregar backend propietario real, OpenAPI, SDL/operaciones GraphQL propuestas y contrato de autenticación. Publicar los contratos tan pronto estén definidos, antes del cierre de implementación, y mantenerlos alineados tras pruebas. No inicializar BFF ni cambiar demos por CRUD ficticio; conservar diseño NG-ALAIN y no conectar web directamente al REST empresarial. BFF futuro valida sesión/permisos por operación/campo y propaga bearer autorizado con audiencia Empleados, sin SQL ni secretos IdP. Audiencia propia/mappers/exchange del BFF requieren acuerdo posterior, no se acreditan como implementados. Cuenta sin roles y credencial habilitada no tiene acceso operativo al taller; no acreditar CU02 ni CU03 web completo.

### [S2.6] Evidencia, revisión y cierre

Pruebas públicas de reglas/HTTP más PostgreSQL real: migraciones/no-op, persistencia tras reinicio, validaciones, duplicados concurrentes, versiones, auditoría, idempotencia y desactivación. Keycloak real: cuenta opcional, actualización, subject estable, deshabilitación, indisponibilidad y recuperación sin duplicados. Pérdida de respuesta/confirmación se provoca de forma acotada y se identifica como fallo inyectado, no evidencia ordinaria. Probar 401/403 con roles reales y regresión CU01; restaurar procesos propios. Usar datos sintéticos, sin borrar bases ni cuentas ajenas.

Después de terminar verificaciones, revisión independiente con base/head/diff y comandos observados, separando cumplimiento, corrección y consistencia; resolver críticos y revalidar áreas afectadas. Actualizar contratos, migraciones, README, STATUS, decisiones y esta especificación. Commits locales de implementación/cierre documental; sin merge CU03, push ni eliminación automática de worktrees. Distinguir backend verificado, interfaz no integrada y dependencias pendientes.

## [S3] Out of Scope

CU02 completo, elevación de roles, inicializar BFF ajeno, CRUD web sin BFF, jornadas, agenda, reservas, Saga, otros microservicios, Flutter, Kubernetes y producción.

## Tasks

- [x] T1: Verificar CU01 y fijar runtime de raíz — acceptance: ownership/rutas documentados, secretos/volúmenes conservados y smoke real PASS (covers: S2.1).
- [x] T2: Implementar dominio, migraciones y REST autorizado — acceptance: PostgreSQL real confirma CRUD sin borrado, historial, duplicados, validaciones, autorización y concurrencia (depends: T1; covers: S2.2, S2.3).
- [x] T3: Implementar identidad opcional y recuperación — acceptance: Keycloak real y fallos controlados confirman subject estable, pending/retry/conflict y ausencia de duplicados (depends: T2; covers: S2.4).
- [x] T4: Mantener alineados los contratos tempranos del participante 2 — acceptance: contratos publicados en 12f44e6 antes de implementación; comprobar coherencia con REST final y BFF/interfaz pendientes explícitos (covers: S2.5).
- [ ] T5: Verificar regresión, revisar y cerrar commits locales — acceptance: evidencia observada, cero críticos abiertos y documentación actualizada sin push (depends: T4; covers: S2.6).

## Journey log

Evidencia previa a revisión: main89bc8e1 conserva CU01 y su runtime; contratos tempranos12f44e6. Empleados frozen/build PASS,55unitarias+42HTTP PASS, lint/tipos exit0 con0advertencias. Matriz real12grupos incluyó pérdidas remota/local, ownership y caída/restauración IdP; luego8grupos funcionales del código final sin repetir recuperación no afectada. Regresión CU01 desde raíz13etapas exit0 y aislamientoSQL1/2migraciones. OpenAPI3.1/sintaxis SDL PASS. Logs en output/cu03-employees del worktree y output/cu01-main-integration de raíz. Revisión independiente aún pendiente; no se marca delivered por pruebas propias.

2026-10-26: diseño aprobado mediante Question; usuario exige identidad técnica dedicada (no bootstrap habitual), contratos tempranos y límite explícito de cuenta sin acceso operativo. No requiere nuevas confirmaciones para decisiones técnicas rutinarias.

Amendment por revisión: C1 reprodujo ocho emails inválidos admitidos por el patrón inicial (red8); regla dot-atom/DNS y positivos pasan23/23 en la ronda acotada. Se retira el código no implementado IDP_CONFIRMATION_FAILED: ante confirmación SQL incierta se conserva pending. Regresión real adicional confirmó reactivación indebida por edición laboral; actualizaciones de identidades existentes ya no envían enabled=true y reportan IDP_ACCOUNT_DISABLED. Retry con nuevo operationId reconcilia incluso última confirmación synced, sin cambiar versión laboral; esto permite reparar perfil tras pérdida de sesión SQL/llamada tardía. Se incorpora prueba acotada terminando solo la conexión dueña del lock de un empleado sintético, sin detener PostgreSQL. Pendientes verificación del amendment y re-revisión; no se declara delivered.

Amendment verificado: email24/24 en dominio y67unitarias+42HTTP globales PASS; build/tipos/lint exit0 (0advertencias). Matriz real final15grupos/exit0, incluida pérdida de sesión SQL/llamada tardía sin reactivación y reconciliación desde synced. El intento de restauración anterior agotó espera: arranque observado118s; se amplió solo la espera acotada del verificador a300s y se exige Dockerhealthy+discovery. Limpieza de registros sintéticos pendientes verificada por origen y desactivación autorizada, sin borrado. Pendiente re-revisión del amendment; T5 sigue abierto.

Re-revisión5e1f5cc: identidad/recuperación conforme y observaciones documentales cerradas; C1 residual detectó Unicode U+212A convertido a ASCII antes del chequeo. Reproducción red2 en local/dominio y positivo de mayúsculas ASCII/punycode. Corrección acotada: verificar alfabeto antes de case folding; no cambia gateway, persistencia ni autoridad. Se corrige trazabilidad: el log histórico del timeout no fue conservado, los15grupos actuales sí están en real.log/real.exit. Pendiente verificación/re-revisión de este único límite.

Límite C1 final verificado: control ASCII previo a case folding, red2→dominio27/27;70unitarias+42HTTP, lint/tipos/build PASS. Funcional real9grupos/exit0 contiene los dos emails Unicode rechazados por HTTP y conserva ASCII/punycode. Identidad/recuperación no cambiaron y mantienen conformidad previa/15grupos; no se repitió outage ni CU01 por rutina. Pendiente re-revisión acotada del guard y trazabilidad del log.
