---
feature: offline-sync
status: in-progress
updated: 2026-11-02
source: work/marcelo
---

# Recorrido offline y sincronización (MS05 / DynamoDB)

## Report

## [S1] Problem

El taller trabaja en zonas donde la conexión se corta. Hoy el mecánico no puede abrir un trabajo ya
descargado ni registrar un avance con su fotografía sin red, y si lo hiciera no habría forma segura
de enviarlo después: chocarían los reintentos, se perderían respuestas y un token caducado
convertiría cualquier reintento en un error indistinguible.

Lo que se necesita: preparar un trabajo autorizado mientras hay red, trabajar **sin conexión** en
Flutter y en la PWA del Shell (consultar, capturar, inferir localmente, guardar un avance
pendiente) y sincronizar al reconectar con idempotencia por operación, sin duplicar datos y sin
confundir un conflicto de versión con una denegación de acceso.

## [S2] Design

### [S2.1] Sobre de sincronización (`contracts/sync/overlay.md`)

Un **sobre** (`overlay`) agrupa operaciones pendientes de un usuario y dispositivo. Campos:

| Campo | Contenido |
| --- | --- |
| `overlayId` | UUID del lote; sirve para trazabilidad y consulta, **no** sustituye la idempotencia |
| `subject` | `sub` del token vigente que envía; el servidor no confía en otro identificador |
| `deviceId` | Identificador estable del dispositivo (no secreto, rotable) |
| `operations[]` | Lista ordenada de operaciones pendientes |
| `createdAt` / `updatedAt` | Sellos del cliente y del servidor |

Cada **operación** lleva `operationId` (UUID estable generado antes de la primera petición),
`entity` (`advance`, `evidence-authorize`, `evidence-confirm`, `vision-analysis`), `target`
(`{assignmentId, advanceId?, evidenceId?}`), `baseVersion` (versión del propietario que el cliente
conocía), `dependsOn[]` (otros `operationId` del mismo sobre), `payload` y, si hay archivo,
`file: {sha256, bytes, contentType}`.

Reglas:

- `operationId` es la unidad de idempotencia: reenviar la misma operación **nunca** crea un segundo
  efecto; MS05 devuelve el resultado registrado.
- Un lote con `overlayId` nuevo puede contener una operación ya aplicada; el propietario la reconoce
  por su propio `operationId` y contesta replay.
- Sin `baseVersion` coherente no se aplica: el propietario responde conflicto.

### [S2.2] MS05 (`services/sync`, NestJS + DynamoDB)

Tabla `sync_overlays` (clave `PK = SUBJECT#<sub>` / `SK = OVERLAY#<overlayId>`), con ítems de
operación `SK = OP#<operationId>` que guardan **intención, intentos y resultado**:

`{subject, overlayId, operationId, entity, target, baseVersion, dependsOn, payloadHash, fileName,
fileSha256, fileBytes, contentType, state, attempts[], lastResult{status, code}, createdAt, updatedAt}`.

Estados: `pending → sending → applied | rejected | conflict | needs-reupload`. `applied` sólo cuando
el propietario confirmó **todas** las dependencias (incluida la evidencia confirmada).

MS05 **no** guarda tokens: el bearer llega en la petición, se usa para llamar al propietario y se
descarta. Al reconectar, el cliente restablece sesión y el servidor usa la autorización **vigente**.

Sin transacción global: DynamoDB conserva la intención y el resultado; el propietario confirma en su
base con su propia idempotencia. Si la respuesta del propietario se pierde, el reintento con el mismo
`operationId` devuelve replay y MS05 pasa la operación a `applied` sin duplicar.

### [S2.3] Separación de errores

| Situación | Código del propietario | Estado en MS05 | Qué ve el usuario |
| --- | --- | --- | --- |
| Conflicto de versión | `VERSION_CONFLICT` (409) | `conflict` | «el trabajo cambió, revisá y volvé a intentar» |
| Sin permiso / reasignado | `FORBIDDEN`, `EXECUTION_ACCESS_DENIED`, `EXECUTION_WORK_NOT_FOUND`, `EMPLOYEE_INACTIVE` | `rejected` | «ya no tenés acceso a este trabajo»; **no** se convierte en 409 ni revela datos de otro |
| Regla de negocio | `CHECKLIST_INCOMPLETE`, `EVIDENCE_STATE_CONFLICT`, `ALREADY_APPLIED` | `rejected` / `applied` | mensaje del catálogo público |
| Token caducado | 401 | la operación sigue `pending` | se renueva sesión y se reenvía |

### [S2.4] Archivos y predicción local

Evidencia encadenada y durable: `advance` → `evidence-authorize` (URL prefirmada) → `upload` (PUT
condicional) → `evidence-confirm`. Ninguna operación posterior se aplica si la anterior no está
`applied`; `needs-reupload` fuerza una nueva autorización cuando la URL expiró.

La inferencia local se envía como **inferencia del cliente**: `{origin:"client", runId, modelVersion,
imageSha256, labels[]}`. No se presenta como verificación del servidor ni cambia el estado del
modelo (que sigue `experimental`).

### [S2.5] Flutter

SQLite (`sqflite`) + directorio privado de archivos. Tablas `works`, `queue`, `blobs`, scoped por
`subject`; al cerrar sesión se borran cola y trabajos del usuario anterior y se invalida el modelo
preparado si cambió `runId`. Vigencia de preparación offline declarada (por defecto 7 días; al
vencer, el trabajo se muestra pero no se permite sincronizar sin revalidar).

### [S2.6] PWA del Shell

Service worker para recursos y modelo (`tfjs/`), IndexedDB para `works`, `blobs` y `queue`, con las
mismas reglas de separación por usuario. La conectividad (`navigator.onLine`) es sólo una señal: el
resultado real de cada petición decide si se puede sincronizar.

### [S2.7] Contrato público de MS05 (REST)

| Ruta | Uso |
| --- | --- |
| `POST /sync/overlays` | Registra un sobre con sus operaciones (idempotente por `operationId`) |
| `GET /sync/overlays/{overlayId}` | Estado del sobre y de cada operación |
| `POST /sync/overlays/{overlayId}/push` | Intenta aplicar las operaciones pendientes en orden de dependencias |
| `GET /sync/operations/{operationId}` | Replay/consulta de una operación |

## [S3] Out of Scope

Reservas de horario, confirmaciones de servicio y cobros offline: requieren validación en línea y no
se encolan. Sin detector de cambios del propietario (no hay push al cliente). Sin despliegue real en
AWS: la prueba usa DynamoDB Local y así se declara. Sin reentrenamiento ni promoción del modelo.

## Tasks

- [ ] T1: Contrato del sobre — acceptance: `contracts/sync/overlay.md` con campos, estados, códigos y reglas de idempotencia (covers: S2.1).
- [ ] T2: MS05 NestJS + DynamoDB con `POST /sync/overlays` y `GET` de consulta — acceptance: contra DynamoDB Local persiste y devuelve el sobre con sus operaciones (covers: S2.2, S2.7).
- [ ] T3: Maquinaria de push con dependencias y llamada al propietario con el token del usuario — acceptance: operación dependiente no se aplica antes que su predecesora (covers: S2.2, S2.4).
- [ ] T4: Mapa de errores del propietario (`conflict` vs `rejected` vs `pending` por 401) — acceptance: 409 y 403 quedan en estados distintos sin filtrar datos (covers: S2.3).
- [ ] T5: Cadena de evidencia con `needs-reupload` — acceptance: URL vencida provoca nueva autorización sin duplicar la evidencia (covers: S2.4).
- [ ] T6: Inferencia del cliente registrada como tal — acceptance: el resultado guarda `origin:client`, `runId`, `modelVersion` y hash (covers: S2.4).
- [ ] T7: Compose con DynamoDB Local y MS05 `healthy` — acceptance: `docker compose up` levanta ambos y `/health/ready` responde (covers: S2.2).
- [ ] T8: Flutter: SQLite + archivos privados + cola y sincronización — acceptance: recorrido completo en dispositivo con red cortada (covers: S2.5).
- [ ] T9: PWA: service worker + IndexedDB + cola — acceptance: recorrido completo en navegador con red cortada y recarga (covers: S2.6).
- [ ] T10: Verificación real de aceptación en ambas plataformas: persistencia tras reinicio, respuesta perdida sin duplicar, conflicto de versión y rechazo de autorización (covers: S2.3, S2.4, S2.5, S2.6).
