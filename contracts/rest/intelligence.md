# MS04 Inteligencia — REST (CU23)

Diseño aprobado en `docs/compose/spec/cu23-visual-intelligence.md`. La gestión web nunca llama a
este servicio: pasa por el BFF (`contracts/graphql/intelligence.graphql`). Este contrato es el del
propietario y el que consumen el propio BFF y los verificadores.

## Autorización

- `Authorization: Bearer <access token>` con firma RS256, `iss` exacto del realm, `typ=Bearer` y
  audiencia `autonexus-intelligence-api`. El token del usuario, nunca una cuenta técnica.
- Los permisos efectivos se resuelven en **Empleados** (`GET /security/permissions`) en cada
  petición, con caché de 30 s y **fallo cerrado**: sin respuesta válida no hay análisis.
- `intelligence:analyze` permite analizar; `intelligence:read` permite consultar.
- El permiso por registro no se hereda del token: para cada petición el servicio comprueba en
  **Operaciones** que el actor alcanza esa asignación (`GET /executions/me|team/:assignmentId`)
  antes de leer la evidencia o sus análisis. Un trabajo ajeno responde igual que uno inexistente.

## Rutas

| Método/ruta | Permiso | Respuesta |
| --- | --- | --- |
| GET /health/live | — | `{status:"UP",service:"intelligence"}` |
| GET /health/ready | — | `{status:"UP"\|"DOWN",mongo:"up"\|"down",model:{…}}`; 503 si Mongo o el modelo no están listos |
| GET /vision/model | autenticado | `{model, task, preprocessing, dataset, limits}` |
| POST /vision/analyze | intelligence:analyze | `VisionAnalysis` |
| POST /vision/client-analyses | intelligence:analyze | `ClientAnalysis` (inferencia del dispositivo; no verificada por el servidor) |
| GET /vision/analyses/:analysisId | intelligence:read | `VisionAnalysis` |
| GET /vision/assignments/:assignmentId | intelligence:read | `{assignmentId, items:[VisionAnalysis]}` |
| GET /vision/orders/:orderId?assignmentId= | intelligence:read | `{orderId, items:[VisionAnalysis]}` |

### Cuerpos

```
POST /vision/analyze
{ "assignmentId": UUID, "evidenceId": UUID }

POST /vision/client-analyses
{
  "assignmentId": UUID,
  "evidenceId": UUID,
  "runId": String,
  "modelVersion": String,
  "imageSha256": hex-SHA256,
  "labels": [{ "name": String, "score": Number }],
  "humanReview": { "modelVersion": String, "labels": [String] }?
}
```

Claves cerradas: cualquier propiedad adicional produce `400 VALIDATION_ERROR`. El servicio **no**
acepta bytes ni URL del cliente: descarga la evidencia desde la URL prefirmada que Operaciones
emite para ese actor y ese registro.

### Respuestas

`VisionAnalysis` = `{analysisId, assignmentId, evidenceId, orderId, modelVersion, task, labels:[{name,score,threshold,flagged}], flagged:[String], threshold, insufficientData, imageSha256, image:{width,height,contentType}, createdAt, replayed}`.

`ClientAnalysis` = `{analysisId, origin:"client", assignmentId, evidenceId, runId, modelVersion, imageSha256, labels:[{name,score}], humanReview?:{modelVersion,labels:[String],recordedAt}, createdAt, replayed, verifiedByServer:false}`. `labels` conserva únicamente la salida informada por el modelo del dispositivo; la corrección humana es un campo separado y debe referir al mismo `modelVersion`. `recordedAt` lo asigna MS04.

- `labels` conserva el orden del manifiesto; `flagged` son las etiquetas sobre su umbral.
- `insufficientData` es verdadero cuando la evaluación publicada no alcanza el mínimo declarado
  por etiqueta; el resultado sigue siendo una señal, no un veredicto.
- Repetir el análisis de la misma evidencia con el mismo modelo y los mismos bytes devuelve el
  documento existente con `replayed:true`; no crea duplicados. Para inferencias de cliente el replay
  también está acotado por actor y asignación, conservando la revisión humana original.

### Errores

| Situación | Código HTTP / código |
| --- | --- |
| Sin token válido | 401 `UNAUTHENTICATED` |
| Sin permiso del catálogo | 403 `FORBIDDEN` |
| Cuerpo inválido | 400 `VALIDATION_ERROR` |
| Artefacto del modelo ausente o ilegible | 503 `MODEL_NOT_READY` |
| Bytes no son JPEG/PNG válidos o imagen diminuta | 400 `IMAGE_INVALID` |
| Imagen por encima del límite aceptado | 413 `IMAGE_TOO_LARGE` |
| Evidencia inexistente, ajena o no `available` | 404/409 `EVIDENCE_NOT_AVAILABLE` |
| Asignación inexistente o ajena | 404 `ASSIGNMENT_NOT_FOUND` |
| Análisis inexistente | 404 `ANALYSIS_NOT_FOUND` |
| Empleados no responde o responde mal | 503 `SERVICE_UNAVAILABLE` |
| Mongo no disponible | 503 `PERSISTENCE_UNAVAILABLE` |

## Persistencia

MongoDB, base `autonexus_intelligence`, colección `vision_analyses`. Índices: único por
`analysisId`, único por `(origin, evidenceId, modelVersion, imageSha256)` para separar fuentes,
idempotencia de cliente por actor/asignación/evidencia/imagen/modelo, y `(orderId, createdAt)` /
`(assignmentId, createdAt)` para el histórico. Se guardan etiquetas, puntajes, umbrales, hash de la
imagen y metadatos de la evidencia. **Los bytes de la imagen no se persisten**: se procesan en
memoria y se descartan.

## Límites declarados

- No acepta bytes ni URLs del cliente; tampoco expone el bucket.
- Una sola imagen por petición; sin vídeo, sin OCR y sin detección de personas o placas.
- El modelo reconoce únicamente las etiquetas publicadas en su manifiesto
  (`contracts/ai/vision-model.md`); no infiere condiciones que no fueron entrenadas.
- `MODEL_NOT_READY` es un estado válido del despliegue, no una predicción vacía.
