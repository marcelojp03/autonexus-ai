---
feature: cu23-visual-intelligence
status: designed
updated: 2026-10-31
source: work/marcelo
---

# CU23 — Análisis de imágenes mediante IA del servidor

## Report

## [S1] Problem

El mecánico adjunta fotografías a un avance (CU16) y hoy sólo puede mirarlas. No existe un servicio que analice la imagen y devuelva una señal objetiva y acotada que ayude a decidir si una pieza o zona merece revisión. CU22 (IA local en web/móvil) tampoco puede reutilizar nada porque no hay modelo ni resultado de referencia.

Restricción explícita: los PNG de 71 bytes usados para probar S3 **no** son dataset ni evidencia de calidad, y una clasificación genérica de ImageNet **no** es un diagnóstico mecánico.

## [S2] Design

### [S2.1] Tarea visual acotada

Clasificación **multi-etiqueta de condición visual** sobre una sola fotografía de evidencia, en cuatro categorías observables, no diagnósticas:

| Etiqueta | Qué significa | Qué NO significa |
| --- | --- | --- |
| `oxido` | superficie con corrosión visible | pieza estructuralmente comprometida |
| `desgaste` | banda de rodadura o superficie con desgaste aparente | medición de espesor o fin de vida útil |
| `fuga` | mancha o residuo líquido visible | identificar fluido o causa |
| `dano` | deformación, grieta o pintura dañada | presupuesto o reparación necesaria |

- Salida: lista de etiquetas con puntaje `0..1` y umbral configurable; el resultado es **señal para revisión humana**, nunca veredicto.
- El servicio declara `modelVersion`, `task`, `labels` y `threshold` en cada respuesta.
- Fuera de alcance: diagnóstico, medición, detección de personas/placas, OCR, video.

### [S2.2] Modelo y procedencia

- Arquitectura: extractor convolucional preentrenado (MobileNetV2 de Keras Applications, licencia Apache-2.0) y **cabeza lineal propia** entrenada sobre las cuatro etiquetas.
- Pesos base: se descargan una vez y se versionan por hash; el repositorio guarda sólo el manifiesto (`modelVersion`, arquitectura, hash, licencia, fecha) y nunca binarios pesados.
- Si no hay artefacto de cabeza entrenada disponible, el servicio responde `503 MODEL_NOT_READY`; no inventa predicciones ni usa ImageNet como sustituto.
- Entrenamiento reproducible: script con partición `train/validation/test`, semilla fija y métricas por etiqueta (precisión, exhaustividad, F1, matriz de confusión). El ajuste fino se documenta como ampliación controlada; **no** hay reentrenamiento automático por inferencia.

### [S2.3] Datos

- Dataset propio con imágenes representativas de taller, procedencia registrada por imagen (`source`, `license`, `capturedAt`) y consentimiento cuando aplique.
- Mínimo declarado para considerar el modelo evaluado: 40 imágenes por etiqueta, split 70/15/15. Por debajo, el servicio sigue funcionando pero el informe declara `insufficient-data`.
- Sin dataset autorizado, el bloque entrega pipeline + servicio + UI con `MODEL_NOT_READY` y lo declara; no se presenta entrenamiento con datos sintéticos como precisión del taller.

### [S2.4] Servicio de Inteligencia (FastAPI + MongoDB)

- `GET /health/live|ready` (ready verifica Mongo y modelo cargado).
- `POST /vision/analyze` — cuerpo `{evidenceId, orderId, contentType, imageBase64}` o descarga autorizada desde Operaciones; responde `{analysisId, modelVersion, labels[], threshold, createdAt, insufficientData}`.
- `GET /vision/analyses/{analysisId}` y `GET /vision/orders/{orderId}` — consulta del histórico.
- MongoDB: colección `vision_analyses` con índice por `orderId, createdAt` y por `evidenceId`.
- Autorización: el servicio valida el token y pide permisos a Empleados; permiso nuevo `intelligence:analyze` (escritorio y móvil) y `intelligence:read` para consulta.
- El binario se procesa en memoria y **no** se persiste; sólo se guardan etiquetas, puntajes, hash de la imagen y metadatos.

### [S2.5] Contratos y BFF

- `contracts/rest/intelligence.md` + `contracts/graphql/intelligence.graphql` (`analyzeEvidence`, `analysis`, `orderAnalyses`).
- BFF: campos raíz con permiso propio, gateway hacia el servicio, allowlist de códigos (`MODEL_NOT_READY`, `IMAGE_INVALID`, `EVIDENCE_NOT_AVAILABLE`, `ANALYSIS_NOT_FOUND`).

### [S2.6] Interfaz

- En el detalle de ejecución (CU16), junto a cada evidencia `available`: acción «Analizar imagen» y un panel con etiquetas, puntajes y el aviso «señal para revisión humana, no diagnóstico».
- Historial por orden en la ficha de verificación (CU17) para jefatura.
- Estados de UI: sin modelo (`MODEL_NOT_READY`), imagen no disponible, análisis en curso, resultado, error.

### [S2.7] Reutilización en web y móvil (CU22)

- El modelo visual se exporta a TensorFlow.js (web) y LiteRT/TFLite (móvil) desde el mismo artefacto, verificando que la conversión produce puntajes equivalentes dentro de una tolerancia declarada sobre un conjunto fijo de imágenes.
- CU22 usa el mismo contrato de etiquetas; si la conversión no está verificada, CU22 no se acredita aunque CU23 funcione.

## [S3] Out of Scope

CU24 (duración), diagnóstico mecánico, vídeo, reentrenamiento automático, dataset sin licencia verificable, detector de matrículas o personas, y cualquier afirmación de precisión sin partición de evaluación.

## Tasks

- [ ] T1: Servicio FastAPI con MongoDB, health, autorización por permiso y `vision_analyses` — acceptance: arranca contra Mongo real y persiste/lee un análisis (covers: S2.4).
- [ ] T2: Manifiesto de modelo, pipeline de carga y `MODEL_NOT_READY` honesto — acceptance: sin artefacto responde 503 y con artefacto sirve etiquetas (covers: S2.2).
- [ ] T3: Dataset y entrenamiento reproducible con métricas y partición — acceptance: script produce métricas por etiqueta y registra procedencia (depends: T2; covers: S2.3).
- [ ] T4: Contratos REST/GraphQL, BFF y permisos — acceptance: campos autorizados por permiso y pruebas (depends: T1; covers: S2.5).
- [ ] T5: UI de análisis en ejecución y en verificación — acceptance: analizar una evidencia real y ver resultado con el aviso (depends: T4; covers: S2.6).
- [ ] T6: Preparación de conversión web/móvil con verificación de equivalencia — acceptance: tolerancia declarada y comprobada (depends: T2; covers: S2.7).
- [ ] T7: Verificación real, revisión e integración — acceptance: recorrido real sobre una imagen representativa y estado del modelo declarado con exactitud (depends: T3, T5).

## Journey log

- Decisión del usuario (2026-10-31): CU24 no bloquea CU23; si faltan duraciones observadas se documenta y se avanza visión. Los PNG sintéticos de CU16 no sirven como dataset ni como evidencia de calidad, y una clasificación genérica no se presenta como diagnóstico mecánico.
