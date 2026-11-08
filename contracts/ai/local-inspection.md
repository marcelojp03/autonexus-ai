# CU22 — inspección local y alternativa manual

Superficies propietarias del cliente: Flutter/SQLite y Shell PWA/IndexedDB. Se selecciona una
orden mediante su trabajo preparado autorizado; no se añade selección de vehículo independiente.
Los nueve pasos/excepciones se concilian en la evidencia CU22; CU27 feliz ya aprobado se reutiliza.

## Predicción y revisión

La predicción opcional conserva exclusivamente datos reales: runId, modelVersion, hash de imagen
y puntajes originales. Sin modelo/inferencia no se fabrica versión, puntaje cero ni análisis MS04.
La revisión humana es independiente y no sobrescribe predicción ni declara calidad validada:

    inspectionReview: {
      schemaVersion: 1,
      mode: manual | assisted,
      interpretation: texto de 3–1600 caracteres,
      labels: códigos distintos crack/dent/glass_shatter/scratch, opcionales,
      reason: operator_manual | model_unavailable | inference_failed |
              insufficient_resources | below_thresholds | input_rejected,
      reviewedAt: ISO de la observación local
    }

El autor y la orden se heredan del subject/assignmentId/orderId de la copia preparada, no de un
campo de identidad editable. La fecha local no se presenta como validada por servidor. Texto y
etiquetas humanas son datos no confiables, nunca instrucciones o autoridad.

La interpretación usa el texto del avance, sin dos formularios de notas duplicados. Al guardar
una revisión, la descripción enviada al propietario conserva de forma explícita modo, motivo,
etiquetas humanas y texto, con máximo 2000 caracteres. El objeto estructurado permanece local.
Sin predicción se sincronizan avance y foto opcional con el protocolo existente; no se envía
client-inference a MS04. Con predicción real, su corrección se conserva además en humanReview
del contrato existente y modelVersion coincide. Nunca se marca una cola applied por guardarla.

La copia de traslado web pasa a versión 2 al incluir inspectionReview; el lector conserva soporte
de las copias reales versión 1. SQLite añade columna nullable en esquema 7 sin borrar pendientes,
fotos, resultados previos ni estados PKCE. Los registros antiguos no se reclasifican como manuales.

## Fallos y abstención

Preparar trabajo no depende de preparar modelo. Siempre se ofrece registro manual explícito,
incluido cuando falta el modelo o falla la inferencia. Los controles de revisión no quedan ocultos
por falta de predicción; no se precarga una selección humana como si fuera una validación hecha.
En PWA, cargar el modelo en RAM no prueba persistencia offline. El botón de preparación
comprueba el manifiesto construido y todos los recursos del modelo en su caché propia
antes de anunciar disponibilidad sin red. Si esa caché falta o está incompleta, informa
el fallo y mantiene disponible la preparación básica/manual.

No se inventa una confianza clínica global. Si ninguna clase alcanza su umbral del manifiesto
verificado, se informa «no concluyente: ninguna etiqueta alcanza su umbral experimental; no
descarta daño». Se preservan los puntajes y se pide interpretación humana. Un umbral de clase
no equivale a calibración ni a validación diagnóstica; todo resultado actual sigue experimental.

Entradas: JPEG/PNG, hasta 5 MiB, lados mínimos de 32 px; cabecera comprobada antes de decode,
máximo 8192 px por lado y 24 MP. Resolución inferior se clasifica como calidad insuficiente, sin
prometer detección automática completa de desenfoque, iluminación o encuadre. Se puede retomar
imagen o registrar manualmente. No se amplían formatos sólo porque un decoder los admita.

Modelo ausente, archivo inválido, inferencia fallida y recursos insuficientes tienen mensajes y
acciones diferenciados. Se liberan intérpretes/tensores también al fallar. No se llenan disco/RAM
reales para probar: se usan errores controlados, cabeceras límite y bases/cuotas de prueba acotadas.

Cuota/SQLITE_FULL/ENOSPC no son guardado exitoso: borrador/foto anterior se conservan para retry,
no se borra el staging antes del commit y no se devuelve un QueuedAdvance exitoso si enqueue falló.
Tras recuperar capacidad, el reintento debe crear sólo una intención local. No se promete persistir
un borrador que el almacenamiento rechazó ni sobrevivir a un cierre con datos no guardados.

## Capacidad y autoridad

Pruebas funcionales, equivalencia numérica y avisos experimentales no validan la capacidad visual.
La calidad y licencia vigentes siguen en model-registry.md y cu23-acceptance-criteria.md; no hay
entrenamiento, descarga de datos o cambio de métricas en esta conciliación. Cada sincronización
vuelve a autorizar en el propietario. Local/pending nunca equivale a confirmación del servidor.
