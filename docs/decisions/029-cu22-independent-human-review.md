# 029 — CU22: revisión humana independiente y alternativa manual

Fecha local: 2026-11-07. Contrato `contracts/ai/local-inspection.md`.

La predicción conserva versión del modelo, puntajes originales y hash de su imagen.
La interpretación humana se guarda por separado en ambas superficies y puede existir
sin predicción. Sin modelo/inferencia no se inventan versión, cero confianza ni análisis
del servidor. Se reutilizan texto y cola existentes: no se crea un segundo formulario
de notas ni una confirmación offline ficticia.

Preparar el trabajo no depende de preparar IA. La PWA separa recursos básicos y modelo
opcional; Flutter añade una columna nullable en SQLite7. Traslado web versión2 conserva
lectura de versión1. Sin capacidad de almacenamiento se rechaza el guardado y se
conserva staging/borrador para reintentar; no se promete durabilidad de datos rechazados.

Cabeceras, tamaño y resolución se comprueban antes de decode. Las salidas bajo umbrales
se presentan como no concluyentes y no descartan daño. Cuotas acotadas/puertos de fallo
permiten comprobar límites sin agotar el equipo real. El alcance de cada inyección y
ejecución real está en `docs/evidence/cu22-local-inspection-20261107.md`.

La aceptación del recorrido/excepciones se separa de la capacidad visual: no se cambia
qualityStatus ni se crean métricas por pasar tests o mostrar un aviso experimental.
Se mantiene la clasificación global parcial de CU22, sin sumar cinco puntos por esta
conciliación funcional: `docs/reference/05-ia-offline.md`, apartado Deep Learning, exige
calidad por clase además de ejecución offline, y `contracts/ai/model-registry.md` declara
el artefacto no validado para uso. Los criterios concretos están en
`contracts/ai/cu23-acceptance-criteria.md`; no se añade una condición indefinida de calidad.

Ampliación2026-11-08: tras cancelación del revisor sin dictamen, el usuario autorizó
revisión directa focalizada. Se realizó sobre el core funcional y se declara como
tal; no equivale a revisión independiente. Nueva tareaUX de pantallas reales sigue
abierta; no se suman puntos ni se valida calidad/licencia por cerrar revisión de código.
