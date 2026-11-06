# AutoNexus Agent (CU25)

Proceso interno de consulta. No aloja ni depende exclusivamente del servidor MCP: la fuente de
herramientas es intercambiable.

## Estado (2026-11-06)

Implementado en TypeScript con Node 22.22.3 y `@modelcontextprotocol/client` 2.4.0. Dos fuentes:

- `mcp` — cliente MCP oficial contra `http://127.0.0.1:3006/mcp` con PKCE del cliente
  `autonexus-mcp-local-reader`.
- `rest` — llamadas directas a Operaciones con el cliente confidencial `autonexus-n8n-reader`.

Planificador determinista (sin modelo de lenguaje): pasada de seguridad (escritura, roles,
permisos, envíos, SQL) y luego intención → una herramienta autorizada. Respuesta compuesta solo con
campos conocidos del resultado real; un fallo del propietario se informa como error.

## Comandos comprobados

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node dist/main.js --query "¿Qué trabajos pendientes hay esta semana?" --source mcp --account chief
node dist/main.js --query "¿Cuántas órdenes hay y en qué estado?" --source mcp --account chief
node dist/main.js --query "Listame todas las órdenes del taller" --source mcp --account mechanicA
node --test tests/planner.test.mjs
```

Las identidades son sintéticas y provienen de los fixtures privados locales; el asistente no lee ni
imprime tokens. La auditoría se escribe en `output/agent/audit.jsonl` (ignorada) con actor, fuente, herramienta,
resultado, duración y un SHA-256 de la consulta; nunca el texto de la consulta, tokens ni cuerpos.

## Reporte y trabajos (CU26)

POST /report devuelve el documento completo (cifras deterministas, afirmaciones, procedencia y
narrativa). Como la generación tarda minutos, POST /report/jobs crea un trabajo con el
operationId del cliente y GET /report/jobs/{jobId} publica estado y documento: repetir la
creación con el mismo identificador devuelve el mismo trabajo y no genera otra vez. El documento
terminado se guarda en output/agent/jobs (retención de 50); el token del usuario nunca se escribe,
así que un trabajo interrumpido por un reinicio se cierra como interrupted y no se reanuda.

## Límites

Solo lectura: no ejecuta CU30, no administra clientes (CU31) y el reporte no incluye datos
financieros. El planificador determinista no es un LLM y no amplía alcances por inferencia. El camino
REST cubre órdenes, agenda de equipo y ejecución de equipo. Sin despliegue cloud.
