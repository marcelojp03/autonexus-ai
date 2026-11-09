# CU26 — Reporte financiero separado del operativo (S2.15)

Fecha: 2026-11-08 · Rama: `work/marcelo` · Alcance: tipo de reporte financiero de extremo a extremo
(servicio del asistente → contrato → BFF → microfrontend), sin tocar el reporte operativo ni CU28.

Estado honesto: **implementado y verificado con pruebas automatizadas en este host**. No se ejecutó el
recorrido real contra Finance ni se desplegaron contenedores desde esta rama; eso queda para la
integración en `main`, que es quien hace la aceptación real con el oráculo de Finance y la revisión
independiente.

## Qué se construyó

| Capa | Archivo | Qué aporta |
| --- | --- | --- |
| Servicio | `integration/agent/src/report/financial-report.ts` | Documento `financial-narrative`, centavos string, cálculo del servidor, redacción verificada, checker propio |
| Servicio | `integration/agent/src/report/financial-authorization.ts` | Autorización propia: empleado vigente + `payments:read` + `expenses:read` frescos |
| Servicio | `integration/agent/src/report/financial-jobs.ts` | Almacén y directorio propios (`financial-jobs/`) bajo `REPORT_JOBS_DIR` |
| Servicio | `integration/agent/src/server.ts` | Rutas propias `POST /report/financial/jobs`, `GET /report/financial/jobs/{jobId}` |
| Contrato | `contracts/graphql/assistant.graphql` | Tipos y campos nuevos (sólo adiciones) |
| BFF | `integration/bff/src/application/assistant-gateway.ts` | Proyección campo por campo con comprobación BigInt; códigos de fallo propios |
| BFF | `integration/bff/src/application/business-graphql.ts` | Resolución de los dos campos nuevos, **sin** `executions:read:team` |
| UI | `web/mf-employees/src/app/features/assistant/financial.contract.ts` | Tipos, formato BOB con BigInt, exportación JSON/CSV, textos de límites |
| UI | `web/mf-employees/src/app/features/assistant/assistant-financial.component.{ts,html}` | Sección financiera: período, generar, polling, cifras, claims, procedencia, límites, exportación |
| UI | `assistant-api.ts`, `assistant.component.{ts,html}` | Transporte GraphQL y montaje de la sección en el asistente existente |
| Pruebas | `integration/agent/tests/financial-report.test.mjs` | 12 pruebas del tipo financiero |
| Pruebas | `web/mf-employees/src/app/features/assistant/financial-contract.spec.ts` | 8 pruebas de contrato/exportación/formato |

## Contrato introducido (nombres exactos)

Documento del servicio (`POST/GET` financieros → `report`):

- `report` = `"financial-narrative"` (discriminador propio), `reportVersion` = `cu26-financial-report-v1`
- `period { from, to, timeZone }`, `generatedAt` (instante de cálculo del propietario), `promptVersion`
- `figures { receivedMinor, expenseMinor, netMinor, currency, paymentCount, expenseCount, complete }` —
  los tres importes son **string canónico de centavos BOB**; `paymentCount`/`expenseCount` son enteros
- `claims[{ indicator, label, value, unit, period, source, tool, recordRefs }]` — `value` es **string**
  (centavos o entero decimal), `unit` es `centavos BOB` / `cobros` / `gastos`, `source` = `finance`
- `narrative { text, path, model, verified, generative }`, `references`, `provenance`, `limitations`

Indicadores estables: `finance.receivedAmountMinor`, `finance.expenseAmountMinor`,
`finance.netMovementMinor`, `finance.paymentCount`, `finance.expenseCount`.

Trabajo: `{ jobId, status, period, requestedAt, startedAt, finishedAt, report?, failure? }` + `reused`
en la creación.

GraphQL (sólo adiciones, sin modificar `OperationsReport`/`OperationsFigures`/`ReportClaim`):

- `type FinancialFigures { receivedMinor: String! expenseMinor: String! netMinor: String!
  currency: String! paymentCount: Int! expenseCount: Int! complete: Boolean! }`
- `type FinancialClaim { indicator label value: String! unit period source tool recordRefs }`
- `type FinancialReport { period generatedAt narrativePath model narrativeVerified promptVersion
  narrative figures claims references provenance limitations }`
- `enum FinancialReportJobStatus { QUEUED RUNNING SUCCEEDED FAILED INTERRUPTED }`
- `type FinancialReportJob { jobId status period requestedAt startedAt finishedAt report failureCode
  failureMessage }`
- `Query.financialReportJob(jobId: ID!)`, `Mutation.startFinancialReport(from, to, operationId)`

Ningún importe se publica como `Int` de GraphQL ni como `number` de TypeScript.

Códigos de fallo del trabajo financiero: `FINANCIAL_ACCESS_DENIED`, `FINANCIAL_AUTHORIZATION_UNAVAILABLE`,
`FINANCIAL_SOURCE_UNAVAILABLE`, `FINANCIAL_SUMMARY_UNAVAILABLE`, `FINANCIAL_SUMMARY_INVALID`,
`FINANCIAL_PERIOD_MISMATCH`, `INCOHERENT_FINANCIAL_FIGURES`, `INVALID_FINANCIAL_CONTRACT`,
`OPERATION_CONFLICT`, además de `AUTHORIZATION_EXPIRED`, `FORBIDDEN`, `INTERRUPTED_BY_RESTART`,
`QUEUE_FULL`, `INVALID_PERIOD`, `INTERNAL_ERROR`.

Códigos de limitación del documento: `movimiento_neto_no_es_rentabilidad_ni_saldo_bancario`,
`solo_cobros_y_gastos_registrados_del_periodo_no_obligaciones_ni_cotizaciones`,
`sin_filtro_por_categoria_empleado_o_indicador_el_propietario_no_los_publica`,
`financial_narrative_model_disabled`, `financial_narrative_model_unavailable:<código>`,
`financial_narrative_too_short`, `financial_narrative_rejected_profitability_claim`,
`financial_narrative_rejected_claim_binding:<problemas>`, `financial_narrative_template_unverified:<problemas>`.

## Decisiones de cumplimiento

1. **Dinero.** Centavos como string canónico en el propietario, en el documento, en GraphQL y en la UI.
   `received − expense === net` se comprueba con `BigInt` tres veces: en el documento del servicio, en el
   checker de contrato propio y en la proyección del BFF. La UI formatea con `BigInt` (`moneyText`).
2. **Autorización propia.** `createFinancialAuthorizer` lee `Employees /security/permissions` sin caché
   con el bearer del llamante y exige `employeeStatus=active`, `employeeId` UUID y **ambos**
   `payments:read` + `expenses:read`. No usa `executions:read:team`, no acepta roles `mcp_read_*` y no
   acuña identidad. Se ejecuta al crear, al ejecutar el trabajo y en **cada** lectura/replay del
   documento guardado; un permiso revocado responde 403 sin publicar cifras.
3. **Trabajos aislados.** Rutas `/report/financial/jobs…` distintas de `/report/jobs…`, almacén propio en
   `<REPORT_JOBS_DIR>/financial-jobs/` y runner propio. Mismo `subject`+`operationId` devuelve el mismo
   `jobId` y el mismo documento; el mismo identificador con otro período responde 409
   `OPERATION_CONFLICT`. El token nunca se persiste: un trabajo abierto al reiniciar se marca
   `interrupted` y no se reanuda.
4. **Documento y checker propios.** Discriminador `financial-narrative` y `checkFinancialReportContract`,
   separado de `checkReportContract` (que valida enteros y no aplica aquí). Dato ausente del propietario
   falla el trabajo (`FINANCIAL_SUMMARY_UNAVAILABLE`/`FINANCIAL_SUMMARY_INVALID`); un cero auténtico se
   publica como `"0"` y se prueba explícitamente.
5. **Cálculo y redacción separados.** Las cifras salen del resumen del propietario. El LLM sólo redacta:
   se ligan cada importe y cada conteo a su indicador y se exige que aparezcan los **tres importes**;
   también se rechaza vocabulario de rentabilidad/caja/saldo. Si el modelo está caído o no conforma, se
   publica la plantilla `deterministic` con `model: null`, `generative: false` y un código en
   `limitations`. La limitación de que el movimiento neto no es rentabilidad ni saldo viaja **siempre**
   en el documento (el checker la exige).
6. **UI.** Sección propia en el microfrontend de Empleados existente (misma ruta y sesión del Shell, sin
   duplicar navegación): `desde`/`hasta` explícitos, `operationId` del cliente en `sessionStorage`
   (`anx.cu26.financial.job`), polling, cifras separadas (recibido, gastos, diferencia registrada) con
   formato BOB, tabla de afirmaciones, procedencia, limitaciones y exportación JSON/CSV de este documento.
   Declara que no hay filtro por categoría/empleado/indicador porque el propietario no los publica.
7. **Compatibilidad.** No se modificó ningún tipo operativo ni la entrega semanal CU28; la suite completa
   del servicio del asistente sigue verde (148/148) y las pruebas del reporte operativo están incluidas.

## Verificación ejecutada (host, Node `C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe`)

| Comando | Resultado |
| --- | --- |
| `tsc -p integration/agent/tsconfig.json` | exit 0 (`output/cu27/cu26-fin-agent-build5.exit`) |
| `node --test "integration/agent/tests/*.test.mjs"` | exit 0, **148 pruebas / 148 pasan** (`cu26-fin-agent-all3.*`) |
| `node --test integration/agent/tests/financial-report.test.mjs` | exit 0, **12 / 12** (ejecutado en primer plano, sin launcher) |
| `tsc --noEmit -p integration/bff/tsconfig.json` | exit 0 (`cu26-fin-bff-typecheck2.exit`) |
| `vitest run --root integration/bff src/application/assistant-gateway.spec.ts` | exit 0, **28 / 28** (`cu26-fin-bff-tests.*`) |
| `vitest run --root web/mf-employees src/app/features/assistant` | exit 0, **14 / 14** (`cu26-fin-mf-tests.*`) |
| `ng build --configuration development` (mf-employees) | exit 0, bundle generado en 379 s (`cu26-fin-mf-build.*`): el componente y su plantilla compilan en AOT |

Logs y códigos de salida en `output/cu27/` con el prefijo `cu26-fin-`.

## Lo que NO está hecho (declarado, no oculto)

- **Sin aceptación real contra Finance**: no se llamó `GET /financial-summary` de un Finance desplegado,
  ni se comparó con su oráculo, ni se ejecutó el recorrido desde el Shell en el navegador. Las pruebas
  usan dobles controlados del propietario y el camino de bearer ya aprobado en CU25.
- **Sin generación real observada con Ollama**: el camino `llm` se prueba con un modelo controlado
  (conforme, no conforme y caído). No se acredita precisión del modelo ni se calentaron modelos.
- **Sin despliegue**: no se reconstruyeron contenedores ni se recreó el volumen de trabajos; el
  `INTERRUPTED` al reiniciar está probado a nivel de almacén/runner, no tras `--force-recreate`.
- **Sin filtros por categoría/empleado/indicador**: el resumen del propietario no los publica y la
  interfaz lo declara en lugar de simularlos.
- **No se actualizaron** `docs/context/STATUS.md`, `PLAN.md` ni `docs/ai/HANDOFF.md`: lo hace `main`.

## Desviaciones respecto de S2.15 y su justificación

1. **`integration/bff/src/application/business-graphql.ts` y su spec fuera de la lista de archivos
   permitidos.** La cláusula pide superficie GraphQL y proyección del BFF; sin registrar los dos campos en
   el resolutor, los tipos del contrato no serían alcanzables y el esquema quedaría declarativo. La
   adición es mínima (dos entradas en el mapa de permisos con valor `null` —autorización de empleado, no
   de módulo— y dos resolutores) más los dos dobles del spec existente, que el cambio de interfaz
   obligaba a completar. No se tocó ninguna otra capacidad del BFF ni del servicio operativo.
2. **No se añadió `GET /report/financial/…` síncrono.** S2.15 nombra explícitamente las rutas de trabajo
   (`POST /report/financial/jobs`, `GET /report/financial/jobs/{jobId}`) y su equivalente GraphQL; un
   endpoint síncrono adicional habría duplicado la generación sin pedirlo el contrato.
3. **`references` del documento financiero va vacío.** El resumen del propietario agrega cobros y gastos y
   no publica identificadores de registro; inventar referencias habría sido peor que declarar el vacío.
   La procedencia sí nombra `finance` + `/financial-summary` + herramienta + instante del propietario.

## Nota de estado del árbol

En el árbol de trabajo aparecen además cambios en `web/mf-finance/**` y `web/shell/**` que **no** son de
este trabajo: `main` los está editando en paralelo. No se leyeron como propios ni se modificaron. El
cambio previo en `docs/compose/spec/assistant-reports-events.md` tampoco es de esta sesión.

## Verificación real desde `main` (2026-11-08)

Complementa lo anterior con la corrida contra los servicios desplegados (BFF → agente → Finance),
sin mocks. Guion versionado: `scripts/cu26/verify-financial-report-real.mjs`; artefacto ignorado
`output/cu26/financial-report-run.json` (credenciales sintéticas leídas dentro del proceso, nunca
impresas ni persistidas).

### Resultado: `cu26-financial-real11` exit0, cinco comprobaciones

| Comprobación | Resultado observado |
| --- | --- |
| Período con datos 2026-11-07→08 | Job `SUCCEEDED`; cifras **idénticas** al resumen propietario: `receivedMinor 50850`, `expenseMinor 8302`, `netMinor 42548`, `paymentCount 3`, `expenseCount 10`, `currency BOB`, `complete true` |
| Período vacío real 2026-10-01→02 | Job `SUCCEEDED`; el propietario devolvió **ceros auténticos** (0 cobros, 0 gastos) y el documento publicó `0/0/0`, no una ausencia |
| Repetición con el mismo cuerpo | Mismo `jobId` y mismo documento; no hay segunda generación |
| Mismo `operationId` con otro período | **Rechazado** (no devuelve el documento de otro período). El código que el BFF expone fue `SERVICE_UNAVAILABLE`: un conflicto real no debería parecer una caída (ver límites) |
| Mecánico (sin `payments:read`) | `403` real del agente al crear y lectura sin cifras; el BFF no le entrega el documento |
| Aislamiento de almacén | Con una cuenta **con** alcance operativo, el `jobId` financiero responde `404` en `/report/jobs/{id}`: el trabajo no existe en el almacén operativo ni al revés |

### Redacción: intento real de modelo y reserva rotulada

En ambas corridas el documento publicado fue `narrativePath: deterministic`, `model: null`,
`promptVersion cu26-financial-report-v1`, con las limitaciones de alcance y de «no es rentabilidad ni
saldo bancario». El modelo **sí** fue invocado; su texto no se publicó:

1. Primera corrida: rechazo `financial_narrative_rejected_profitability_claim`. La causa era un
   **falso positivo**: la regla prohibía la palabra «rentabilidad» incluso en una advertencia
   («no es rentabilidad»). Se corrigió con `claimsProfitability()`, que descarta las apariciones
   negadas o enumeradas tras «ni», y se añadió su regresión (13/13 en el archivo, 149/149 en el
   agente). Una advertencia ya no se confunde con una afirmación; «La rentabilidad fue alta» sigue
   rechazándose.
2. Tras la corrección, el modelo pasó el filtro pero escribió **`42.54 BOB`** en lugar de
   `425.48 BOB` (error aritmético de una cifra) y el verificador lo rechazó con
   `financial_narrative_rejected_claim_binding: figure_not_computed:42.54 BOB | amount_missing:
   finance.netMovementMinor`. Se publicó la plantilla determinista, rotulada.

Conclusión honesta: **la vía generativa está implementada y se ejercitó, pero en estas corridas el
modelo no acreditó las cifras**; la salvaguarda impidió publicar un número equivocado. No se ajustó
el prompt hasta que el modelo acertara, y no se atribuye precisión al modelo.

### Límites observados (no corregidos en este incremento)

- El verificador cuenta fragmentos de fecha de la prosa (`7`, `8`, `2026`) como cifras no
  calculadas. Con un texto sin fechas no aparece, pero es una dureza mejorable.
- Un conflicto de `operationId` llega al cliente como `SERVICE_UNAVAILABLE` en vez de un conflicto
  distinguible; conviene mapearlo en el BFF.
- La interfaz de reporte financiero se compila y tiene pruebas de contrato y formato, pero **no se
  recorrió en navegador** en esta sesión: queda pendiente su verificación visual real.
- El trabajo se probó con el mismo motor de trabajos que el operativo pero instancia y directorio
  propios; la interrupción por reinicio está probada a nivel de almacén, no con `--force-recreate`
  del agente en esta corrida.
