# Traspaso 2026-11-01 — CU23 entregado (infraestructura + capacidad visual)

Traspaso anterior: [2026-10-31 CU17](2026-10-31-cu17-cierre.md). Estado global en
[`docs/context/STATUS.md`](../context/STATUS.md).

## Qué quedó hecho

CU23 con sus dos entregables acreditados por separado:

- **Infraestructura funcional**: MS04 `services/intelligence` (FastAPI 0.115, Python 3.11), MongoDB
  propio (`mongo:7.0.45` por digest, `--auth`, sin puerto publicado), permisos
  `intelligence:analyze` / `intelligence:read` (catálogo a 31, migración `1793800800000`),
  contratos REST/GraphQL, gateway del BFF con política por campo y microfrontend React
  `web/mf-intelligence` montado por el Shell en `/intelligence`.
- **Capacidad visual**: MobileNetV2/ImageNet congelado + cabeza propia sobre 11.093 imágenes
  emparejadas por nombre exacto del dataset CC BY 4.0 `tugberkkalay/autodamageiq-vehicle-damage-dataset`.
  F1 macro en test **0,6954**; `crack` 0,458 · `dent` 0,744 · `glass_shatter` 0,765 · `scratch` 0,815.
  `lamp_broken` y `tire_flat` se excluyeron por no tener positivos en test.

Evidencia ignorada: `output/cu23/vision-real.json` (14 etapas), `output/cu23/vision-web.json`
(7 etapas), `output/cu23/*.exit`, `ml/artifacts/…/{manifest,metrics,export}.json`.

## Cómo reproducir

```sh
docker build -f ml/Dockerfile -t autonexus-ml:local .
node ml/training/collect_pairs.mjs --root ml/data --download
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/prepare_dataset.py
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/train.py --epochs 40
docker run --rm -v "$PWD/ml:/work" autonexus-ml:local training/export_model.py
docker compose --env-file .env.example up --build -d          # crea mongo + intelligence
node scripts/cu23/verify-vision-real.mjs                       # CU23_PUBLIC_ORIGIN / CU23_ASSIGNMENT_IDS
node scripts/cu23/verify-vision-web.mjs                        # CU23_ASSIGNMENT_ID (enlace profundo)
```

`ml/data` y `ml/artifacts` no se versionan: en un clon sin artefactos el servicio responde
`503 MODEL_NOT_READY` y la interfaz lo muestra; eso es un estado válido, no una predicción vacía.

## Pendiente / siguientes pasos

- **CU22**: convertir el artefacto a TensorFlow.js y verificar equivalencia numérica en un runtime
  JS; LiteRT float32 ya está verificado (3e-06), fp16 **no** (0,0118) y así se declara.
- **CU23 ampliaciones**: más condiciones (óxido, desgaste, fuga) requieren dataset propio con
  procedencia y etiquetado; hoy no están cubiertas y no se atribuyen al modelo.
- El enlace desde la pantalla de ejecución (mf-employees, Angular) al módulo de Inteligencia queda
  como enlace manual (`/intelligence?assignmentId=…`); un botón directo es trabajo de UI pendiente.
- CU05 sigue con **G2 visual** bloqueado (sin canal de píxeles inspeccionables).
