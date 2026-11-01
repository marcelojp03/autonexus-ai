# 020 — CU23: análisis visual del servidor (MS04 + MongoDB + MobileNetV2)

Fecha: 2026-10-31. Diseño en `docs/compose/spec/cu23-visual-intelligence.md`. Contratos:
[`contracts/rest/intelligence.md`](../../contracts/rest/intelligence.md),
[`contracts/graphql/intelligence.graphql`](../../contracts/graphql/intelligence.graphql) y
[`contracts/ai/vision-model.md`](../../contracts/ai/vision-model.md).

## Decisiones

1. **Dos entregables separados**, como pidió el operador: *infraestructura funcional* (FastAPI,
   MongoDB, autorización por permiso, contratos, BFF y microfrontend) y *capacidad visual* (modelo
   real, imágenes representativas con licencia, evaluación particionada y recorrido integrado).
   `MODEL_NOT_READY` es un estado válido del sistema y **no** acredita el requisito de IA.
2. **Servicio propietario nuevo** `services/intelligence` (MS04) con FastAPI, MongoDB
   `autonexus_intelligence` y la colección `vision_analyses`. Sólo persiste etiquetas, puntajes,
   umbrales, hash de la imagen y metadatos: **los bytes no se guardan**.
3. **El cliente no aporta bytes ni URLs.** La evidencia se identifica por `assignmentId` +
   `evidenceId`; MS04 pide a Operaciones la descarga prefirmada **con el token del actor**, la lee
   en memoria y la descarta. Un cliente no puede pedir que se analice una URL arbitraria ni un
   archivo fuera de una evidencia autorizada, y el bucket privado no se expone.
4. **Autorización en dos capas.** Permiso del catálogo (`intelligence:analyze` / `intelligence:read`)
   resuelto contra Empleados con caché de 30 s y fallo cerrado, **y** alcance por registro
   revalidado en Operaciones (`GET /executions/me|team/:assignmentId`) en cada petición. El permiso
   por registro no se hereda del token ni del análisis ya guardado.
5. **Modelo honesto y versionado.** MobileNetV2/ImageNet (Apache-2.0) congelado + cabeza lineal
   propia, sobre el dataset CC BY 4.0 indicado en el manifiesto. El artefacto es del operador: se
   monta de sólo lectura y el repositorio guarda el manifiesto con `modelVersion`, licencia,
   revisión del dataset, preprocesamiento, umbrales por etiqueta y métricas de test.
6. **Emparejamiento por nombre exacto.** El dataset publicado renombra parte de sus imágenes con
   otra base numérica; se usan sólo stems presentes en ambos lados y se excluyen 1.000 imágenes de
   entrenamiento sin anotación homónima. Emparejar por posición habría adjuntado anotaciones falsas.
7. **Idempotencia por (evidencia, modelo, hash)**: repetir el análisis devuelve el mismo documento
   con `replayed: true`; no hay duplicados por doble clic.
8. **Compose**: servicios `mongo` (imagen fijada por digest, `--auth`, sin puerto publicado, cinco
   capacidades mínimas que el entrypoint oficial necesita) e `intelligence` (sin puerto publicado,
   `cap_drop: ALL`, artefacto por bind de sólo lectura). El BFF depende de `intelligence` como
   `service_started`, no `healthy`, para que un despliegue sin modelo siga siendo navegable y
   muestre `MODEL_NOT_READY` en vez de bloquear la plataforma.
9. **Audiencias**: nuevo cliente `autonexus-intelligence-api` añadido a las audiencias que emite el
   cliente interactivo del Shell, y `autonexus-mf-intelligence` como cliente interactivo propio.

## Límites declarados

- Señal para revisión humana: no es diagnóstico, no mide espesores y no estima reparaciones.
- El dataset no publica identidad de vehículo: la partición de test no puede garantizarse disjunta
  por vehículo.
- El modelo sólo reconoce las seis etiquetas entrenadas; no infiere fugas, desgaste de neumático ni
  otras condiciones que no estén en el manifiesto.
- La conversión web (TensorFlow.js) se produce y se documenta, pero su equivalencia numérica debe
  verificarla CU22 con un runtime JS antes de acreditar el modelo en web/móvil.
