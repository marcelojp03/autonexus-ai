# AutoNexus Agent (CU25)

Proceso interno de consulta. No aloja ni depende exclusivamente del servidor MCP: la fuente de
herramientas es intercambiable.

## Primera lectura financiera CU25 (2026-11-08)

El servicio HTTP añade autonexus_get_financial_summary, GET de Finance
/financial-summary con from/to explícitos, fechas civiles válidas y máximo31días.
FINANCE_API_URL habilita la capacidad; EMPLOYEES_API_URL permite comprobar
empleado activo vinculado y payments:read más expenses:read en catálogo y
ejecución. Finance reautoriza ese mismo bearer. No requiere roles mcp_read_*
ni concede por ellos permisos financieros; tampoco acuña una cuenta técnica.

Importes BOB como strings de centavos, cálculo propietario y comprobación
BigInt; faltante/contradicción no se convierte en cero. Cobros por día de
recordedAt convertido a La Paz; gastos por expenseDate. No cotizaciones como
ingreso, páginas parciales como total ni movimiento neto como rentabilidad/caja.

Esta consulta evita el LLM por completo. Respuesta y versión deterministas
cu25-financial-summary-v1, período, actualización y procedencia Finance visibles.
No es generación financiera CU26: su documento, trabajos, filtros/gráficos y
aceptación permanecen separados. Otras preguntas no ofrecen al modelo esta
herramienta. Registrar/pagar/anular/reembolsar/modificar dinero se rechaza.
El reporte operativo y los documentos/semanal existentes conservan su contrato.

Desde la raíz, con el stack y fixtures sintéticas autorizadas ya preparados:

```sh
node scripts/cu25/verify-financial-summary-real.mjs 2026-11-07 2026-11-08 etiqueta --ui
```

Requiere Node22.22.3, Docker y el Playwright del proyecto; no crea usuarios ni
cambia permisos. Lee credenciales dentro del proceso sin imprimirlas. Oráculo
Finance real, respuesta GraphQL/Shell, aclaración, rechazo de escritura,
denegación al mecánico y comparación de8tablas monetarias; artefactos privados
ignorados en output/agent y output/playwright. No aprobación visual por PNG.

## Reportes guardados y entrega semanal (2026-11-07)

El servicio corre como agent del Compose, sin puerto publicado, con OPERATIONS_URL y
EMPLOYEES_API_URL internos; Ollama externo sigue configurable mediante OLLAMA_URL. Cada lectura
o replay de reporte comprueba empleado activo y permisos actuales de agenda y ejecución en
Empleados, y reautoriza los assignmentId representados en Operaciones. El catálogo del JWT o
una agenda permitida no sustituyen esas comprobaciones. Un fallo no publica el documento.

CU28 usa POST /report/weekly/deliveries y POST /report/weekly/deliveries/{operationId}/ack,
descritos en contracts/rest/automations.md desde la raíz. El ledger en el subdirectorio
weekly-deliveries de REPORT_JOBS_DIR conserva primero la intención pendiente y luego copia el
reporte validado antes de enviarlo. Esa copia no sigue el sweep de los trabajos normales: fallo
de canal/reinicio/cambio de semana recupera el documento anterior, y sólo un ACK válido cierra
la entrega. Sin tokens persistidos ni generación ciega de trabajos terminales. Una sesión
delegada vencida exige restablecimiento; no se extiende por guardar un trabajo o una intención.

## Antecedente (2026-11-06)

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
