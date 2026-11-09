# CU25 — primera fuente financiera real, alcance parcial

Publicado `de03fa11ada8a143279390e4188157cfa13c11ff`, FF main y push normal
main/work/marcelo, ls-remote de ambas refs confirmado;19rutas/19blobs sin
hallazgos. Revisión152+re-revisión153conformes tras cerrar hallazgos. T14
aceptado acotadamente; no CU25/CU26 globales, generación financiera ni puntos.
Esta constancia supera los pendientes de Git históricos inferiores.

Base `3a5dc0c`, work/marcelo. S2.14/T14 de assistant-reports-events, contrato
REST assistant y decisión032. Datos del taller **sintéticos**, propietarios/
transporte reales; no recepción bancaria real ni calidad general de IA.

## Contrato y controles demostrados

Una capacidad autonexus_get_financial_summary, GET Finance /financial-summary,
from/to explícitos,31días inclusivos. Vínculo vigente activo y ambos permisos
payments:read/expenses:read, frescos al listar y ejecutar, mismo bearer a
Empleados y Finance y reautorización del propietario. No se crean roles, usuarios
ni cuenta técnica. La cuenta financiera real no tenía mcp_read_team/self.
Su capacidad no concede lecturas/reportes operativos a un token sin ese alcance.

Entrada financiera y salida deterministas sin llamar al LLM; para otras
preguntas se excluye esta herramienta del catálogo del modelo. Metadata
cu25-financial-summary-v1, no cu25-llm-v1. Sólo10campos agregados necesarios,
sin notas, referencias bancarias, fotos o grants. Tipos/fechas/moneda/zona,
conteos, ceros y neto exacto con BigInt: faltante/contradicción no se imputa.
Neto no es rentabilidad, caja/banco ni suma de cotizaciones aprobadas.

## Verificación de código observada

- Node22.22.3 y TypeScript6: build0. Regresiones nuevas de límites primero
  **7PASS/5FAIL**: sustantivos confundidos con escritura, imperativos acentuados,
  rol MCP requerido indebidamente y contradicción de conteo/total. Tras arreglo
  **12/12PASS**: bearer/GET/redirect/plazos, autorización fresca y revocación,
  DTO ausente/moneda/neto/cero/grandes centavos, argumentos cerrados, intención
  y negativa de escritura, actor sin MCP, modelo excluido y procedencia.
- Metadata heredada primero **2FAIL** (planner/llm como versión financiera);
  corregida a versión propia determinista y **12/12PASS** otra vez.
- Suite final completa **133/133**, exit0; regresión compartida de parser/
  entrada HTTP/jobs, no nueva matriz empresarial CU28.
- Logs/exit: cu25-financial-boundaries-{red,build,green},
  cu25-financial-mode-{red,build,green}, cu25-financial-final-all en output/cu27.
  El rojo inicial del actor con Node22.14 no es aceptación del runtime fijado.

## Integración real: Finance → agente → BFF → Shell

Guion versionado `scripts/cu25/verify-financial-summary-real.mjs`, sin respuestas
mockeadas. Login humano/PKCE, bearer en RAM; el guion y los informes no imprimen
ni guardan tokens. Corrida final corregida `cu25-financial-reviewed-shell`:
exit0,7comprobaciones, incluida pregunta de movimiento neto sin otras pistas.

| Indicador del propietario, período2026-11-07→08 La Paz | Valor exacto |
| --- | ---: |
| Cobros registrados | 3 |
| Recibido, centavos BOB | 50850 |
| Gastos registrados por expenseDate | 10 |
| Gasto, centavos BOB | 8302 |
| Diferencia registrada, centavos BOB | 42548 |

La respuesta y la pantalla servida1440/390 contienen las mismas cifras,
período, actualización, procedencia Finance y versión determinista. Consulta
sin fechas pide aclaración sin herramienta; solicitud de registrar gasto se
rechaza sin ejecutar herramienta. Mecánico: Finance403real y negativa del
asistente sin importes. **0mutaciones GraphQL** del recorrido UI.
Conteos/digests de **8tablas monetarias iguales** antes/después,0escrituras
financieras; no se generó un documento/job financiero para contestar.

Segundo período explícito2026-10-01→02: `cu25-financial-reviewed-zero` exit0,
6comprobaciones; propietario0cobros/0gastos y los3importes string0. Respuesta
0.00BOB, no un default por ausencia, mismos8digests. Artefactos ignorados
output/agent/financial-source-{reviewed-local,reviewed-zero}.json;
capturas output/playwright/cu25-financial-reviewed-local.
Son pruebas funcionales/semánticas, **no conformidad visual** por PNG.

## Despliegue conservador y fallos retenidos

Imagen final corregida agente7a6ee6c64ee3, build0. Sólo agent recreado, sin puerto público,
USERnode y mismo volumen/configuración (añadido FINANCE_API_URL interno).
**13archivos de reportes previos con bytes idénticos**,0jobs activos antes/
después. No nuevo microservicio/plataforma, reinicio Docker, modelos/calentar
LLM, cambio de credenciales, borrado de volumen ni actualización CU28.

Dos preflights fallaron antes de mutar: delimitador nulo del guion de hash,
corregido a String.fromCharCode dentro del proceso destino. No fallo del motor.
Un contraste previo llegó a los importes pero falló por regex del verificador
que esperaba determinístico, no determinista. Se corrigió el guion, no el dato.
Hubo401del propietario en otros intentos; **causa no confirmada**, no se afirma
haberla corregido ni relajado firma/issuer/audiencia. El guion usa exp real del
JWT para vigencia; los intentos se conservan y los últimos pases fueron con
sesión vigente. No se infiere estabilidad general de autenticación de esos pases.

## Estado y límites

Revisor151falló al iniciar por SQLite interno bloqueado, sin dictamen.
Revisión independiente152terminada: dosP2de routing (movimiento neto no
identificado y gast dentro de desgaste) y unP3de metadata (modelo deshabilitado
en vez de deliberadamente omitido). Se validaron por4regresiones rojas y se
corrigieron con vocabulario por palabra, neto/netos y leyenda financiera propia.
Rojo4/4fallos pertinentes; build0,15/15focalizadas y suite136/136PASS tras
los cambios. Imagen corregida7a6ee6c64ee3 construida0 y desplegada; contraste
actualizado7/6comprobaciones PASS. Re-revisión focalizada153terminada: ambos
P2yP3cerrados, sin defectos concretos nuevos en el alcance inspeccionado;
cumplimiento/corrección/consistencia conformes. No se borra el dictamen original
ni se atribuye al revisor una nueva ejecución de pruebas. Publicación pendiente. CU25 global sigue
parcial: vocabulario agregado español acotado,31días, sin desgloses/quotes/
fiscalidad/otros indicadores aún no implementados. CU26 financiero y sus jobs,
filtros/gráficos/exportación/generación permanecen pendientes (T15). No nuevos
puntos ni aceptación generativa por esta respuesta calculada.
