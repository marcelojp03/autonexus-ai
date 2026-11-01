# Modelo visual de CU23 — manifiesto, procedencia y límites

Artefacto entrenado por `ml/training/train.py`; el servicio MS04 Inteligencia lo carga desde un
directorio de sólo lectura (`INTELLIGENCE_MODEL_PATH`). El repositorio **no** guarda binarios: este
documento y el manifiesto describen qué se ejecutó y con qué resultados.

## Procedencia

| Elemento | Valor |
| --- | --- |
| Dataset | `tugberkkalay/autodamageiq-vehicle-damage-dataset` (Hugging Face), revisión `b5abbf54bdf7c8817a4e20b6ab39c8f1fe98a0e5` |
| Licencia del dataset | CC BY 4.0 (declarada por el autor; agregación de CarDD, VehiDE y etiquetado humano GPT-4o) |
| Emparejamiento | Sólo stems presentes en `images/` **y** `labels/` (11.093 pares de 12.094 imágenes; 1.000 imágenes sin anotación homónima quedan excluidas) |
| Extractor base | MobileNetV2 de Keras Applications con pesos ImageNet, licencia Apache-2.0, SHA-256 `f8aff69536bd77a692c594f559c798c19bf7f3f36668fc9fa00b21c6aab4797c` |
| Cabeza | `Dropout(0.2) → Dense(4, sigmoid)`, 5.124 parámetros entrenables |
| Preprocesamiento | RGB, redimensionado bilineal a 224×224, `preprocess_input` de MobileNetV2 (rango `[-1, 1]`) |
| `modelVersion` | `automotive-damage-mobilenetv2-v1` |
| Semilla / épocas | 20.261.101 / 40 configuradas, 34 ejecutadas (early stopping en `val_loss`, restauración de la mejor época) |

## Particiones

| Partición | Imágenes | crack | dent | glass_shatter | scratch |
| --- | --- | --- | --- | --- | --- |
| train (85 % del split de entrenamiento) | 7.913 | 1.032 | 3.650 | 1.061 | 5.202 |
| validation (15 %, umbrales y early stop) | 1.087 | 145 | 458 | 157 | 713 |
| test (split `val` del dataset, nunca usado en el ajuste) | 2.093 | 318 | 1.033 | 329 | 1.383 |

## Resultados en test (una sola evaluación)

| Etiqueta | Precisión | Exhaustividad | F1 | ROC-AUC | Positivos | Umbral |
| --- | --- | --- | --- | --- | --- | --- |
| `crack` (grieta) | 0,4182 | 0,5063 | 0,4580 | 0,7915 | 318 | 0,20 |
| `dent` (golpe) | 0,6561 | 0,8587 | 0,7438 | 0,8035 | 1.033 | 0,30 |
| `glass_shatter` (cristal roto) | 0,7493 | 0,7812 | 0,7649 | 0,9493 | 329 | 0,30 |
| `scratch` (rayón) | 0,7405 | 0,9060 | 0,8150 | 0,7721 | 1.383 | 0,40 |

Macro: precisión 0,6410 · exhaustividad 0,7631 · F1 0,6954. Detección de «algún daño» (cualquier
etiqueta sobre su umbral): F1 0,9954. Coincidencia exacta del conjunto de etiquetas: 0,3894.

## Etiquetas descartadas y por qué

`lamp_broken` y `tire_flat` se excluyeron del artefacto porque el split de test no contiene ni un
solo positivo de cada una (0 y 0). Publicarlas habría significado atribuir al modelo una capacidad
que este proyecto **no** midió. Quedan registradas en
`dataset.labelsDroppedForInsufficientTestSupport` del manifiesto.

## Límites que el servicio declara en cada respuesta

- Es una señal para revisión humana: no mide espesores, no diagnostica y no estima reparaciones.
- Las anotaciones son heredadas de un dataset agregado de terceros; el conjunto no publica la
  identidad del vehículo, así que la partición de test **no** puede garantizarse disjunta por
  vehículo (posible fuga entre imágenes del mismo coche).
- `crack` es la etiqueta más débil (F1 0,458): no se presenta como detector fiable de grietas.
- El modelo no reconoce óxido, desgaste, fugas ni ninguna otra condición fuera de las cuatro
  publicadas.
- No hay reentrenamiento automático: volver a entrenar es una ampliación controlada que cambia
  `modelVersion`.

## Reutilización en web y móvil (CU22)

`ml/training/export_model.py` produce `model.tflite` (float32) y `model-fp16.tflite` desde el mismo
artefacto y **verifica** la equivalencia numérica contra el modelo Keras sobre 20 imágenes fijas con
tolerancia `1e-3`; el resultado queda en `export.json`. La conversión a TensorFlow.js se produce si
el conversor está disponible, pero su equivalencia debe verificarla CU22 con un runtime JS: este
pipeline no la acredita.

## `MODEL_NOT_READY`

Sin `manifest.json` o sin el archivo `model.keras` en el directorio del modelo, MS04 responde
`503 MODEL_NOT_READY`, `/health/ready` informa `DOWN` con el motivo y la interfaz lo muestra. No se
generan puntajes, ni se usa un clasificador genérico como sustituto.
