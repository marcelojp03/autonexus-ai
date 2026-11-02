# Contrato de sincronización offline (MS05)

Diseño aprobado en `docs/compose/spec/offline-sync.md`. Aplica a la app Flutter y a la PWA del Shell.

## Principio

MS05 **coordina**: guarda la intención del cliente, la envía al propietario con el token del propio
usuario y conserva el resultado. **No** aplica reglas de negocio ni escribe en las bases de los
propietarios. Cada propietario valida permisos, reglas e idempotencia en su propia base. No existe
transacción global DynamoDB + PostgreSQL + MongoDB.

La unidad de idempotencia es la **operación**, no el lote. Un `overlayId` nuevo puede contener una
operación ya aplicada: el propietario la reconoce por su `operationId` y responde replay.

## Sobre

```json
{
  "overlayId": "UUID",
  "deviceId": "string (1..64)",
  "createdAt": "ISO-8601",
  "operations": [
    {
      "operationId": "UUID",
      "entity": "advance",
      "target": { "assignmentId": "UUID", "advanceId": "UUID?" },
      "baseVersion": 3,
      "dependsOn": ["UUID"],
      "payload": { "...": "cuerpo del propietario" },
      "file": { "sha256": "hex", "bytes": 39808, "contentType": "image/jpeg" },
      "clientInference": {
        "runId": "20261101T-with-negatives",
        "modelVersion": "automotive-damage-mobilenetv2-v1",
        "imageSha256": "hex",
        "labels": [{ "name": "scratch", "score": 0.47 }]
      }
    }
  ]
}
```

- `subject` **no** se envía: lo toma el servidor del token. Cualquier campo de identidad en el cuerpo
  se rechaza (`400 VALIDATION_ERROR`).
- `entity` ∈ `advance` | `evidence-authorize` | `evidence-confirm` | `client-inference`.
- `dependsOn` sólo puede referenciar operaciones del **mismo** sobre; un ciclo o una referencia
  inexistente produce `400 VALIDATION_ERROR`.
- Claves cerradas en todos los niveles: un campo desconocido invalida la petición.

## Estados de una operación

| Estado | Significado |
| --- | --- |
| `pending` | Guardada, sin intentar o con el token caducado (401) |
| `sending` | En curso contra el propietario (marca de intento) |
| `applied` | El propietario confirmó el efecto (o replay del mismo `operationId`) |
| `needs-reupload` | La autorización de carga caducó: hace falta una nueva antes de confirmar |
| `conflict` | El propietario respondió conflicto de versión (`409`) |
| `rejected` | El propietario rechazó por regla, permiso o registro ajeno; se conserva el código |

Estados terminales: `applied`, `conflict`, `rejected`. `needs-reupload` y `pending` no lo son.

## Códigos y su clasificación

| Código del propietario | HTTP | Estado MS05 |
| --- | --- | --- |
| `VERSION_CONFLICT` | 409 | `conflict` |
| `IDEMPOTENCY_CONFLICT` | 409 | `conflict` |
| `FORBIDDEN`, `EXECUTION_ACCESS_DENIED`, `EXECUTION_WORK_NOT_FOUND`, `EMPLOYEE_INACTIVE`, `ASSIGNMENT_NOT_FOUND` | 403/404 | `rejected` (se conserva `code` y `status`) |
| `CHECKLIST_INCOMPLETE`, `EVIDENCE_STATE_CONFLICT`, `EVIDENCE_ATTEMPTS_EXHAUSTED`, `VALIDATION_ERROR` | 400/409 | `rejected` |
| `UNAUTHENTICATED` / 401 | 401 | sigue `pending` (se renueva sesión y se reintenta) |
| `EVIDENCE_STORAGE_UNAVAILABLE`, `PERSISTENCE_UNAVAILABLE`, `SERVICE_UNAVAILABLE` | 503 | sigue `pending` con intento registrado |

Un rechazo por acceso **no** se convierte en `409` ni revela datos del trabajo ajeno: la respuesta es
la misma que daría el propietario.

## Archivos

Cadena obligatoria y durable para una evidencia con fotografía:

1. `advance` — registra el avance (o su replay).
2. `evidence-authorize` — obtiene la URL prefirmada y el `evidenceId`.
3. *carga* — `PUT` del archivo a la URL con las cabeceras exactas devueltas.
4. `evidence-confirm` — confirma con `expectedVersion`.

Reglas: una operación no se aplica si alguna de sus `dependsOn` no está `applied`. La carga no la hace
MS05 (el archivo no viaja a DynamoDB); el cliente la ejecuta y luego pide la confirmación. Si la URL
caducó, el propietario responde con error de estado de evidencia y MS05 marca `needs-reupload`,
conservando el `evidenceId` para no crear otra evidencia.

## Inferencia del cliente

Se envía con `entity: "client-inference"` y el bloque `clientInference`. MS05 lo reenvía a
Inteligencia (`POST /vision/client-analyses`), que lo guarda como **inferencia del cliente**: no es
una inferencia del servidor, no crea estado de modelo y conserva `runId`, `modelVersion` y hash de la
imagen. El aviso de capacidad experimental se mantiene en la interfaz.

## Identidad y sesión

- El bearer **nunca** se guarda en DynamoDB ni en la cola del cliente. Llega en cada petición y se
  usa para llamar al propietario; MS05 no lo persiste.
- Al reconectar, el cliente restablece sesión (PKCE) y reintenta con el token vigente.
- Si el propietario cambia el resultado porque el permiso ya no existe, ese rechazo se conserva: no
  se reintenta automáticamente ni se borra el pendiente.

## API REST de MS05

| Método | Ruta | Cuerpo | Respuesta |
| --- | --- | --- | --- |
| POST | `/sync/overlays` | sobre completo | `{overlay, replayed}`; 201 si es nuevo, 200 si el `overlayId` ya existía |
| GET | `/sync/overlays/:overlayId` | — | `{overlay}` con el estado de cada operación |
| POST | `/sync/overlays/:overlayId/push` | — | `{overlay, applied, pending, failed}` |
| GET | `/sync/operations/:operationId` | — | `{operation}` (replay/consulta) |

Autorización: token válido con cualquier rol reconocido; el sobre pertenece al `sub` del token y
**ningún** subject puede leer ni empujar sobres de otro (404 indistinguible).

## Vigencia y limpieza

MS05 conserva sobres y operaciones con `expiresAt` (por defecto 30 días) para permitir consulta y
replay; DynamoDB aplica TTL. El cliente declara su propia vigencia de preparación offline (7 días por
defecto) y, al vencer, exige revalidar antes de empujar.

## Fuera de alcance

Reservas, confirmaciones de servicio y cobros offline. Push del servidor al cliente. Despliegue real
en AWS: la verificación usa DynamoDB Local y no acredita despliegue en la nube.
