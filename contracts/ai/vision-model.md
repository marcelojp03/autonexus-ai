# Modelo visual de CU23 — manifiesto, procedencia, auditoría y comparación

Artefacto entrenado por `ml/training/train.py`; MS04 Inteligencia lo carga desde un directorio de
sólo lectura (`INTELLIGENCE_MODEL_PATH`). El repositorio **no** guarda imágenes ni pesos: este
documento y el manifiesto describen qué se ejecutó, con qué datos y con qué resultados.

> **Estado de licencia: restringido, no validado.** El dataset agregado declara CC BY 4.0 pero
> incorpora CarDD, cuyo acceso original exige un formulario de licencia. Ver
> [`dataset-provenance.md`](dataset-provenance.md). Las imágenes no se versionan ni se
> redistribuyen; los pesos derivados **no** se declaran aptos para distribución.

## Procedencia

| Elemento | Valor |
| --- | --- |
| Dataset | `tugberkkalay/autodamageiq-vehicle-damage-dataset` (Hugging Face), revisión `b5abbf54bdf7c8817a4e20b6ab39c8f1fe98a0e5` |
| Licencia declarada por el agregador | CC BY 4.0 — **contradicha** por la condición de acceso de CarDD |
| Emparejamiento | Sólo stems presentes en `images/` **y** `labels/`: 11.093 de 12.094 imágenes |
| Extractor base | MobileNetV2 / ImageNet (Apache-2.0), SHA-256 `f8aff69536bd77a692c594f559c798c19bf7f3f36668fc9fa00b21c6aab4797c` |
| Cabeza | `Dropout(0.2) → Dense(4, sigmoid)`, 5.124 parámetros entrenables |
| Preprocesamiento | **Una sola implementación**: `tf.io.decode_image` + `tf.image.resize(bilinear, antialias=True)` + `mobilenet_v2.preprocess_input`, usada por entrenamiento y servicio |
| `modelVersion` | `automotive-damage-mobilenetv2-v1` |
| Semilla / épocas | 20.261.101 / 40 configuradas, 40 ejecutadas (early stopping con restauración) |

## Auditoría del dataset (`ml/training/audit_dataset.py`)

| Comprobación | Resultado observado |
| --- | --- |
| Duplicados exactos (SHA-256) | 187 digests repetidos; **70 compartidos entre splits** |
| Casi duplicados en test (dHash, Hamming ≤ 6) | 105 imágenes de test se parecen a una imagen de entrenamiento/validación |
| Misma sesión de captura (prefijo `vehide_AAAAMMDD_HHMMSS`) | 315 imágenes de test comparten sesión con los splits ajustados |
| Imágenes sin ninguna anotación | **0 en los tres splits** |
| Test que sobrevive a ambos filtros | **1.694 de 2.093 (81 %)** |

Consecuencias que se aceptan y se declaran:

1. La separación por vehículo **no se puede probar**: el dataset no publica identidad de vehículo.
   Los filtros de duplicado y de sesión son los proxies disponibles.
2. **No hay fotografías sin daños**, así que no se puede estimar la tasa de falsas alarmas ni
   publicar un F1 de «algún daño». La versión anterior de este documento citaba ese 0,99; era un
   artefacto del conjunto, no una capacidad.

## Resultados en test (umbrales fijados en validación, una sola evaluación)

Test completo (2.093) y test limpio de duplicados/sesiones (1.694):

| Etiqueta | Precisión | Exhaustividad | F1 | ROC-AUC | Positivos | F1 en test limpio |
| --- | --- | --- | --- | --- | --- | --- |
| `crack` (grieta) | 0,3659 | 0,5881 | 0,4511 | 0,7820 | 318 | 0,4549 |
| `dent` (golpe) | 0,6899 | 0,8035 | 0,7424 | 0,8054 | 1.033 | 0,7334 |
| `glass_shatter` (cristal roto) | 0,7478 | 0,7660 | 0,7568 | 0,9500 | 329 | 0,7495 |
| `scratch` (rayón) | 0,7517 | 0,9038 | 0,8207 | 0,7821 | 1.383 | 0,8301 |

Macro F1: **0,6927** en test completo y **0,6920** en test limpio. Es decir, la fuga detectada
(70 duplicados exactos, 105 casi duplicados, 315 solapamientos de sesión) apenas inflaba el
resultado en 0,0007: el número no dependía de ella, y ahora está medido en vez de supuesto.

Etiquetas descartadas: `lamp_broken` y `tire_flat` no tienen positivos en test (0 y 0) y se
excluyeron del artefacto en lugar de publicar una capacidad no medida.

## Comparación de modelos (`ml/training/compare_models.py`, subconjunto 4.000, mismo protocolo)

Mismas imágenes, misma cabeza, misma pérdida, mismos umbrales por validación; se elige por
validación, nunca por test.

| Candidato | Macro F1 (validación) | Parámetros | Latencia CPU (1 imagen) |
| --- | --- | --- | --- |
| **MobileNetV2 congelado + cabeza lineal (actual)** | **0,6631** | 2,26 M | 421 ms |
| MobileNetV2 con ajuste de las últimas 40 capas | 0,6560 | 2,26 M | 782 ms |
| MobileNetV3-Small congelado | 0,4994 | 0,94 M | 317 ms |
| MobileNetV3-Large congelado | 0,5181 | 3,00 M | 485 ms |

Lectura: con este tamaño de datos y este protocolo, **ni el ajuste fino ni MobileNetV3 mejoran** a
la referencia; V3-Small es la más liviana y rápida pero pierde ~16 puntos de F1. No se cambió el
artefacto. La comparación es acotada (subconjunto y 6 épocas para el ajuste fino) y así se declara.

## Equivalencia de preprocesamiento (`ml/training/check_preprocessing.py`)

Primera medición: el servicio usaba Pillow y el entrenamiento TensorFlow; la diferencia máxima de
puntaje era **0,293** — fuera de toda tolerancia, es decir el modelo servido no veía lo mismo que
el entrenado. Se unificó en una sola implementación (ops de TensorFlow en el servicio) y la
medición actual es **0,000** en píxeles y en puntajes sobre 20 imágenes de test.

## Exportación para web y móvil (CU22)

`ml/training/export_model.py`: `model.tflite` float32 es numéricamente equivalente (diferencia
máxima 3e-06, tolerancia 1e-3, 20 imágenes); `model-fp16.tflite` **no** (0,0117) y se declara así.
La conversión a TensorFlow.js no está producida en esta entrega; su equivalencia debe verificarla
CU22 con un runtime JS.

## Límites vigentes

- Señal para revisión humana: no mide, no diagnostica y no estima reparaciones.
- `crack` es la etiqueta más débil (F1 0,45): no se presenta como detector fiable de grietas.
- Sin fotografías sin daño, no hay tasa de falsas alarmas que reportar.
- El modelo no reconoce óxido, desgaste, fugas ni condiciones fuera de las cuatro publicadas, y no
  localiza el daño: para recuadros o áreas hace falta un detector/segmentador.
- Sin `manifest.json` y `model.keras`, MS04 responde `503 MODEL_NOT_READY`; nunca sustituye la
  inferencia por un clasificador genérico.
