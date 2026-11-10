# 035 — Diseño documental de pruebas en Word para los 31 CU

Fecha: 2026-11-10.

Estado: criterio editorial aplicado al entregable solicitado por el usuario;
no es una nueva decisión funcional ni una aprobación de los CU por el equipo.

## Contexto

El usuario pidió un Word de caja negra y blanca para CU01–CU31, sin los campos
de captura inicial/final de caja negra, siguiendo el PDF académico analizado.
El repositorio tiene unidades existentes y seis CU sin implementación completa.

## Criterio aplicado

- Entregar `docs/testing/AutoNexus_AI_Pruebas_Caja_Negra_y_Blanca_31_CU.docx`,
  con generador reproducible y README de alcance/verificación.
- Incluir cuatro escenarios de caja negra por CU y caminos/diagramas de caja blanca.
- Transcribir 25 unidades reales seleccionadas, con archivo y líneas originales.
- Para CU08, CU18, CU21, CU24, CU30 y CU31, identificar pseudocódigo y caminos
  **propuestos**, sin atribuirlos a una implementación inexistente.
- Mantener resultados obtenidos como no ejecutados. La generación/validación del
  Word no es ejecución de pruebas de negocio ni sustituto de evidencia real.
- Identificar los diagramas como flujos reducidos por bloques y no prometer cobertura
  exhaustiva de decisiones, complejidad medida o aceptación global del CU.
- Usar datos sintéticos y conservar las diferencias de alcance documentadas en el manual.

## Consecuencias

Entrega documental: 31 CU en ambos bloques, 124 escenarios de caja negra,
146 caminos de caja blanca, 31 diagramas. Las seis propuestas deben contrastarse
con código y contratos cuando se implementen; las otras unidades requieren ejecución
y pruebas complementarias para cerrar todos los caminos del CU.

No se modifican reglas, contratos, aceptación funcional ni el total interno 62/102.
No se renderizó el Word completo; sí se validó su estructura y se inspeccionó el
diagrama CU15. Detalle de comandos y limitaciones en `docs/testing/README.md`.

CU afectados: documentación de CU01–CU31.
Fuente: solicitud y PDF adjunto en esta conversación, sin enlace público propio.
Requisitos acordados: [línea base](../context/PROJECT.md) y
[copias de los CU](../use-cases), que conservan su procedencia Notion.
