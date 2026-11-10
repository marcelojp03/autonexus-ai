# 034 — Manual y checklist con trazabilidad del alcance

Fecha: 2026-11-10.

Estado: criterio editorial aplicado a estos documentos; no es una nueva aprobación de alcance funcional del equipo.

## Contexto

El usuario solicitó un manual E2E y un checklist contra un documento preliminar de actores,
31 CU y arquitectura. La copia `93129e1` contiene aceptación de incrementos acotados y
anotaciones históricas que no prueban todas las variantes del documento preliminar.
Además, la instalación local tiene dependencias pendientes que no equivalen al estado del producto.

## Criterio aplicado

- Publicar el recorrido en `docs/manual/usuario-e2e.md` y su comparación en
  `docs/manual/checklist-cumplimiento.md`.
- Separar núcleo aceptado según evidencia, cumplimiento literal del adjunto y disponibilidad local.
- Dar prioridad a las consolidaciones recientes sobre párrafos históricos contradictorios.
- Describir solo pantallas existentes; marcar flujos condicionales/bloqueados y funcionalidades pendientes.
- No copiar credenciales, datos personales ni artefactos privados; referenciar archivos privados locales por nombre.
- No marcar pruebas sugeridas como ejecutadas ni sumar puntos por generar documentación.

## Consecuencias

La clasificación de 21 CU con aceptación registrada, cuatro parciales y seis pendientes
conserva el total interno 62/102. No certifica cumplimiento literal completo ni calidad global.
Las variantes offline, videos, recepción con IA, devoluciones, herramientas MCP propuestas,
ICONIX y cloud conservan sus diferencias o pendientes explícitos. Esta nota no las aprueba,
descarta ni implementa: cualquier cambio funcional requiere su contrato y evidencia propios.

CU afectados: documentación de CU01–CU31. No se modifican contratos ni reglas de negocio.

Fuente: adjunto proporcionado en la conversación; sin enlace público propio.
La [línea base del proyecto](../context/PROJECT.md) y las [copias de CU](../use-cases)
conservan la procedencia Notion de los acuerdos; esta nota no presenta el adjunto como un nuevo acuerdo Notion.
