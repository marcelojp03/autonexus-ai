# Registro de artefactos del modelo visual (CU23)

Cada corrida de entrenamiento produce un directorio propio —
`ml/artifacts/<modelVersion>/<runId>/`— con `model.keras`, `manifest.json`, `metrics.json` y los
informes de auditoría. **Ninguna corrida sobrescribe a otra**: `train.py` crea el directorio con
`exist_ok=False` y el manifiesto incluye `runId`, `artifact.sha256` y `preprocessingFingerprint`.
Los artefactos no se versionan en Git (son binarios y dependen de datos restringidos); este registro
sí, y es la referencia de qué se ejecutó.

## Corridas

| `runId` | Fecha | Artefacto (SHA-256 del `.keras`) | Preprocesamiento | Macro F1 test | Estado |
| --- | --- | --- | --- | --- | --- |
| `run-1` (sin id de corrida) | 2026-10-31 | **no registrado** (binario sobrescrito, ver nota) | TensorFlow + `antialias=False` | 0,6954 | Reemplazado |
| `20261101T-aligned-antialias` | 2026-11-01 | `49a4542a1f935912…` (9.642.245 bytes) | TensorFlow + `antialias=True`, idéntico al servicio | 0,6927 (test limpio 0,6920) | Conservado para volver atrás |
| `20261101T-with-negatives` | 2026-11-01 | ver manifiesto de la corrida | TensorFlow + `antialias=True`, idéntico al servicio | 0,6855 (test limpio 0,6846) | **Servido** |

### Nota sobre `run-1`

La primera corrida se guardó en un directorio plano
(`ml/artifacts/automotive-damage-mobilenetv2-v1/`) y un reentrenamiento posterior lo sobrescribió
durante la investigación de preprocesamiento. Su **identidad documental** se conserva (métricas,
umbrales y descripción en el historial de este registro y en `docs/decisions/021-…`), pero su
binario ya no es recuperable. Ese incidente es la razón por la que hoy cada corrida tiene su propio
`runId` y el script se niega a reutilizar un directorio.

## Puerta de calidad (medida, no declarada)

| Artefacto | Falsas alarmas en autos sin daño (10) | Falsas alarmas fuera de dominio (10) | Macro F1 test limpio |
| --- | --- | --- | --- |
| `20261101T-aligned-antialias` (sin negativos en entrenamiento) | 10/10 = 1,00 | 10/10 = 1,00 | 0,6920 |
| `20261101T-with-negatives` (60 negativos con licencia en entrenamiento) | 6/10 = 0,60 | 5/10 = 0,50 | 0,6846 |

**Ningún artefacto pasa una puerta razonable de uso.** Incorporar negativos redujo las falsas
alarmas a la mitad, pero 6 de cada 10 autos sin daño siguen marcados: como señal de revisión, el
modelo no es utilizable todavía. Falta un conjunto equilibrado (miles de negativos) y, idealmente,
unidades con daño y sin daño de la misma sesión. Hasta entonces la capacidad visual se declara
**no validada para uso**, aunque la plataforma (servicio, permisos, persistencia, UI) funciona.

## Relación pesos ↔ preprocesamiento ↔ datos ↔ métricas

El manifiesto de cada corrida es autocontenido y verificable:

| Campo | Qué ata |
| --- | --- |
| `runId` | Identifica la corrida; el servicio lo publica en `/health/ready` y en `/vision/model` |
| `artifact.sha256` / `artifact.bytes` | Hash del `.keras` servido: se puede comprobar contra el archivo montado |
| `preprocessingFingerprint` | Hash canónico del bloque de preprocesamiento (tamaño, color, resize, escala, decoder) |
| `dataset.name` / `dataset.revision` | Repositorio y revisión exacta del dataset usado |
| `dataset.splits` | Conteo de imágenes y positivos por etiqueta en cada partición |
| `thresholds` | Umbrales por etiqueta elegidos **sólo** en validación |
| `metrics.test` / `metrics.validation` | Resultados por etiqueta y macro |
| `clean-evaluation.json` | Reevaluación sobre el test que sobrevive a la auditoría de duplicados |
| `preprocessing.json` | Equivalencia medida entre el pipeline de entrenamiento y el del servicio |
| `export.json` | Equivalencia de las conversiones LiteRT/TFJS |

## Cómo se comprueba hoy

```sh
# Hash del artefacto servido frente al manifiesto
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local -c "import json,hashlib,pathlib;d=pathlib.Path('/work/artifacts/automotive-damage-mobilenetv2-v1/20261101T-aligned-antialias');m=json.loads((d/'manifest.json').read_text());h=hashlib.sha256((d/'model.keras').read_bytes()).hexdigest();print(h==m['artifact']['sha256'])"
```

## Volver a una versión anterior

Copiar el directorio de la corrida anterior a `INTELLIGENCE_MODEL_PATH` y reiniciar el servicio. No
hay migración de datos: los análisis guardados conservan el `modelVersion`/`runId` con el que se
produjeron, así que un resultado antiguo nunca se atribuye a un modelo nuevo.
## Candidato entrenado sólo con datos de licencia verificable (2026-11-02)

| `runId` | Dataset | Split | Macro F1 validación | Macro F1 test | Estado |
| --- | --- | --- | --- | --- | --- |
| `20261102T-syndcar-device-split` | SYNDCAR (CC BY 4.0, sintético, 245 imágenes) | **por dispositivo de captura**: ID1 entrena (177), ID2 valida (47), ID3–ID5 test (21) | 0,9836 | **0,4747** | Candidato documentado; **no** servido |

Lectura: el mismo modelo que acierta casi perfecto en el dispositivo de validación cae a 0,47 al
cambiar de dispositivo de captura. Es el tipo de comparación que un split aleatorio habría ocultado.
**Estas cifras no son comparables con las del agregado**: distinto conjunto de etiquetas (4 clases de
daño frente a 4 distintas), dominio sintético frente a fotografías reales, y partición por
dispositivo frente a partición por hash de ruta. Sirven para decidir si vale la pena seguir por esta
vía, no para decir «mejor» o «peor» que el artefacto servido.
Además el conjunto es **sintético** y no trae clase «sin daño»: 14 imágenes sin caja se reportan
aparte (14/14 marcadas, IC95 0,78–1,00) porque en un set sintético la ausencia de cajas puede ser una
anotación faltante, no un vehículo sano. No se integra: no supera al artefacto actual en el uso real
y no hay negativos fiables.

## Conversión TensorFlow.js — desbloqueada y verificada (2026-11-02)

| Comprobación | Resultado |
| --- | --- |
| Entorno aislado (`ml/Dockerfile.tfjs`) | TF-CPU 2.15.1 + `tensorflowjs` 4.20.0 + protobuf 4.25.9: el conversor **importa** y convierte (el conflicto de 2.16/4.22 era la combinación, no la versión de TF sola) |
| Equivalencia en Node (`@tensorflow/tfjs` 4.20.0, CPU) | Diferencia máxima **3e-06** sobre 20 imágenes, tolerancia 1e-2 |
| Equivalencia en navegador (Chromium, backend WebGL) | Diferencia máxima **2e-06**, 0 errores de consola |

Artefacto: `tfjs/model.json` + 3 fragmentos de pesos, generado desde el `SavedModel` de la corrida
servida. Scripts: `scripts/cu22/verify-tfjs.mjs` y `scripts/cu22/verify-tfjs-browser.mjs`
(referencia y entradas fijas en `tfjs-check/`).
## Recorrido completo desde la fotografía original (2026-11-02)

La equivalencia anterior comparaba tensores ya preprocesados. Estas dos ejecuciones cubren el camino
completo: **decodificación → orientación EXIF → redimensionado con antialias → normalización →
inferencia**, contra la referencia del servidor calculada sobre los mismos bytes.

| Plataforma | Dispositivo / runtime | `runId` | Diferencia máxima | Latencia | Resultado |
| --- | --- | --- | --- | --- | --- |
| Android | **Mi A3, Android 16 (API 36), arm64** (`ff77c09b1c12`), LiteRT con 4 hilos | `20261101T-with-negatives` | **0,0130** (crack 0,0060 · dent 0,0130 · glass_shatter 0,0007 · scratch 0,0001) | 1076 ms en frío · **648 ms en caliente** | PASS |
| Web | Chromium real, `@tensorflow/tfjs` 4.20.0 backend **WebGL** | `20261101T-with-negatives` | **0,0070** (crack 0,0063 · dent 0,0070 · glass_shatter 0,0002 · scratch 0,0002) | — | PASS |

Hallazgo por el camino: el redimensionado del paquete `image` (`linear` y luego `average`) desviaba
la puntuación de `scratch` hasta 0,084 porque su soporte no escala con el factor de reducción. Se
implementó en Dart y en JS el mismo filtro triangular con soporte proporcional que usa
`tf.image.resize(antialias=True)`, y la desviación bajó a 0,013 / 0,007. Sin eso, «funciona en el
dispositivo» habría sido una afirmación falsa: daba números distintos a los del servidor.

Evidencia: `output/cu23/device-inference.json`, `output/cu23/tfjs-photo-browser.json`.
