# 032 — CU25: fuente financiera real y salida calculada

Fecha local del taller2026-11-08. Alcance: assistant-reports-events S2.14,
primera herramienta financiera, no cierre CU25/CU26.

- Reutilizar GET /financial-summary de Finance: resumen propietario del ledger
  de cobros/gastos, no sumar cotizaciones, listas paginadas ni bases ajenas.
- Mismo bearer humano, vínculo laboral activo y ambos permisos actuales,
  comprobados al declarar y ejecutar la capacidad y de nuevo por Finance.
  Los roles MCP no son autoridad financiera ni un requisito adicional. Su
  ausencia no habilita lecturas operativas/reportes por permisos financieros.
- Fechas civiles explícitas,31días inclusivos, argumentos cerrados. El parser
  distingue sustantivos de consulta y órdenes financieras de escritura. Sin
  período/filtro soportado se aclara, sin inventar fechas ni caer en agenda.
- Campos obligatorios, moneda/zona, conteos y coherencia exacta con BigInt;
  cero real se conserva y ausente no se imputa. Formato decimal sin Float.
- El camino financiero es determinista desde la intención hasta la salida y
  evita el LLM; otras preguntas tampoco le ofrecen la herramienta financiera.
  No puede derivar un período distinto ni ejecutar nuevas capacidades. Versión
  cu25-financial-summary-v1 evita rotular el resumen como un modelo generativo.
- Temporalidad real: cobros por recordedAt civil La Paz, gastos por expenseDate.
  Movimiento neto es esa diferencia registrada, no rentabilidad/caja/banco.
- No modificar OperationsReport, sus claims Int, autorización de ejecuciones,
  trabajos históricos ni semanal CU28 para alojar dinero. CU26 financiero
  requiere contrato, claims monetarios string, autorización y trabajo separados
  con su propia aceptación; no queda implementado por este resumen.

La guía data-analytics influyó en grano, unidad, completitud, consistencia y
oráculos; no se infieren conclusiones de negocio o calidad general del modelo
desde las transacciones sintéticas. Evidencia por requisito en
docs/evidence/cu25-financial-source-20261108.md. Sin puntos nuevos implícitos.
