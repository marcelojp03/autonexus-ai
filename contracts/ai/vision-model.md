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

## Negativos y puerta de calidad (lo que faltaba medir)

El dataset no tiene fotografías sin daño, así que el modelo nunca aprendió cómo se ve un vehículo
sano: sobre una muestra con licencia verificable de Wikimedia Commons (20 imágenes retenidas, fuera
del entrenamiento) marcaba **10/10 autos sin daño** y **10/10 imágenes fuera de dominio**. Se
incorporaron 60 negativos con licencia al entrenamiento (75 % train / 25 % validación) y se volvió a
medir:

| Artefacto | Falsas alarmas en autos sin daño | Falsas alarmas fuera de dominio | Macro F1 test limpio |
| --- | --- | --- | --- |
| `20261101T-aligned-antialias` | 1,00 (10/10) | 1,00 (10/10) | 0,6920 |
| `20261101T-with-negatives` (**servido**) | **0,60 (6/10)** | **0,50 (5/10)** | 0,6846 |

Lectura honesta: los negativos reducen las falsas alarmas a la mitad y cuestan 0,7 puntos de F1,
pero **6 de cada 10 autos sin daño siguen marcados**. El modelo no es utilizable como señal de
revisión todavía; hace falta un conjunto equilibrado (miles de negativos, idealmente unidades con y
sin daño de la misma sesión). La plataforma funciona; la capacidad visual queda **no validada para
uso**.

## Resultados en test (umbrales fijados en validación, una sola evaluación)

Test completo (2.093) y test limpio de duplicados/sesiones (1.694):

Artefacto servido `20261101T-with-negatives` (umbrales 0,25 / 0,35 / 0,40 / 0,50):

| Etiqueta | F1 (test completo) | F1 (test limpio) | Positivos en test |
| --- | --- | --- | --- |
| `crack` (grieta) | 0,4303 | 0,4429 | 318 |
| `dent` (golpe) | 0,7444 | 0,7330 | 1.033 |
| `glass_shatter` (cristal roto) | 0,7548 | 0,7436 | 329 |
| `scratch` (rayón) | 0,8125 | 0,8190 | 1.383 |

Macro F1: **0,6855** en test completo y **0,6846** en test limpio. La corrida anterior
(`20261101T-aligned-antialias`, sin negativos) daba 0,6927 / 0,6920; se conserva para volver atrás.
Detalle por etiqueta con precisión y exhaustividad en `metrics.json` y `clean-evaluation.json` de la
corrida.

La fuga detectada en el artefacto sin negativos (70 duplicados exactos, 105 casi duplicados, 315
solapamientos de sesión) apenas inflaba el resultado en 0,0007: el número no dependía de ella, y
ahora está medido en vez de supuesto.
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
- El agregado mezcla automóviles y equipo pesado, y la anotación es heterogénea (ver la muestra
  visual en dataset-provenance.md): «vehículo» en este modelo incluye maquinaria.
- Las imágenes del conjunto no se publican: hay matrículas legibles y marcas de agua de origen.
- El modelo no reconoce óxido, desgaste, fugas ni condiciones fuera de las cuatro publicadas, y no
  localiza el daño: para recuadros o áreas hace falta un detector/segmentador.
- Sin `manifest.json` y `model.keras`, MS04 responde `503 MODEL_NOT_READY`; nunca sustituye la
  inferencia por un clasificador genérico.
## Estado de la conversión a TensorFlow.js (CU22) — bloqueada, no acreditada

Intento ejecutado con `tensorflowjs==4.22.0` sobre el `SavedModel` del artefacto servido. La
importación del conversor falla antes de convertir:

```
google.protobuf.runtime_version.VersionError: Detected incompatible Protobuf Gencode/Runtime
versions when loading yggdrasil_decision_forests/dataset/data_spec.proto: gencode 6.31.1
runtime 5.29.6.
```

Causa: `tensorflowjs` arrastra `yggdrasil-decision-forests`, cuyo código generado exige un runtime de
protobuf más nuevo que el que fija TensorFlow 2.16; fijar `protobuf==6.31.1` en la imagen de
exportación no se sostiene (el resolvedor vuelve a 5.29.6).

Consecuencias declaradas:

- **No** se produce artefacto web y **no** se acredita equivalencia en navegador.
- El camino verificado hoy para reutilización es **móvil/LiteRT**: `model.tflite` float32 con
  diferencia máxima 3,0e-06 (tolerancia 1e-3).
- Plan concreto: imagen de conversión separada sobre TensorFlow 2.17+ (donde conversor, TF y
  protobuf son compatibles), convertir desde el `SavedModel`, y verificar equivalencia en Node con
  `@tensorflow/tfjs` sobre un lote fijo de imágenes ya preprocesadas.
- Sin esa verificación, CU22 **no** puede declarar funcionamiento offline en web.