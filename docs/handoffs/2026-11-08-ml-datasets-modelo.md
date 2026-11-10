# Entrega de datasets y modelo de ML (CU23/CU22) a un compañero

Fecha: 2026-11-08. Autoriza la entrega el propietario del repositorio. Este documento describe
**qué se entrega, con qué hashes, cómo se obtiene el dataset y qué no se puede afirmar** del modelo.

## Qué se entrega dentro del repositorio

A partir de este commit el artefacto del modelo deja de estar ignorado por Git, excepto los datos de
entrenamiento (que siguen fuera) y los intermedios.

| Archivo | Tamaño | SHA-256 |
| --- | ---: | --- |
| `ml/artifacts/automotive-damage-mobilenetv2-v1/20261101T-with-negatives/model.keras` | 9 642 245 B | `bac84606346eca0043bfb3d7c2b162a97764c6bf2fa217d81f821a6d7c9bffe9` |
| `…/manifest.json` | — | `ce44d2174117de364aeb094662010008455a869cdd61284781ddaefeba571765` |
| `…/quality.json` | — | `fdd835cde40960f7a970ab6104cde0e285e4e9b4c31571557690e4bc723e5052` |

`SHA256SUMS` en la misma carpeta permite comprobar la descarga:

```sh
cd ml/artifacts/automotive-damage-mobilenetv2-v1/20261101T-with-negatives
sha256sum -c SHA256SUMS
```

`.gitattributes` marca la carpeta con `-text`: Git no convierte sus fines de línea al hacer checkout,
así que estos hashes valen igual en Linux, macOS y Windows. Una conversión de EOL los invalidaría.

**No hay Git LFS**: son ~9,6 MB, entran en un clon normal. El dataset **no** se versiona.

## Cómo obtener el dataset (externo, CC BY 4.0)

`tugberkkalay/autodamageiq-vehicle-damage-dataset` en Hugging Face, formato YOLO de detección sobre
CarDD + VehiDE + etiquetado humano en el bucle. La descarga está **fijada a la revisión con la que se
entrenó** el modelo entregado:

```
revision = b5abbf54bdf7c8817a4e20b6ab39c8f1fe98a0e5
```

```sh
# desde la raíz del repositorio; la imagen compila TensorFlow en CPU
docker build -f ml/Dockerfile -t autonexus-ml:local .

# descarga las imágenes y anotaciones de esa revisión (idempotente)
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/download_dataset.py
node ml/training/collect_pairs.mjs --root ml/data --download
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/prepare_dataset.py
```

Sin Docker, con Python y `huggingface_hub`, el mismo efecto: `python ml/training/download_dataset.py
--root ml/data` (el script crea `ml/data/dataset.json` con revisión, licencia y conteos).

Esperá **~15 183 imágenes** en origen; el emparejamiento por nombre exacto deja **7 962 train /
1 098 validation / 2 093 test**. Dos límites del conjunto, que no se corrigieron: parte de las
imágenes usa una base numérica distinta a la de sus anotaciones (sólo se emparejan nombres
idénticos) y no publica identidad de vehículo, así que **no hay partición disjunta por vehículo**.

Atribución obligatoria al redistribuir o publicar resultados derivados: dataset
[AutoDamageIQ](https://huggingface.co/datasets/tugberkkalay/autodamageiq-vehicle-damage-dataset) de
`tugberkkalay`, licencia **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/), sobre
agregación de CarDD, VehiDE y etiquetas HITL con GPT-4o.

## Cómo cargar el modelo

`manifest.json` es la fuente de verdad: `runtime` indica `tensorflow-cpu 2.16.2` y
`keras.models.load_model`. Preprocesamiento idéntico al del servicio:

- entrada 224×224 RGB, `tf.image.resize` bilineal con `antialias=True`;
- `keras.applications.mobilenet_v2.preprocess_input` (rango [-1, 1]);
- decodificación con `tf.io.decode_image` (JPEG/PNG).

Etiquetas y umbrales de esta versión (**cuatro**, no seis):

| Etiqueta | Umbral |
| --- | ---: |
| `crack` | 0.25 |
| `dent` | 0.35 |
| `glass_shatter` | 0.40 |
| `scratch` | 0.50 |

MS04 Inteligencia lo consume desde `INTELLIGENCE_MODEL_PATH` (por omisión
`./ml/artifacts/automotive-damage-mobilenetv2-v1/20261101T-with-negatives`); sin artefacto responde `503 MODEL_NOT_READY` y no
inventa puntajes. Los pesos base MobileNetV2 son de ImageNet, **Apache-2.0**, con hash declarado en
`manifest.json` (`f8aff695…`).

## Estado real de calidad: experimental y NO validado

Esto no es un modelo listo para decidir reparaciones. `quality.json` lo declara y conviene leerlo
antes de construir cualquier cosa encima:

- **Falsos positivos medidos**: 6 de 10 vehículos sin daño visible y 5 de 10 imágenes fuera de
  dominio quedaron marcados (muestra pequeña, planos no comparables al entrenamiento).
- Split de test del propio dataset (2 093 imágenes): **macro F1 0.6855**, acierto exacto
  multicriterio 0.4142, F1 de «hay algún daño» 0.9884.
- Por etiqueta, el F1 va de **0.4303 (`crack`)** a 0.8125 (`scratch`); `crack` es débil.
- La evaluación filtrada retrospectivamente da macro F1 0.6846 sobre 1 694 imágenes: **no es una
  prueba final independiente**.
- Faltan los criterios de aceptación de `quality.json` (≥60 imágenes revisadas por condición). No se
  acreditó precisión, ni licencia de distribución de pesos derivados.

En el producto es una **señal para revisión humana**: no mide, no diagnostica y no estima costos.
La revisión del mecánico se guarda por separado con `modelVersion`.

## Reproducir entrenamiento y exportación

```sh
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/train.py --epochs 40
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/export_model.py
```

`train.py` escribe un `modelVersion`/`runId` nuevos: **no sobrescribe** el artefacto entregado y
volver a entrenar es una ampliación controlada, no automática. Para exportar a CU22 (TensorFlow.js /
LiteRT) están `export_tfjs_reference.py`, `ml/Dockerfile.tfjs` y `scripts/cu22/verify-tfjs*.mjs`.

## Qué NO incluye esta entrega

- Imágenes ni anotaciones del dataset (se descargan con la revisión fijada; no se versionan).
- Pesos base de MobileNetV2 (los baja Keras; hash en el manifiesto).
- Cualquier validación de calidad del modelo, licencia de distribución de pesos derivados o
  reentrenamiento con datos del taller. El dataset del taller no existe: los datos de la plataforma
  son sintéticos.
