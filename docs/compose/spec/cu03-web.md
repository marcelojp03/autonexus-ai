---
feature: cu03-web
status: delivered
updated: 2026-10-27
source: work/marcelo
---

# CU03 web — Empleados de punta a punta

## Report

**What was built** — BFF NestJS en `integration/bff` que expone GraphQL y compone la API REST de Empleados, y pantallas NG-ALAIN en `mf-employees` para listado, búsqueda, registro, edición, desactivación e historial con estado de la cuenta vinculada. El Shell conserva la sesión OIDC y añade un transporte empresarial por `SessionPort` que nunca expone tokens. Se respetaron `operationId`, `expectedVersion`, replay, errores y estados de sincronización de acceso.

**Verification** — BFF: build, 10 unitarias y 10 HTTP con RSA sintético y upstream falso explícito; matriz real de 6 etapas contra Empleados y Keycloak reales (salud con upstream, 401, 403, lista con forwarding, introspección rechazada, error de negocio mapeado). Web: recorrido de navegador con 11 etapas PASS y exit 0 (login administrador, alta con solicitud de acceso, estado de acceso visible, persistencia tras recarga, edición, ida y vuelta de la fecha de ingreso, conflicto de versión y recarga, historial, desactivación con historial confirmada, consola limpia, permiso insuficiente bloqueado); repetido en `Asia/Tokyo` para cubrir un huso positivo y confirmar la fecha. `mf-employees` integrado y Shell construidos en el worktree; Operaciones y Empleados reales de la raíz en `8081`/`3002`; PostgreSQL real.

**Review** — Revisión independiente `425ed03..988d55d`: nueve criterios cumplidos, un crítico (la fecha de ingreso se construía en UTC y NG-ZORRO la leía en hora local, mostrándola un día antes) y hallazgos de corrección no bloqueantes. El crítico y los hallazgos relevantes se corrigieron y se revalidaron con el recorrido de 11 etapas; detalle y re-revisión en `docs/context/STATUS.md`. Backend propietario ya estaba entregado; esta entrega agrega BFF e interfaz, sin declarar CU02 ni CU04.

## [S1] Problem

CU03 tenía backend verificado pero ningún recorrido web: `integration/bff` estaba reservado sin aplicación y `mf-employees` solo tenía vistas demo del template. El modelo de trabajo anterior impedía tocar el BFF por pertenecer a otro bloque. Con la decisión 009, el recorrido puede completarse.

## [S2] Design

### [S2.1] BFF NestJS sin base de negocio

- `integration/bff` NestJS 12.2.0, GraphQL ejecutado con `graphql` 17.0.2 sobre el SDL publicado en `contracts/graphql/employees.graphql`; no hay ORM, migraciones ni conexión a PostgreSQL.
- Puerto `127.0.0.1:3004`. `POST /graphql`, `GET /health/live` y `GET /health/ready` (esta última comprueba alcanzabilidad de Empleados).
- Allowlist de campos raíz (`employees`, `employee`, `employeeHistory`, `createEmployee`, `updateEmployee`, `deactivateEmployee`, `retryEmployeeAccess`), una sola operación por petición, sin introspección, sin fragmentos nombrados, profundidad máxima 6 y 120 selecciones. Cualquier otra consulta devuelve `BAD_REQUEST` saneado.
- CORS exacto a 4200/4201/4202 con `Authorization` y `Content-Type`, sin credenciales.

### [S2.2] Autenticación y forwarding

- El BFF valida el access token del usuario con `jose` 6.2.13: RS256, issuer `http://127.0.0.1:8180/realms/autonexus`, audiencia `autonexus-employees-api`, `sub`/`iss`/`aud`/`exp` obligatorios, `typ: Bearer`, tolerancia 5 s y JWKS confiable.
- Exige rol `administrador` en servidor antes de resolver; 401 y 403 genéricos.
- Reenvía **el mismo token del usuario** a la API de Empleados (forwarding autorizado). No hay token exchange, ni audiencia propia nueva, ni credenciales administrativas de Keycloak en el BFF. El BFF no emite getters de token ni lo registra.
- No sustituye al usuario por una cuenta técnica: la autorización por rol/registro sigue en Empleados.

### [S2.3] Transporte de sesión a la web

- `SessionPort` incorpora `requestBusiness(query, variables)`: el propietario de la sesión (Shell o standalone OIDC) renueva el token, envía `Authorization` al BFF, valida la forma de la respuesta y devuelve `{data}` o `errors[{code,statusCode,message}]`.
- Los tokens siguen en RAM del SDK; no se pasan a props, storage ni componentes. La demo del template no monta estas rutas.
- Errores de transporte se convierten en mensajes saneados; 401 cierra la sesión; 403 se devuelve como fallo de permiso para que la vista lo muestre.

### [S2.4] Pantallas de Empleados

- Rutas bajo la base `/employees` del Shell: `list`, `new`, `:id/edit`, `:id/history`; también disponibles en standalone OIDC.
- Listado con búsqueda por nombre/documento, filtro por estado, paginación y etiquetas de estado laboral y de cuenta (`not_requested`, `pending`, `synced`, `failed`, `conflict`) con `errorCode` visible.
- Alta y edición con validaciones equivalentes al contrato, carga con teclado de la fecha, especialidades como tags y solicitud de acceso solo en alta. `operationId` estable por intención: un reintento tras fallo transitorio reutiliza la misma clave.
- Conflicto de versión: alerta, botón de recarga y nueva lectura del empleado; no se reenvía con `expectedVersion` viejo.
- Guardado con sincronización pendiente: se confirma el guardado laboral y se advierte por separado que la cuenta puede requerir reintento.
- Historial: versiones con acción, fecha, cargo, estado, cuenta y actor; desactivación conserva el historial.
- NG-ALAIN, single-spa y la sesión existente se mantienen; la navegación del Shell expone las nuevas páginas solo en el módulo Empleados.

### [S2.5] Estados y errores de interfaz

Carga, vacío, error con reintento, permiso insuficiente y conflicto tienen representación propia. Los códigos del contrato se muestran con mensajes saneados; nunca se exponen cuerpos internos del upstream, tokens ni detalles de SQL.

### [S2.6] Verificación

- BFF unitarias y HTTP con dobles explícitos; matriz real contra Empleados/Keycloak sin mocks.
- Recorrido de navegador real con Playwright, sesión Keycloak real y PostgreSQL; medición por etapa del tiempo invertido.
- Regresión de carrera en el listado: una respuesta inicial sin filtro podía sobrescribir un resultado filtrado; se descarta toda respuesta obsoleta.

## [S3] Out of Scope

CU02 y gestión de roles/credenciales, CU04 y planificación, agenda/asignaciones, reservas y Saga, móvil/Flutter, offline, MCP, otros microfrontends React, publicación en GitHub, reentrenamiento de IA y despliegue.

## Tasks

- [x] T1: Crear BFF NestJS con GraphQL, allowlist y salud — acceptance: build y tests HTTP PASS (covers: S2.1)
- [x] T2: Autenticar y reenviar el token a Empleados — acceptance: 401/403 y lista real PASS (depends: T1; covers: S2.2)
- [x] T3: Extender SessionPort y browser-auth sin exponer tokens — acceptance: transporte tipado y sin storage (depends: T1; covers: S2.3)
- [x] T4: Implementar pantallas de Empleados con estados — acceptance: listado, alta, edición, conflicto e historial compilan (depends: T3; covers: S2.4, S2.5)
- [x] T5: Verificar recorrido completo real y corregir hallazgos — acceptance: recorrido Playwright PASS y consola limpia (depends: T4; covers: S2.6)
- [x] T6: Documentar, revisar y cerrar commits locales — acceptance: README/contratos/STATUS actualizados, revisión sin críticos (depends: T5; covers: S2.6)

## Journey log

- El primer intento de recorrido usó un `fill` directo en el selector NG-ZORRO de fecha y el formulario quedó inválido; se reemplazó por entrada con teclado y validación previa al envío.
- `nz-alert` no proyecta contenido: el botón de recarga del conflicto se movió fuera de la alerta.
- El límite de profundidad GraphQL (4) rechazaba el `snapshot.access` del historial; se elevó a 6 con regresión específica.
- Los procesos lanzados con `Start-Process` morían al cerrarse la llamada de la herramienta; los servicios de verificación se lanzan con `spawn` desacoplado (`unref`) o quedan documentados para arranque manual.
- La revisión independiente detectó que la fecha se mostraba un día antes en husos negativos; el arreglo local-date y su aserción evitan que vuelva a pasar en silencio.
- El reintento de acceso estaba expuesto sin uso; ahora la ficha ofrece «Reintentar sincronización de la cuenta» y la desactivación pide confirmación.
