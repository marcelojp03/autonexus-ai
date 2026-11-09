# 033 — CU26: reporte financiero como tipo separado

Fecha local del taller 2026-11-08. Especificación: `docs/compose/spec/assistant-reports-events.md`
§S2.15; evidencia `docs/evidence/cu26-financial-20261108.md`.

- El reporte financiero **no** se obtiene ampliando `OperationsReport`. Tiene documento propio
  (`financial-narrative`, versión `cu26-financial-report-v1`), verificador propio, trabajo propio y
  rutas propias (`/report/financial/jobs`, almacén `financial-jobs/`). Un identificador operativo y
  uno financiero nunca se resuelven entre sí.
- Dinero siempre en **strings canónicos de centavos BOB**, nunca `float` ni `Int` de GraphQL; el
  servicio y el BFF comprueban `recibido − gasto = neto` con aritmética entera antes de publicar.
  Un dato ausente del propietario falla el trabajo: no se rellena con cero. Los ceros auténticos del
  propietario sí se publican.
- Autorización propia: empleado vigente con `payments:read` **y** `expenses:read` consultados sin
  caché, revalidados al crear, al ejecutar y en cada lectura. No se reutiliza
  `executions:read:team`, ni los roles `mcp_read_*`, ni una cuenta técnica. Un permiso revocado
  responde sin cifras.
- Cifras calculadas en el servidor; el modelo sólo redacta. Si el texto no liga cada cifra a su
  indicador, o no incluye los tres importes, se publica la plantilla `deterministic` con
  `model: null` y el código en `limitations`. Un texto que afirme rentabilidad, utilidad, flujo de
  caja o saldo bancario se rechaza; una **advertencia** («no es rentabilidad») no. Se comprobó con
  una corrida real que el modelo puede equivocarse en una cifra (`42.54` por `425.48`): la
  salvaguarda evitó publicarla.
- Se declaran los límites del alcance en el propio documento: sólo cobros y gastos registrados del
  período, sin obligaciones ni cotizaciones; sin filtros por categoría/empleado/indicador porque el
  propietario no los publica; la diferencia registrada no es rentabilidad, caja ni saldo bancario.
- El resumen determinista de CU25 sigue siendo una consulta, no este reporte. CU26 permanece parcial
  hasta recorrer su interfaz en navegador; no suma puntos por estas pruebas.

## Correcciones y límites posteriores a la revisión independiente

- **Neto negativo.** El emparejador de importes era sin signo, así que con gastos mayores que los
  cobros ni la propia plantilla podía ligar el neto: el documento quedaba `verified:false` y sus
  `claims` omitían `finance.netMovementMinor` aunque `figures.netMinor` no fuera cero. Se acepta
  ahora el signo (`-`/`−`) al leer importes y `toCents` devuelve el valor negativo; regresión
  añadida. No hay período real en los datos del taller con gastos mayores que los cobros, así que
  ese caso está cubierto por prueba unitaria y no por una corrida real: se declara así.
- **Guard de rentabilidad.** Se rechazaba la advertencia legítima y se dejaban pasar afirmaciones
  (faltaba el adjetivo «rentable» y la negación abarcaba demasiado texto). Ahora la negación exige
  estar junto al término y se incluyen sus formas adjetivas; una afirmación como «el taller fue
  rentable» se rechaza y «no es rentabilidad ni saldo bancario» se publica.
- **Dependencia implícita de la reautorización al ejecutar.** La revalidación de permisos durante la
  ejecución ocurre dentro de la fuente de herramientas (`token-source.ts`), no en una llamada
  explícita del ejecutor de trabajos. Se registra como dependencia: si esa fuente dejara de
  revalidar, la ejecución perdería la comprobación.
- **Lectura de un documento guardado con `FINANCE_API_URL` ausente** responde `503` antes de servir
  el documento ya persistido. Es fallo cerrado, pero más amplio de lo necesario.
- `complete` es verdadero por construcción tras comprobar período y aritmética; se documenta como
  indicador redundante, no como una comprobación adicional.
