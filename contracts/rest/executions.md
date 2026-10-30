# CU16 — Ejecución, avances y evidencias: contrato REST aprobado

Diseño aprobado en `docs/compose/spec/cu16-execution-evidence.md`. La gestión web consume GraphQL/BFF (`contracts/graphql/executions.graphql`); este REST es la superficie del propietario Operaciones. No acredita por sí solo implementación ni aceptación.

La confirmación del servicio sigue perteneciendo a CU15 y no cambia: `work_orders.status` permanece `confirmed`. La ejecución es un agregado propio con estado propio. CU16 **no** finaliza la orden; verificar y finalizar son CU17.

## Permisos y autorización por registro

`executions:read:self`, `executions:read:team` y `executions:write` son permisos cerrados del catálogo, sin herencia por prefijo. El alcance se otorga por permiso, nunca por nombre de rol: los roles personalizados con estos permisos funcionan igual.

Toda petición exige:

1. Token válido como en el resto de Operaciones (firma, issuer, audiencia propia, `exp`, `sub`).
2. Resolución en Empleados del actor para el alcance requerido: `subject` → empleado activo con identidad vigente y asignación de seguridad actual, y comprobación de las asignaciones concretas. Nunca se acepta `employeeId` del cliente como identidad.
3. Autorización por registro: la asignación vigente de la orden debe corresponder al empleado resuelto cuando el alcance es `write` o `read:self`; `read:team` autoriza cualquier trabajo del taller.

Reglas de facultad:

- Solo el mecánico asignado vigente inicia, registra avances y confirma evidencias. Jefe de taller y administrador **no** escriben en nombre de otro; si la misma persona tiene asignación y permisos, actúa sobre su propio trabajo.
- Jefatura consulta avances y evidencias de los trabajos del taller y solicita su descarga temporal. No obtiene datos personales, financieros ni técnicos internos más allá del DTO.
- Un identificador ajeno, inexistente o fuera de alcance responde `404 EXECUTION_WORK_NOT_FOUND`, indistinguible.
- Sin vínculo, sin actividad o sin permiso responde `403 EXECUTION_ACCESS_DENIED`, nunca una lista vacía.

## Empleados — resolución de actor para ejecución

| Método/ruta | Entrada | Respuesta |
| --- | --- | --- |
| POST /executions/authorize | `{scope:"write"|"read-self"|"read-team", assignmentIds:[UUID]}` | `{actor, items:[AssignmentCheck], observedAt}` |

Lectura, no comando de negocio: sin `operationId` ni mutaciones. Exige el permiso del `scope` indicado, revalidado en servidor por petición, sin aplicar la excepción CU02 de cuentas de infraestructura no vinculadas. Claves cerradas, entre 1 y 50 identificadores sin duplicados. `AssignmentCheck` conserva la forma de `contracts/rest/agenda.md`. Cualquier identificador inexistente, sin Saga o ajeno al alcance produce 404 indistinguible, sin respuesta parcial.

## Operaciones — ejecución

| Método/ruta | Permiso | Descripción |
| --- | --- | --- |
| GET /executions/me/:assignmentId | executions:read:self | Ejecución propia del trabajo asignado |
| GET /executions/team/:assignmentId | executions:read:team | Ejecución de cualquier trabajo del taller |
| POST /executions/:assignmentId/start | executions:write | Inicia la ejecución del trabajo |
| POST /executions/:assignmentId/advances | executions:write | Registra un avance inmutable |
| POST /executions/:assignmentId/advances/:advanceId/evidences | executions:write | Solicita autorización de carga de una evidencia |
| POST /executions/:assignmentId/evidences/:evidenceId/confirm | executions:write | Confirma y verifica la carga |
| POST /executions/:assignmentId/evidences/:evidenceId/retry | executions:write | Abre un intento nuevo sobre una evidencia fallida |
| GET /executions/:assignmentId/evidences/:evidenceId/download | executions:read:self o executions:read:team | Acceso temporal de descarga |

Las rutas de lectura se separan por alcance, igual que la agenda: `me` exige pertenencia, `team` exige el permiso de equipo. El detalle se revalida en cada petición y no confía en una lectura previa.

### Cuerpos

```
POST /executions/:assignmentId/start
{ "operationId": UUID, "expectedVersion": Int? }

POST /executions/:assignmentId/advances
{ "operationId": UUID, "expectedVersion": Int, "description": String, "minutesWorked": Int, "occurredAt": DateTime? }

POST /executions/:assignmentId/advances/:advanceId/evidences
{ "operationId": UUID, "fileName": String, "contentType": String, "sizeBytes": Int, "checksumSha256": String }

POST /executions/:assignmentId/evidences/:evidenceId/confirm
{ "operationId": UUID, "expectedVersion": Int }

POST /executions/:assignmentId/evidences/:evidenceId/retry
{ "operationId": UUID, "expectedVersion": Int, "checksumSha256": String }
```

Claves cerradas: cualquier propiedad ajena al cuerpo correspondiente produce `400 VALIDATION_ERROR`.

### Respuestas

`Execution` = `{orderId, orderNumber, assignmentId, employeeId, status:"in_progress", startedAt, version, advances:[Advance], evidenceSummary:{pending,available,failed}}`.

`Advance` = `{id, sequence, description, minutesWorked, occurredAt, recordedAt, version, evidences:[Evidence]}`.

`Evidence` = `{id, advanceId, fileName, contentType, sizeBytes, state, attempt, failureCode, createdAt, confirmedAt}` con `state` en `pending|available|failed`.

Las mutaciones responden con `{execution|advance|evidence, replayed}`. La solicitud de evidencia responde además:

```
{ "evidence": Evidence, "upload": { "url": String, "method": "PUT", "headers": {String:String}, "expiresAt": DateTime }, "replayed": Boolean }
```

`headers` es exacto y debe enviarse literal: incluye la escritura condicional `If-None-Match: *` y el checksum declarado. La descarga responde `{url, expiresAt}`.

### Reglas de ejecución

- El inicio exige orden `confirmed` con Saga confirmada, asignación, empleado e intervalo válidos, y asignación vigente del actor. Un inicio repetido con el mismo `operationId` es replay sin efectos; uno nuevo sobre una ejecución ya iniciada es `409 EXECUTION_ALREADY_STARTED`. La concurrencia se resuelve con índice único por orden y con el registro de idempotencia, nunca con una comprobación previa sola.
- `expectedVersion` es obligatorio en toda mutación sobre una ejecución o evidencia existente; una versión obsoleta responde `409 VERSION_CONFLICT`.
- Los avances son inmutables y append-only, con secuencia monótona por ejecución. `description` 3–2000 caracteres normalizados; `minutesWorked` entero entre 1 y 1440; `occurredAt` opcional, no futuro y no anterior al inicio de la ejecución.
- La evidencia se adjunta a un avance concreto de la misma ejecución; un avance o evidencia de otra orden es `404` indistinguible.
- La clave del objeto la genera solo el servidor, con prefijo por orden y evidencia y discriminación por intento. El cliente no propone claves ni rutas.
- `checksumSha256` es base64 del SHA-256 de los bytes, 32 bytes decodificados. Nombre ≤120 caracteres sin separadores de ruta.
- Tipos permitidos y topes: `image/jpeg`, `image/png`, `image/webp` hasta 5 MiB; `video/mp4` hasta 20 MiB. El tipo real se comprueba leyendo los primeros bytes del objeto con credenciales del servicio, no solo el `Content-Type` declarado. Un objeto que no coincide se marca `failed` y se elimina; nunca pasa a disponible.
- Estados: `pending` (registro y autorización emitidos, objeto no verificado), `available` (verificado e inmutable) y `failed` (intento agotado o validación fallida, con código seguro). Una carga exitosa en el almacenamiento no equivale por sí sola a evidencia disponible.
- Inmutabilidad: la autorización de carga firma escritura condicional y la clave incluye el intento; la confirmación registra ETag, `VersionId` cuando existe, tamaño, checksum y tipo real, y la descarga usa la versión registrada. Un reintento usa una clave nueva.
- Reintentos acotados a 5 intentos por evidencia; agotados, `409 EVIDENCE_ATTEMPTS_EXHAUSTED`.
- `operationId` idempotente con huella de actor, acción, destino, contenido y versión. Confirmar dos veces la misma evidencia devuelve el mismo resultado sin duplicar historial.
- Auditoría append-only por inicio, avance, solicitud, confirmación y fallo. Nunca se registran URLs firmadas, credenciales ni cuerpos del almacenamiento.

## Consistencia y fallos

| Condición | HTTP/código |
| --- | --- |
| Sin token/firma/issuer/audiencia válidos | 401 según contrato propietario |
| Sin permiso, vínculo actual o actividad | 403 EXECUTION_ACCESS_DENIED |
| Trabajo/avance/evidencia ajeno o inexistente | 404 EXECUTION_WORK_NOT_FOUND |
| Entrada inválida, tipo o tamaño no permitido | 400 VALIDATION_ERROR |
| Inicio duplicado | 409 EXECUTION_ALREADY_STARTED |
| Avance sobre ejecución no iniciada | 409 EXECUTION_NOT_STARTED |
| Versión obsoleta | 409 VERSION_CONFLICT |
| Contenido distinto para el mismo operationId | 409 IDEMPOTENCY_CONFLICT |
| Evidencia ya disponible o intento incoherente | 409 EVIDENCE_STATE_CONFLICT |
| Intentos agotados | 409 EVIDENCE_ATTEMPTS_EXHAUSTED |
| Firma real del archivo no permitida | 409 EVIDENCE_STATE_CONFLICT con evidencia `failed` |
| Falta configuración de almacenamiento | 503 EVIDENCE_STORAGE_UNAVAILABLE |
| No se puede resolver el actor en Empleados | 503 EXECUTION_DEPENDENCY_UNAVAILABLE |
| Referencias o estado de la orden no verificables | 503 EXECUTION_STATE_UNAVAILABLE |
| Fallo SQL propietario | 503 PERSISTENCE_UNAVAILABLE |

Nunca se convierte un 503 en una lista vacía exitosa. Los mensajes no incluyen tokens, hosts privados, claves de objeto completas, URLs firmadas ni excepciones upstream.

## Transporte binario directo — excepción expresa

La web solicita y confirma por GraphQL/BFF. Los bytes viajan del navegador al almacenamiento con la autorización prefirmada que emite Operaciones, mediante el método binario dedicado del `SessionPort`.

Esta es una excepción expresa al canal GraphQL empresarial y está acotada: solo transporta bytes a una URL ya autorizada por el propietario, no decide reglas de negocio, no recibe el JWT de Keycloak, no recibe credenciales AWS y no se usa para ninguna otra operación. El BFF no firma URLs ni conoce credenciales del almacenamiento.

El bucket permanece privado, sin ACL pública ni listado anónimo, con CORS restringido a los orígenes exactos de la web y a los métodos y cabeceras de la carga y descarga.

## Almacenamiento y verificación pendiente

El almacenamiento es AWS S3 privado; no se sustituye por un emulador. La configuración es privada del backend (`S3_EVIDENCE_BUCKET`, `S3_EVIDENCE_REGION`, endpoint opcional, credenciales por cadena de proveedor estándar, TTL de carga y descarga) y nunca llega a imágenes, Git ni navegador.

Si falta configuración, las operaciones independientes (modelo, permisos, avances, estados, UI y pruebas deterministas) siguen siendo válidas, la solicitud de evidencia responde `503 EVIDENCE_STORAGE_UNAVAILABLE` y la integración S3 queda **pendiente de verificación real**. En ese caso CU16 no se declara completo de punta a punta.

## Consumidores y comprobación

El BFF expone `myExecution`, `teamExecution`, `startExecution`, `recordAdvance`, `requestEvidence`, `confirmEvidence`, `retryEvidence`, `myEvidenceDownload` y `teamEvidenceDownload`, y autoriza por campo. `mf-employees` consume solo mediante `SessionPort.requestBusiness` y el método binario dedicado.

Aceptación: dos mecánicos y un jefe vinculados activos con trabajos confirmados por CU15 real; inicio único y duplicado; avances con versión e idempotencia; evidencia pendiente, disponible y fallida; intento de adjuntar a un avance ajeno; descarga autorizada y denegada; jefatura en solo lectura; y el estado de S3 declarado con exactitud. No se acredita CU17, IA, offline ni Flutter.
