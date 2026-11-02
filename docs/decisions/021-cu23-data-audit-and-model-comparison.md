# 021 — CU23: auditoría de datos y comparación de modelos (MobileNetV2 se mantiene)

Fecha: 2026-11-01. Complementa la decisión [020](020-cu23-visual-intelligence.md) tras revisar la
procedencia, auditar el dataset y comparar candidatos con un protocolo equivalente.

## Hallazgos que cambian afirmaciones previas

1. **Licencia.** El agregado declara CC BY 4.0, pero CarDD —una de sus fuentes declaradas— exige
   formulario y autorización para entregar los datos. La etiqueta del agregador no puede conceder
   esos derechos. Se retira la afirmación «licencia verificada»; ver
   [`contracts/ai/dataset-provenance.md`](../../contracts/ai/dataset-provenance.md).
2. **Preprocesamiento desalineado.** El servicio usaba Pillow y el entrenamiento TensorFlow: la
   diferencia máxima de puntaje era 0,293. Corregido con una única implementación de ops de
   TensorFlow en el servicio; la medición actual es 0,000.
3. **Fuga de datos.** 70 duplicados exactos entre splits, 105 casi duplicados en test y 315
   solapamientos de sesión de captura. Reevaluado sobre el 81 % del test que sobrevive: macro F1
   0,6927 → 0,6920. La fuga no explicaba el resultado, pero ahora está medido.
4. **Sin negativos.** Ninguna imagen del dataset carece de anotación, así que no hay fotografías sin
   daño: se retira cualquier métrica de «algún daño» y se declara que no se puede estimar la tasa de
   falsas alarmas.

## Comparación ejecutada (validación, mismo protocolo)

| Candidato | Macro F1 | Parámetros | Latencia |
| --- | --- | --- | --- |
| MobileNetV2 congelado + cabeza lineal | **0,6631** | 2,26 M | 421 ms |
| MobileNetV2 ajuste de últimas 40 capas | 0,6560 | 2,26 M | 782 ms |
| MobileNetV3-Small congelado | 0,4994 | 0,94 M | 317 ms |
| MobileNetV3-Large congelado | 0,5181 | 3,00 M | 485 ms |

## Decisión

- **Se mantiene MobileNetV2 congelado + cabeza lineal** como artefacto servido: es el mejor en
  validación y el más barato de ejecutar; ni el ajuste fino ni MobileNetV3 lo superan con estos
  datos. La comparación es acotada (subconjunto de 4.000 imágenes; 6 épocas de ajuste fino) y se
  documenta como tal, no como veredicto definitivo.
- **La plataforma no cambia de forma con el modelo**: `INTELLIGENCE_MODEL_PATH` y `modelVersion` son
  configuración. Adoptar un candidato mejor más adelante es producir un artefacto nuevo y apuntar la
  ruta; volver atrás es restaurar el directorio anterior. `ml/artifacts/` nunca se versiona.
- **No se implementa detección/segmentación** en esta entrega. El agregado conserva cajas, así que
  un detector es viable, pero exige otra arquitectura, otro contrato (coordenadas) y otra
  evaluación (mAP); queda como ampliación con su propio diseño, no como cambio silencioso de tarea.
- **Distribución de pesos**: bloqueada hasta resolver la licencia (solicitar autorización a CarDD o
  construir un dataset propio con consentimiento). Mientras tanto el modelo es referencia técnica
  restringida, no artefacto redistribuible.

## Consecuencias en los contratos

- `contracts/ai/vision-model.md`: métricas actualizadas, auditoría, comparación, equivalencia de
  preprocesamiento y límites; sin métricas de «algún daño».
- `contracts/ai/dataset-provenance.md`: estado real de licencia y caminos para resolverlo.
- El servicio sigue declarando `modelVersion` y `insufficientData` por etiqueta; la respuesta no
  cambia de forma.
