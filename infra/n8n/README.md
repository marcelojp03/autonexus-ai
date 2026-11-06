# infra/n8n

Exportaciones de flujos sin secretos ni credenciales.

## Estado (2026-11-05)

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

## Límites

Ningún flujo programado ni por evento: los contratos de agenda y ejecuciones exigen empleado activo
vinculado, así que una identidad técnica sin vínculo laboral no puede consultarlas y no se abre una
excepción. Sin avisos, sin RabbitMQ nuevo, sin escrituras empresariales y sin declarar CU28 completo.
