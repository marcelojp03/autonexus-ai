# 038 — Instalar el modelo publicado sin repetir entrenamiento

Fecha: 2026-11-10. Alcance local solicitado por el usuario; sin publicación Git.

Se usa el artefacto Keras versionado en `9315c9a`, con su manifiesto, declaración de
calidad y SHA256SUMS. No se descarga el dataset ni se repite entrenamiento: no son
necesarios para inferencia con estos pesos. Se conserva el montaje de solo lectura
de Compose y se recrea solo Inteligencia para cargar los archivos recién obtenidos.

Antes de integrar se conserva el trabajo local con stash y patch; se restaura sin
eliminar el respaldo. El único conflicto documental se resuelve conservando ambos
bloques. No se reescribe historia ni se descartan cambios ajenos.

Verificación: tres hashes coinciden, contenedor healthy, readiness UP y ejecución
real de inferencia con PNG sintético y cuatro resultados finitos. Esta prueba no
mide precisión ni cierra aceptación CU22/CU23: el artefacto sigue experimental.
S3 y exportaciones offline web/móvil siguen siendo requisitos separados.

Se corrigen en la entrega documental el hash desactualizado de quality.json, el
cierre del bloque de verificación y la ruta predeterminada, contrastados con los
archivos y Compose actuales. Los bytes del artefacto no se modifican.
