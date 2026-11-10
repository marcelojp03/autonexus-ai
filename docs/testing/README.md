# Pruebas de caja negra y blanca — 31 CU

Entregable solicitado: [Word editable](AutoNexus_AI_Pruebas_Caja_Negra_y_Blanca_31_CU.docx).
Fecha: 2026-11-10. Fuentes inspeccionadas sobre `93129e1`.

Incluye 124 escenarios de caja negra, 146 caminos de caja blanca y 31 diagramas.
No incluye campos de captura inicial ni final en las fichas de caja negra.
Los resultados obtenidos quedan **no ejecutados**; este trabajo no corrió pruebas de negocio.

Se transcriben unidades reales seleccionadas para 25 CU. Para CU08, CU18, CU21,
CU24, CU30 y CU31 se identifica un diseño funcional propuesto, porque no se encontró
implementación completa. Los diagramas agrupan bloques funcionales: no son grafos
exhaustivos ni acreditan cobertura de todas las decisiones de cada CU.

## Reproducción

Desde la raíz, Python 3 y Pillow disponible:

```powershell
python docs/testing/build_test_document.py
```

El generador usa la biblioteca estándar para OOXML/ZIP y Pillow para diagramas.
No necesita Microsoft Word para generar el archivo. Lee los CU y extractos del
código actual; si cambian sus anclas, se deben revisar los caminos y la transcripción.
El catálogo de escenarios y el análisis se mantienen dentro del generador.

Verificación ejecutada: generación exit 0; presencia de los 31 CU en ambos bloques,
124 IDs de escenarios de caja negra, 146 caminos, 25 extractos reales, seis propuestas,
31 imágenes incorporadas, XML bien formado, destinos de relaciones y CRC del ZIP válidos.
Se inspeccionó visualmente el diagrama CU15. No se renderizó el documento completo en Word,
por lo que la paginación y el acabado de todas sus páginas quedan sin revisión visual.

La fuente metodológica es el PDF del usuario «Fase 3 / Capítulo 9: Pruebas».
Las fuentes funcionales son `docs/use-cases/CU01.md` a `CU31.md`, los contratos
referidos en cada ficha y el contexto vigente del repositorio. No se alteran contratos,
código empresarial, estados de aceptación ni puntos del proyecto.
