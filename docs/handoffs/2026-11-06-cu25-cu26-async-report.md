# Continuidad — CU25/CU26 como reporte asíncrono, contrato conciliado y verificación en el Shell

Estado al 2026-11-06, HEAD `73faf56` publicado en `main` y `work/marcelo`.
- Fecha y responsable/bloque: 2026-11-06, Marcelo (bloque 1).
- Rama y commit: `work/marcelo` y `main`, `73faf56` (ambas refs verificadas con `ls-remote`). Incremento anterior de CU28: `edab49e`.

## CU y objetivo

CU25 (asistente con LLM) y CU26 (reporte narrativo) desde el Shell, con generación asíncrona. **Ambos
siguen parciales**: el asistente es un proceso local en *loopback* y no se declara calidad del modelo.

## Archivos cambiados

- `contracts/graphql/assistant.graphql`: `OperationsReportJob`, `OperationsReportJobStatus`,
  `startOperationsReport`, `operationsReportJob`.
- `contracts/auth/session.ts` y `web/browser-auth/session.ts`: `requestBusiness` acepta `timeoutMs` por
  solicitud (130 s para el turno del asistente, tope 180 s).
- `integration/agent`: `report/jobs.ts`, `report/job-runner.ts`, `report/contract.ts`,
  `scripts/check-report-contract.mjs`, rutas `POST /report/jobs` y `GET /report/jobs/{jobId}`,
  `publishedAnswer` (DTO del contrato), `think:false` por omisión, `OWNER_TIMEOUT_MS` 20 s.
- `integration/bff`: `startReport`/`reportJob` y la proyección del trabajo, con códigos de término
  traducidos por el BFF; permisos `executions:read:team` para las tres raíces del reporte.
- `web/mf-employees/src/app/features/assistant`: trabajo asíncrono, sondeo, recarga, exportación JSON y
  CSV; campos del formulario como señales.
- `infra/local/nginx.conf`: 130 s de lectura para `/graphql`. `compose.yaml`: `ASSISTANT_API_URL`.

## Comportamiento implementado

Reporte como trabajo con `operationId` del cliente: creación en milisegundos, estado y resultado por
GraphQL, recarga que retoma el mismo `jobId`, documento terminado persistido en `output/agent/jobs` y
token nunca escrito. Autorización vencida durante la generación ⇒ `AUTHORIZATION_EXPIRED`, sin reinicio
ciego. Cada lectura verifica token y pertenencia. El servicio publica el DTO del contrato (antes publicaba
su registro interno) y la llamada al modelo pide sólo la respuesta.

## Comandos ejecutados y resultados

- Agente: `pnpm build` y `node --test tests/*.test.mjs` → **79/79**.
- BFF: `pnpm test` → **196/196**; `pnpm typecheck` → 0.
- Microfrontend: `ng test --watch=false --headless` → **49/49**; `tsc -p tsconfig.app.json --noEmit` → 0.
- Shell: `node --test tests/*.test.mjs` → **104/104**; `tsc` → 0.
- Contrato real: `check-report-contract.mjs` con token → **0 violaciones**, `totalWorks: 2`, 8 `claims`.
- Cadena real asíncrona: `output/agent/async-report-e2e.mjs` → `SUCCEEDED`, 0 violaciones.
- Navegador real: siete escenarios en `output/agent/ui/ui-*.json`.
- Auditoría `edab49e..73faf56`: 1 commit, 31 rutas, `findings: []`.

## Contratos/decisiones modificados

`docs/decisions/026-cu25-cu26-trabajo-asincrono.md`. El SDL del asistente crece con el trabajo; la
alternativa (una sola petición de 90 s) quedó descartada por los tres presupuestos del borde.

## Pendientes y bloqueos

- CU28 conserva los otros cuatro flujos, la programación con identidad técnica y los avisos externos.
- El asistente vive en el host y el BFF en contenedor (`host.docker.internal`): arreglo de prueba local.
- El token de 60 s puede vencer durante un turno largo con herramientas; la interfaz informa sesión
  inválida y el lector reintenta (no hay reintento automático del mismo token, por diseño).
- `OWNER_TIMEOUT_MS` y `OLLAMA_THINK` son configuración de entorno: documentar si cambian por máquina.

## Próximo paso concreto

Reconciliar cualquier consumidor del SDL del asistente (no hay otro hoy) y continuar con CU30/CU31 según
el orden del usuario; antes, decidir si el asistente pasa a contenedor para dejar de depender del host.

## Datos que la siguiente sesión debe leer

`docs/evidence/cu25-cu26-shell-20261106.md`, `docs/evidence/cu28-20261106.md`,
`docs/decisions/026-cu25-cu26-trabajo-asincrono.md` y `docs/context/STATUS.md` (§ CU25/CU26 y § CU28).
