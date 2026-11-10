# ml/artifacts

Artefactos del modelo que consume MS04 Inteligencia.

Desde 2026-11-08 el artefacto **entregado** se versiona en este repositorio, porque es lo que corre
en el producto y no se puede regenerar sin descargar el dataset externo:

```
<modelVersion>/<runId>/
  model.keras      # pesos; ~9,6 MB
  manifest.json    # etiquetas, umbrales, preprocesamiento, dataset y métricas
  quality.json     # estado real de calidad y criterios de aceptación pendientes
  SHA256SUMS       # verificación de los tres anteriores
```

Lo que **no** se versiona: los datos de entrenamiento (`ml/data/`), los pesos base de MobileNetV2
(Keras los descarga; su hash está en el manifiesto) y cualquier artefacto intermedio (`.npy`/`.npz`,
checkpoints). Publicar un artefacto nuevo se hace creando otra carpeta `<modelVersion>/<runId>`; no se
sobrescribe el existente.

Entrega, hashes, licencias y límites: `docs/handoffs/2026-11-08-ml-datasets-modelo.md`.

`quality.json` marca el modelo como **experimental y no validado**. Versionarlo no lo convierte en
una capacidad acreditada: la señal es para revisión humana.
