# ml — modelo visual de CU23

Cadena reproducible que produce el artefacto que consume MS04 Inteligencia. Los datos de
entrenamiento (`ml/data/`) y los ficheros `.npy`/`.npz` **no** se versionan. El artefacto entregado
sí: `ml/artifacts/<modelVersion>/<runId>/` con `model.keras`, `manifest.json`, `quality.json` y
`SHA256SUMS` viaja en el repositorio para que otro integrante trabaje sin regenerarlo. La entrega a
un compañero —hashes, descarga del dataset con revisión fijada, licencias y límites— está en
[docs/handoffs/2026-11-08-ml-datasets-modelo.md](../docs/handoffs/2026-11-08-ml-datasets-modelo.md).

## Tarea y modelo

Clasificación multi-etiqueta de daño visible en fotografías de vehículo. El dataset declara seis
clases (`crack`, `dent`, `glass_shatter`, `lamp_broken`, `scratch`, `tire_flat`), pero el artefacto
entregado publica **cuatro** (`crack`, `dent`, `glass_shatter`, `scratch`): el resto se descartó por
no tener positivos suficientes en la evaluación. Las etiquetas y umbrales vigentes son los del
`manifest.json`, no esta lista. Extractor **MobileNetV2** de Keras Applications con pesos ImageNet (licencia
Apache-2.0) congelado y cabeza lineal propia entrenada sobre las anotaciones del dataset. La salida
es una **señal para revisión humana**: no mide, no diagnostica y no estima reparaciones.

## Dataset

`tugberkkalay/autodamageiq-vehicle-damage-dataset` (Hugging Face), declarado **CC BY 4.0**,
formato YOLO de detección sobre una agregación de CarDD, VehiDE y etiquetado humano en el bucle
(GPT-4o). Las cajas se colapsan a etiquetas por imagen porque la capacidad entregada es una señal
por fotografía, no una medición por región.

Dos límites del conjunto que **se declaran y se respetan**:

1. El dataset renombra parte de sus imágenes con una base numérica distinta a la de sus ficheros de
   anotación (`existing_damage_01000.jpg` no tiene `existing_damage_01000.txt`). Por eso el
   emparejamiento se hace **sólo por nombre exacto** (`ml/training/collect_pairs.mjs`) y las
   imágenes sin anotación homónima quedan excluidas. Emparejar por posición o por un desplazamiento
   adivinado adjuntaría anotaciones equivocadas y no se hace.
2. No publica la identidad del vehículo, así que la partición de evaluación no puede garantizarse
   disjunta por vehículo. Se declara como limitación en el manifiesto.

## Comandos comprobados (Docker, CPU)

```sh
# 1. Imagen de entrenamiento (desde la raíz del repositorio)
docker build -f ml/Dockerfile -t autonexus-ml:local .

# 2. Descarga del dataset (imágenes) y de las anotaciones emparejadas
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/download_dataset.py
node ml/training/collect_pairs.mjs --root ml/data --download

# 3. Índice de particiones (train 85 % / validation 15 % del split de entrenamiento; test = split val)
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/prepare_dataset.py

# 4. Entrenamiento, umbrales por etiqueta y evaluación en el split de test
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/train.py --epochs 40

# 5. Exportación para CU22 (web TensorFlow.js / móvil LiteRT) y comprobación de equivalencia
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/export_model.py
```

Resultado: `ml/artifacts/<modelVersion>/` con `model.keras`, `manifest.json` y `metrics.json`. La
carpeta se monta de sólo lectura en el contenedor de Inteligencia
(`INTELLIGENCE_MODEL_PATH`, por defecto `./ml/artifacts/automotive-damage-mobilenetv2-v1`). Sin
artefacto el servicio responde `503 MODEL_NOT_READY` y **no** inventa puntajes.

## Honestidad de las cifras

- Las métricas del manifiesto provienen de una única ejecución de este pipeline sobre el split de
  test, que no participa del ajuste ni de la elección de umbrales.
- Un etiqueta con menos de 40 imágenes positivas en test marca `insufficientData` en la respuesta;
  el resultado se sigue sirviendo, pero no se presenta como capacidad medida.
- No hay reentrenamiento automático: volver a entrenar es una ampliación controlada y cambia
  `modelVersion`.
## Auditoría y comparación (antes de creer en un número)

```sh
# Duplicados exactos/casi duplicados, solapamiento de sesión de captura y negativos
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/audit_dataset.py
# Reevaluación del artefacto servido sobre el test que sobrevive a la auditoría
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/reeval_clean.py
# Equivalencia entrenamiento <-> servicio (monta el código del servicio real)
docker run --rm -v "$PWD/ml:/work" -v "$PWD/services/intelligence/app:/app/app:ro" \
  autonexus-ml:local training/check_preprocessing.py --service-app /app/app
# Comparación de backbones: mismo protocolo, se elige por validación
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/compare_models.py --subset 4000
```

Resultados medidos (2026-11-01): 70 duplicados exactos entre splits, 105 casi duplicados en test,
315 solapamientos de sesión, **0 imágenes sin daño**; macro F1 0,6927 en test completo y 0,6920 en
test limpio. MobileNetV2 congelado gana la comparación (0,6631 de validación) frente a ajuste de
últimas capas (0,6560), V3-Small (0,4994) y V3-Large (0,5181). Detalle en
[`contracts/ai/vision-model.md`](../contracts/ai/vision-model.md).
## Negativos con licencia (la métrica que faltaba)

```sh
# Descarga 80 imágenes de Wikimedia Commons con licencia y autor registrados (CC0/PD/CC BY(-SA))
node ml/training/fetch_negatives.mjs --per-group 40 --root ml/data
# Reescribe el índice: 60 negativos al ajuste, 20 retenidos para medir falsas alarmas
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/prepare_dataset.py
# Tasa de falsas alarmas sobre los 20 retenidos
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/evaluate_negatives.py
```

Medido: sin negativos en entrenamiento, el modelo marcaba 10/10 autos sin daño y 10/10 imágenes
fuera de dominio; con 60 negativos baja a 6/10 y 5/10 (macro F1 en test limpio 0,6846). Sigue sin
pasar una puerta razonable de uso: el artefacto se sirve porque es el mejor disponible, no porque
esté validado.