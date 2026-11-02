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
