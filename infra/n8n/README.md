# infra/n8n

Exportaciones de flujos sin secretos ni credenciales.

## Programación CU28 — exportaciones nuevas (2026-11-07)

Tres workflows para n8n **2.46.6**, exportados **inactivos**. La aceptación local usó copias
`Proof` con temporizador real cada 30 s, empleado sintético y canal local, sin modificar el
receptor existente. Evidencia: `docs/evidence/cu28-catalogue-20261107.md` desde la raíz.

| Archivo en workflows/ | ID | Cron (segundo primero), America/La_Paz | Llamada |
| --- | --- | --- | --- |
| appointments-reminders-scheduled.json | cu28AppointmentReminders | 0 0 9 * * * | POST http://operations:8081/automations/appointments/reminders, cuerpo {} |
| quotes-pending-scheduled.json | cu28PendingQuotes | 0 0 * * * * | POST http://finance:8000/automations/quotes/pending, cuerpo {} |
| weekly-report-scheduled.json | cu28WeeklyReport | 0 0 9 * * 1 | POST http://agent:3099/report/jobs; GET /report/jobs/{jobId} |

Operaciones selecciona la próxima jornada civil con **su reloj**, revalida las citas y publica
su Outbox. Finanzas decide el umbral con **su reloj**, revalida estado/versión de las cotizaciones
y publica su Outbox. n8n no envía fechas ni listados a esos dos selectores; owner_accepted en
el audit significa solamente que el propietario aceptó la solicitud, no una entrega al canal.

### Consentimiento y autorización

Cada exportación referencia oAuth2Api con id **autonexusCu28Scheduler** y nombre
**AutoNexus CU28 delegated employee**. Es una referencia sin material secreto: aprovisionar la
credencial cifrada en n8n mediante **authorization_code + PKCE**, consentimiento interactivo de
empleado sintético activo y refresh automático de la credencial. No usar client_credentials,
tokens incrustados ni encabezados Authorization manuales. Si se usa otro ID, sustituirlo en
las referencias locales al importar, no copiar tokens al JSON.

Cliente previsto: autonexus-cu28-scheduler; roles mínimos mcp_read_team y cu28_read_due
(orders:read, agenda:read:team, executions:read:team, appointments:read, quotes:read),
audiencias de los propietarios correspondientes. Cada POST y cada GET se autoriza en servidor;
recuperar una entrega pendiente vuelve a consultar el mismo trabajo con esa credencial antes
de publicar. 401/403 y revocación fallan cerrados, sin resumen vacío ni evento de éxito.
Un cron activo no garantiza que la sesión siga vigente en su próximo disparo diario/semanal:
la duración/idle/max session del IdP se conserva, no se amplía para esta entrega. Si ha vencido,
se registra error y se necesita restablecer la delegación explícitamente. La aceptación abreviada
no acredita operación desatendida durante días ni renovación infinita de la sesión.

### Reporte semanal, recuperación y auditoría

La semana es la anterior **lunes–domingo civil**, no los últimos siete días. Los IDs son UUIDv8
deterministas: prefijo a0280001-0000-8000-8000-, lunes YYYYMMDD y sufijo 0001 para operationId,
0002 para eventId. El inicio civil determina unívocamente el período; no dependen de ejecución,
reintento ni credencial. El agente persiste el trabajo y deduplica el POST por operationId.

El agente conserva un ledger propio en agent-jobs/weekly-deliveries, sin tokens. Antes de
seleccionar la semana candidata, n8n adquiere POST /report/weekly/deliveries: el agente devuelve
primero una intención pendiente anterior del mismo empleado, con su período e IDs originales.
Con jobId conocido no vuelve a crear el trabajo: consulta ese ID y espera **5 segundos** entre
lecturas. Al terminar vuelve a adquirir para guardar una copia inmutable del documento en el
ledger ANTES del envío. Esa copia no depende de la retención normal de trabajos ni del estado
estático de un workflow fallido. Hay presupuesto de **10 minutos** por ejecución y timeout HTTP
de 20 s. Estados failed/interrupted y un jobId fijado ausente requieren revisión, sin generación
nueva ciega. No se generan automáticamente todas las semanas omitidas.

Al terminar, data contiene el documento completo por campos cerrados: report, period,
generatedAt, promptVersion, figures, claims, provenance, references, limitations, financialData,
narrative (incluidos path, verified y generative), más jobId y operationId. La plantilla conserva
path=deterministic/generative=false; n8n no escribe narración ni la convierte en evidencia LLM.
El evento es automation.weekly.report.generated.v1 y se publica solamente en
http://n8n:5678/webhook/cu28-execution-review con x-autonexus-secret leído de
CU28_WEBHOOK_SECRET. Se requiere el acceso a esa variable ya usado por el receptor
(N8N_BLOCK_ENV_ACCESS_IN_NODE=false). No se envían mensajes externos.

El transporte reintenta hasta tres veces el **mismo sobre**. Sin recibo, la intención sigue pending
en el agente incluso después de reiniciar n8n/agente y proponer otra semana. Sólo recorded/duplicate
con el mismo eventId permite POST /report/weekly/deliveries/{operationId}/ack. El ACK reautorizado
marca delivered durable e idempotente; si se pierde el ACK, se repite el mismo evento y el canal
deduplica. La siguiente adquisición de una semana ya entregada no vuelve a enviarla. Restaurar
el consentimiento no convierte un trabajo terminal en uno nuevo. Static data es sólo audit de
observación, nunca autoridad de pending. Cada documento reautoriza agenda y ejecuciones por registro.

Todos los flujos usan saveDataSuccessExecution=none, saveDataErrorExecution=none,
saveManualExecutions=false y saveExecutionProgress=false. Los errores pasan a un código cerrado
CU28_* y terminan la ejecución con error. El nodo prepara lastResult con status, failureCode,
executionId y observedAt, sin cuerpos HTTP, cabeceras ni credenciales. No se promete que n8n
persista esa mutación estática al fallar: en la aceptación los selectores no publicaron un
lastResult durable. La evidencia de fallo usa metadatos nativos de ejecución (workflowId,
mode=trigger, status=error, fechas), no un lastResult previo como si fuera actual. La entrega
se coteja contra el Outbox propietario y el canal; el semanal sí conservó jobId/período y recibo
duplicate en estado estático. No habilitar logs completos para diagnosticar autenticación.

### Construcción y verificaciones locales

Desde la raíz, sin dependencias adicionales:

~~~sh
node scripts/n8n/build-scheduled.mjs
node scripts/n8n/build-scheduled.mjs --check
node --test scripts/n8n/scheduled.test.mjs
~~~

El constructor solo escribe las tres exportaciones nuevas y embebe las funciones exportadas
de scheduled-functions.mjs; las pruebas ejecutan esas mismas funciones y nodos Code compilados,
verifican cron, credenciales, grafo, errores, límites y recuperación. No añaden APIs de prueba.
Se consultaron en modo lectura las descripciones ScheduleTrigger, Wait y HttpRequest del
contenedor 2.46.6. Esto no acredita consentimiento, disparo real de temporizador ni entrega real.

## Antecedente: estado (2026-11-05)

Instancia local propia `cu16-proof-n8n-1` con `docker.n8n.io/n8nio/n8n:2.46.6` fijada por digest
(`sha256:8602f5dfacbe2c931eeafd010de0e68182310e9f309921e780ab69182e92b3ae`), publicada solo en
`127.0.0.1:5678`, `cap_drop: ALL`, `no-new-privileges` y volumen propio `n8n-data`. `/healthz` 200.
La clave de cifrado y el puerto viven en un archivo privado ignorado; ningún secreto entra al
repositorio ni al workflow.

`workflows/orders-agenda-summary.json` es el primer flujo: disparador manual → `GET /orders`,
`GET /agenda/team` y un nodo Code que resume conteos y avances por trabajo. Es solo lectura: no
crea, modifica, envía avisos ni usa LLM. No depende del servidor MCP.

Importación real verificada por CLI: `n8n import:workflow` exit 0 y `n8n list:workflow` muestra el
flujo `E8ystehdinzop4fl` **inactivo**. Comando comprobado:

```sh
docker cp infra/n8n/workflows/orders-agenda-summary.json cu16-proof-n8n-1:/tmp/wf.json
docker exec cu16-proof-n8n-1 n8n import:workflow --input=/tmp/wf.json
docker exec cu16-proof-n8n-1 n8n list:workflow
```

## Ejecución real observada (2026-11-06)

El consentimiento OAuth2 se completó con la cuenta sintética `chief` usando
`scripts/n8n/consent.mjs`, que valida cliente, redirección, `state` e `iss` antes de canjear el
código. La credencial quedó cifrada por n8n en su volumen; el archivo privado con tokens vive en
`output/mcp-read/fixture/` y no se versiona.

`E8ystehdinzop4fl` se ejecutó por CLI en un contenedor aislado sobre la red `cu16-proof_default`
(`--entrypoint n8n … execute --id=… --rawOutput`, con `N8N_RUNNERS_ENABLED=false` para no chocar
con el broker del proceso principal): dos corridas `success` con resumen idéntico (2 órdenes
`confirmed`, 2 trabajos `in_progress`), sin duplicados. La variante con intervalo invertido terminó
en `error` con HTTP 400 del propietario y sin resumen. El token delegado se renovó por
`refresh_token` después de vencer el access token inicial.

Detalle y requisitos pendientes: `docs/evidence/cu28-20261106.md`.

## Pendiente para ejecutar

La credencial OAuth2 del cliente confidencial `autonexus-n8n-reader` exige un primer
consentimiento interactivo en el navegador (PKCE, redirect
`http://127.0.0.1:5678/rest/oauth2-credential/callback`). Hasta completarlo **no** se acredita
ejecución real del flujo. Crear la credencial desde la UI con el id/secret del archivo privado,
reemplazar el `id` de credencial en el JSON exportado y ejecutar el flujo manualmente.

## Destinatarios del canal de aceptación

El receptor `cu28ExecutionReview` autentica antes de validar `x-autonexus-destination`.
Es un ID local, por defecto `workshop`, no una dirección externa. El canal de
`scripts/cu28/channel.mjs` usa `CU28_CHANNEL_DESTINATIONS=workshop` por defecto, recibe
`/destinations/{id}/channel` y conserva `/channel` como alias. `CU28_CHANNEL_FILE` debe
seguir apuntando al mismo JSONL: no vaciar/rotar el archivo para demostrar deduplicación.

Un destino no registrado devuelve 404 `CU28_RECIPIENT_NOT_FOUND`, auditado sin cuerpos
ni cabeceras y nunca recordado como delivered. El recibo válido debe coincidir en
estado, evento y destino. Evidencia de dos rechazos reales, repetición del destino válido
y preservación de negocio/Outbox: `docs/evidence/cu28-recipient-local-20261107.md`.
La suite acotada es `node --test scripts/cu28/destination.test.mjs` desde la raíz; sus
dobles de nodos no sustituyen el replay real. No requiere enviar mensajes externos.

## Límites del antecedente manual

En ese antecedente no había flujo programado ni por evento: los contratos de agenda y ejecuciones exigen empleado activo
vinculado, así que una identidad técnica sin vínculo laboral no puede consultarlas y no se abre una
excepción. Sin avisos, sin RabbitMQ nuevo, sin escrituras empresariales y sin declarar CU28 completo.
