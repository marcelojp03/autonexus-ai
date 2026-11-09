# Asistente interno — primera lectura financiera CU25

Proceso `integration/agent`, separado de MCP. BFF llama POST /assistant con
`{query:string}` y bearer humano entrante. Respuesta publicada existente:
answer,refused,toolsUsed,model,generatedAt,references,provenance,limitations.
No JWT/grants/credenciales en respuesta, auditoría o persistencia. Web sólo
GraphQL assistantAnswer; no se expone REST financiero general al navegador.

## Herramienta de resumen financiero

`autonexus_get_financial_summary({from,to})` adapta exclusivamente GET
Finance `/financial-summary?from=AAAA-MM-DD&to=AAAA-MM-DD`. Fuente propietaria
y definición de dinero en `financial-ledger.md`. Sin SQL, MCP obligatorio,
cuenta técnica ni autorización por nombre de rol. FINANCE_API_URL y
EMPLOYEES_API_URL son configuración confiable del proceso, no argumentos.

El catálogo y cada ejecución consultan Empleados con el mismo bearer y
requieren employeeId vigente, employeeStatus active y ambos permisos
payments:read/expenses:read. Finance vuelve a autorizarlos al atender el GET.
No se cachea autoridad financiera entre llamadas ni se deduce de mcp_read_*
del JWT. Fallo/autorización ausente no publica cifras ni un cero ficticio.

Período explícito en la solicitud, dos fechas civiles ISO válidas y ordenadas,
como máximo31días inclusivos, zona del taller America/La_Paz. El modelo no
elige otro período. Argumentos cerrados: no filtro, URL, cabecera, SQL, importe
o acción de escritura arbitrarios. Una consulta financiera sin fecha o una
capacidad no soportada pide aclaración, no termina en agenda por defecto.

DTO propietario obligatorio, sin convertir importes a float:

| Campo | Semántica |
| --- | --- |
| from,to,timeZone | Período civil efectivo y zona del taller; debe coincidir con lo pedido |
| currency | BOB en este incremento |
| paymentCount,expenseCount | Cantidad de registros propietarios del período, enteros no negativos |
| receivedAmountMinor | Suma de pagos **registrados**, string canónico de centavos no negativos |
| expenseAmountMinor | Suma de gastos **registrados**, string canónico de centavos no negativos |
| netMovementMinor | Diferencia exacta recibido−gasto, string canónico con signo permitido |
| generatedAt | Instante de cálculo del propietario |

Grano temporal observado en Finance: el cobro se selecciona por recordedAt
convertido al día civil America/La_Paz; el gasto, por expenseDate declarado.
Conteos y totales abarcan todos los registros de cada selección, no sólo la
página. La diferencia no acredita flujo de caja, devengamiento completo ni
disponibilidad bancaria: tampoco comprende obligaciones/costos no registrados.

Compleción, tipos, período, moneda y coherencia aritmética se validan antes de
usar el dato. Ausente/contradictorio es error; un cero verdadero sí se muestra.
La respuesta de CU25 se compone determinísticamente con cifras comprobadas y
declara ese modo, período/moneda/actualización/procedencia Finance. No afirma
rentabilidad, saldo bancario, ingreso por cotización ni nueva redacción financiera
generativa. Notas, respaldos y referencias bancarias no entran en este contexto.
El camino financiero no llama al LLM; el catálogo del modelo para otras
preguntas excluye esta herramienta. No se calientan/descargan otros modelos
para verificar este incremento, ni se presenta como generación CU26.
El campo de compatibilidad model publica cu25-financial-summary-v1: versión
de la respuesta calculada, no identificador de un modelo que la haya redactado.

## Compatibilidad y límites

Es una lectura, no CU19/CU20 por agente: registrar, pagar, anular, reembolsar o
modificar dinero se rechaza antes de LLM/herramientas. No amplía roles/permisos.
Cuestiones de cotizaciones/fiscalidad/desgloses aún no disponibles se declaran.
No se suman páginas parciales como total del período.

No cambia OperationsReport, sus jobs/documentos históricos ni el semanal CU28.
El tipo financiero de CU26 requiere contrato/checker/autorización y trabajo
propios, importes/claims string-centavos y su aceptación separada; no existe
por añadir esta herramienta a CU25. Ningún cierre global ni nuevo puntaje implícito.
