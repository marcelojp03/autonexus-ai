---
feature: cu16-execution-evidence
status: designed
updated: 2026-10-29
source: work/marcelo
---

# CU16 — Registro de ejecución, avances y evidencias

## Report

## [S1] Problem

CU15 confirmó y asignó trabajos reales y CU05 permite consultarlos, pero el mecánico no tiene forma de registrar el inicio de la actividad, las tareas realizadas, el tiempo empleado, las observaciones ni las fotografías que prueban el estado de la reparación. Sin ese registro, CU17 no puede verificar nada y la orden queda confirmada indefinidamente sin progreso observable.

El caso de uso `docs/use-cases/CU16.md` exige: orden confirmada y asignada, permiso para registrar avances, validación de datos y archivos, carga segura a Amazon S3 con referencias registradas, y estados pendientes cuando no hay conectividad. Los actores son Mecánico (iniciador), Jefe de taller y Amazon S3.

## [S2] Design

### [S2.1] Modelo: ejecución separada de la confirmación

Operaciones es el propietario. La ejecución vive en su base, junto a la orden confirmada; no se crea otro microservicio ni otra base.

- `work_orders.status` **no cambia**: la confirmación global sigue siendo el hecho de CU15 y su estado `confirmed` con Saga, asignación, empleado e intervalo.
- La ejecución es un agregado propio (`work_executions`) con estado propio, avances (`work_advances`) y evidencias (`work_evidence`).
- **Dos fuentes de verdad, deliberadas**: CU15 responde "¿el servicio está confirmado y para quién?"; CU16 responde "¿cómo va la ejecución del mecánico?". Ningún contador de avances cambia el estado de la orden ni sustituye la confirmación.
- Estados de ejecución implementados en CU16: solo `in_progress`, alcanzable por el inicio del mecánico asignado. El cierre (`finished`/`pending_verification`) pertenece a CU17 y **no** se implementa aquí: no existe endpoint de finalización, ni transición por porcentaje, ni estado terminal alcanzable.
- `work_executions.status` se declara con espacio para CU17, pero CU16 solo escribe `in_progress`; cualquier valor no soportado se rechaza.

Invariantes del inicio:

- La orden debe existir con `status='confirmed'`, Saga confirmada, asignación y empleado no nulos, `starts_at < ends_at`.
- El actor debe ser el empleado asignado vigente de esa orden, con identidad actual vinculada y activo (ver S2.2).
- Un inicio repetido con el mismo `operationId` es replay sin efectos; un inicio nuevo sobre una ejecución ya iniciada es `409 EXECUTION_ALREADY_STARTED`. Dos inicios concurrentes quedan resueltos por índice único `(order_id)` y por `operationId`, nunca por comprobación previa sola.
- `expectedVersion` es obligatorio en toda mutación que modifica una ejecución existente. Una versión obsoleta responde `409 VERSION_CONFLICT`.

### [S2.2] Permisos y autorización por registro

Catálogo cerrado, sin herencia por prefijo, tres entradas nuevas (25 → 28):

| Permiso | Módulo | Operación | Alcance |
| --- | --- | --- | --- |
| `executions:read:self` | Ejecuciones | read:self | Avances y evidencias del trabajo asignado al empleado vigente del portador |
| `executions:read:team` | Ejecuciones | read:team | Avances y evidencias de los trabajos del taller |
| `executions:write` | Ejecuciones | write | Iniciar ejecución, registrar avances y solicitar/confirmar evidencias |

Roles iniciales, por migración aditiva en Empleados que preserva personalizaciones: `administrador` recibe los tres; `jefe_taller` recibe `read:self` y `read:team`; `mecanico` recibe `read:self` y `write`. Ningún rol inicial recibe escritura ajena.

Autorización por registro, resuelta en servidor en cada petición:

1. El token se valida como en el resto de Operaciones (firma, issuer, audiencia, `exp`, `sub`).
2. Operaciones pide a Empleados la resolución del actor para el alcance requerido: `subject` → empleado activo con identidad vigente y asignación de seguridad actual, más la comprobación de las asignaciones concretas. No acepta `employeeId` del cliente como identidad.
3. El alcance se otorga por permiso, no por nombre de rol: los roles personalizados con estos permisos funcionan igual.
4. **Escritura acotada al asignado**: solo el mecánico cuya asignación vigente corresponde a ese trabajo inicia, registra avances y confirma evidencias. Jefe y administrador **no** escriben en nombre de otro; si la misma persona tiene asignación y permisos, actúa sobre su propio trabajo.
5. **Lectura acotada por registro**: `read:self` solo el trabajo propio; `read:team` cualquier trabajo del taller. Un identificador ajeno, inexistente o fuera de alcance responde `404 EXECUTION_WORK_NOT_FOUND` indistinguible.
6. Sin vínculo, sin actividad o sin permiso: `403 EXECUTION_ACCESS_DENIED`, nunca una lista vacía.

Facultades de jefatura (explícitas, sin ampliar datos): consultar avances y evidencias de los trabajos del taller y solicitar su descarga temporal autorizada. No obtiene datos personales, financieros ni técnicos internos más allá del DTO de S2.6. Verificar y finalizar son CU17.

### [S2.3] Estados de evidencia

`pending` → `available` o `failed`. Una carga exitosa en S3 **no** equivale a evidencia registrada: el estado solo pasa a `available` tras la confirmación verificada.

- `pending`: existe el registro y la autorización temporal; el objeto aún no fue verificado. Es el estado honesto de "carga pendiente"; no se cuenta como evidencia disponible y no se presenta como sincronizada.
- `available`: el objeto existe, coincide con tamaño, checksum y tipo real permitido, y quedó inmutable (S2.5).
- `failed`: el intento se agotó o la validación falló; se conserva el código seguro del motivo y se permite un reintento explícito con un intento nuevo.

Idempotencia: la solicitud y la confirmación llevan `operationId`; el replay no crea objetos ni filas nuevas. La confirmación es idempotente: confirmar dos veces la misma evidencia devuelve el mismo resultado sin volver a verificar ni duplicar historial. Una respuesta perdida se recupera repitiendo la confirmación con el mismo `operationId`.

Un fallo de almacenamiento **no** borra el avance: el avance persiste y la evidencia queda `pending`/`failed`. El servicio devuelve `503 EVIDENCE_STORAGE_UNAVAILABLE` cuando falta configuración de S3.

### [S2.4] Carga directa con autorización prefirmada

El navegador nunca recibe credenciales AWS ni el JWT de Keycloak viaja a S3.

1. La web pide por GraphQL/BFF una autorización de carga para un avance concreto (nombre, `contentType`, tamaño, checksum SHA-256 en base64).
2. Operaciones autoriza al actor sobre la orden y la asignación vigentes, **genera** el identificador de evidencia y la clave del objeto, y devuelve una autorización temporal acotada a esa clave, con cabeceras firmadas y `expiresAt`.
3. El navegador transfiere únicamente los bytes a S3 con esa autorización, usando un método de transporte binario nuevo del `SessionPort`. Es una **excepción expresa** al canal GraphQL empresarial: solo transporta bytes a una URL ya autorizada, no contiene lógica de negocio y no recibe tokens.
4. La web confirma la carga por GraphQL. Operaciones vuelve a autorizar al actor y verifica existencia, tamaño, checksum y tipo real permitido.
5. Las descargas también exigen autorización y devuelven una URL temporal; el alcance se revalida en cada solicitud.

Reglas de la clave: generada solo en servidor, con prefijo por orden y evidencia, discriminada por intento (`evidence/{orderId}/{evidenceId}/a{attempt}-{nonce}.{ext}`). El cliente no puede proponer prefijos ni rutas; una clave o intento distinto del emitido es `409 EVIDENCE_STATE_CONFLICT`.

Tipo real: además del `Content-Type` declarado, Operaciones lee los primeros bytes del objeto con sus propias credenciales y comprueba la firma del formato. Un objeto que no coincide se marca `failed` y se elimina; nunca queda disponible. Un objeto así no se sirve nunca.

Límites: `image/jpeg`, `image/png`, `image/webp` hasta 5 MiB; `video/mp4` hasta 20 MiB; nombre de archivo ≤120 caracteres sin separadores de ruta. Los límites se declaran en la autorización cuando el mecanismo lo permite y se verifican de nuevo al confirmar.

### [S2.5] Inmutabilidad de una evidencia confirmada

Una autorización prefirmada es reutilizable hasta vencer, así que la protección no puede basarse en "un solo uso".

Estrategia explícita:

1. **Escritura condicional**: la autorización de carga firma `If-None-Match: *`, de modo que la clave del intento solo puede escribirse una vez. Un segundo `PUT` sobre la misma clave falla en el almacenamiento.
2. **Clave por intento**: un reintento usa una clave nueva; no reutiliza la de un intento confirmado.
3. **Huella registrada**: la confirmación guarda ETag, `VersionId` (si el bucket tiene versionado), tamaño, checksum y tipo real verificados. La descarga usa la `VersionId` registrada cuando existe, por lo que sirve el objeto confirmado y no una versión posterior.

Límite declarado y honesto: si el proveedor no soporta escrituras condicionales ni versionado, la reescritura solo puede detectarse antes de confirmar; el contrato lo indica y no se promete inmutabilidad fuerte en ese supuesto.

No se registran URLs firmadas en logs ni en auditoría: solo el identificador, la clave interna y el resultado.

### [S2.6] DTO mínimo y contratos

`Execution` = `{orderId, orderNumber, assignmentId, employeeId, status:"in_progress", startedAt, version, advances:[Advance], evidenceSummary:{pending,available,failed}}`.

`Advance` = `{id, sequence, description, minutesWorked, occurredAt, recordedAt, version, evidences:[Evidence]}`.

`Evidence` = `{id, advanceId, fileName, contentType, sizeBytes, state:"pending"|"available"|"failed", attempt, failureCode:null|string, createdAt, confirmedAt:null|ISO}`.

Sin `customerId`, contactos, documentos, importes, cotización, vínculo financiero, credenciales, claves ya firmadas ni cuerpos técnicos. Observaciones y descripciones son texto escapado, no HTML.

Contratos: `contracts/rest/executions.md`, `contracts/graphql/executions.graphql`, ampliación aditiva de `contracts/rest/agenda.md` y `contracts/graphql/agenda.graphql` para publicar el estado de ejecución, y ampliación de `contracts/auth/permissions.md` y `contracts/auth/session.ts`.

### [S2.7] CU05 sigue mostrando el trabajo durante la ejecución

La agenda no puede reducirse a "confirmado": lista y detalle publican además `executionStatus` (`not_started` | `in_progress`) y un progreso mínimo (`advances`, `lastAdvanceAt`, `availableEvidence`). Los campos son aditivos; la confirmación sigue proviniendo de la Saga.

`CU16` no altera qué trabajos son consultables: la agenda sigue exigiendo orden confirmada y asignación vigente. Cuando se implemente el cierre (CU17) se ajustará explícitamente qué trabajos pasan al historial, para que una orden confirmada no permanezca indefinidamente como trabajo pendiente.

### [S2.8] Almacenamiento: AWS S3 privado, sin sustituto

El almacenamiento es AWS S3 privado, también en local. No se incorpora MinIO ni un emulador como sustituto: un veredicto verde contra un emulador no acredita el recorrido real.

Configuración por entorno, solo en el backend (`S3_EVIDENCE_BUCKET`, `S3_EVIDENCE_REGION`, `S3_EVIDENCE_ENDPOINT` opcional, credenciales por cadena de proveedor estándar o archivo privado, `S3_EVIDENCE_UPLOAD_TTL`, `S3_EVIDENCE_DOWNLOAD_TTL`, orígenes web exactos para CORS). Nunca en imágenes, Git ni el navegador. El bucket permanece privado: sin ACL pública, sin listado anónimo, y CORS limitado a los orígenes exactos de la web.

Procedimiento de comprobación previa: buscar configuración privada del proyecto para bucket y credenciales autorizadas **sin imprimir secretos**. Si existe, se ejecuta el recorrido real completo. Si falta, se completan las partes independientes (modelo, permisos, avances, estados, contratos, UI, pruebas deterministas con doble) y se registra la integración S3 como **pendiente de verificación real**, indicando exactamente qué datos y permisos hacen falta. En ese caso CU16 **no** se declara completo de punta a punta. No se crean recursos AWS ni se modifican permisos existentes.

Uso de un bucket ya existente puede generar consumo: el costo cero no se promete.

## [S3] Out of Scope

CU17 (verificar/finalizar, transición a pendiente de verificación, entrega), IA de inspección, funcionamiento offline y sincronización (CU27), Flutter, cobros, notificaciones, creación de recursos AWS, MinIO como sustituto, migración de evidencias históricas, adjuntar evidencias a recepción o a la orden sin avance, edición o borrado de avances ya registrados, y cualquier finalización por porcentaje o contador.

## Tasks

- [ ] T1: Contratos CU16 — acceptance: REST, GraphQL, permisos y `SessionPort` publicados con DTO, estados y errores cerrados (covers: S2.2–S2.7).
- [ ] T2: Empleados — permisos `executions:*` con migración aditiva y resolución de actor/asignaciones para ejecución — acceptance: migración aplicada, roles iniciales correctos, autorización por permiso y por registro con pruebas (depends: T1; covers: S2.2).
- [ ] T3: Operaciones — modelo, migración, casos de uso y REST de ejecución/avances con idempotencia, versión y auditoría — acceptance: pruebas verdes y API real sobre orden confirmada (depends: T2; covers: S2.1, S2.3, S2.6).
- [ ] T4: Operaciones — almacenamiento S3 privado, autorización prefirmada, validación real de archivo e inmutabilidad — acceptance: pruebas deterministas del adaptador y estados `pending/available/failed` sin exponer credenciales (depends: T3; covers: S2.4, S2.5, S2.8).
- [ ] T5: Agenda — estado de ejecución en lista y detalle — acceptance: CU05 sigue mostrando el trabajo confirmado con su progreso, sin cambiar su confirmación (depends: T3; covers: S2.7).
- [ ] T6: BFF GraphQL — SDL, política por campo y gateways — acceptance: campos autorizados por permiso, pruebas unitarias/HTTP y build (depends: T1, T3; covers: S2.6, S2.7).
- [ ] T7: Web — pantalla de ejecución, avances y evidencias; enlace del Shell — acceptance: registro real con distinción pendiente/disponible/fallido, build y smoke de navegador (depends: T6; covers: S2.3–S2.7).
- [ ] T8: Compose y docs — configuración S3 por entorno y detalle técnico — acceptance: Compose válido, documentación de lo verificado y de lo pendiente (depends: T4; covers: S2.8).
- [ ] T9: Verificación real y revisión — acceptance: recorrido real de ejecución/avances, estado de S3 declarado con exactitud, revisión resuelta (depends: T5, T7, T8).
- [ ] T10: Cierre — acceptance: STATUS, decisiones y handoff actualizados; integración y publicación normales verificadas (depends: T9).

## Journey log

- Decisiones del usuario en esta sesión: ejecución separada de la confirmación, con estado propio y CU05 mostrando el progreso; carga directa prefirmada con confirmación verificada por el propietario; AWS S3 real sin MinIO, dejando la verificación pendiente si falta configuración; jefatura de solo lectura y escritura reservada al mecánico asignado.
