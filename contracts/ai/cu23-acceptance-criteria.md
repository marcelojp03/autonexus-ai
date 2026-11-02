# CU23 — criterios de aceptación, prueba independiente y candidatos de datos

Estado: **capacidad visual experimental, no validada**. La infraestructura (servicio, MongoDB,
permisos, BFF, interfaz) está integrada y verificada; el modelo servido no cumple todavía los
criterios de abajo y la interfaz lo declara (banner con `runId` y estado de calidad).

## 1. Criterios de aceptación (fijados antes de la siguiente comparación)

Un artefacto sólo se marcará `validated` si cumple **todos**:

| Criterio | Umbral | Por qué |
| --- | --- | --- |
| Falsas alarmas · vehículo sin daño, encuadre comparable al de entrenamiento | ≤ 0,20 sobre ≥ 60 imágenes revisadas a mano | Es el uso real: decidir si una foto de una pieza merece revisión |
| Falsas alarmas · planos abiertos de vehículo sin daño | se reporta aparte, sin umbral | El encuadre cambia el problema; mezclarlo con el anterior engaña |
| Falsas alarmas · fuera de dominio | ≤ 0,10 sobre ≥ 60 imágenes revisadas | Un modelo que dispara con cualquier foto no es una señal |
| Exhaustividad por etiqueta | ≥ 0,70 con ≥ 40 positivos revisados | Publicar una etiqueta exige soporte suficiente |
| Incertidumbre | intervalo de confianza al 95 % reportado junto a cada tasa | Con 60 imágenes, ±0,12 es normal: sin intervalo, el número se sobreinterpreta |
| Prueba final | conjunto reservado **antes** de elegir umbrales o arquitectura, con positivos, negativos y fuera de dominio revisados, usado **una vez** | El conjunto observado ya no sirve como prueba intacta |

Además, cada tasa se publica con su tamaño de muestra. Ninguna cifra se presenta sin él.

## 2. Qué invalida la medición anterior (y por qué)

- Los 20 negativos retenidos **ya fueron observados** y se usaron para decidir que el modelo no
  servía. No son una prueba final intacta: sirven como diagnóstico histórico.
- Al revisar las imágenes una por una, los "autos estacionados" resultaron ser **planos abiertos de
  calle y estacionamiento**, no paneles en detalle como el conjunto de entrenamiento. La tasa 6/10
  mezcla "reacciona a un auto sano" con "reacciona a un encuadre que no vio nunca".
- Por eso los criterios separan ambos casos y el conjunto de aceptación exige encuadre comparable.

## 3. Candidatos de datos con procedencia verificada en el origen

| Candidato | Licencia declarada por el titular | Contenido | Estado en esta entrega |
| --- | --- | --- | --- |
| Humans in the Loop — *Car Parts and Car Damages* | **CC0 1.0** (dedicación al dominio público) | 1.812 imágenes (998 de piezas, 814 de daños), 24.851 polígonos; daños: `Dent`, `Cracked`, `Scratch`, `Flaking`, `Broken part`, `Paint chip`, `Missing part`, `Corrosion` | **No descargado**: la página entrega el archivo tras un formulario. Enviarlo es una comunicación a un tercero y no se hace automáticamente. Acción del operador: completar el formulario y descargar (no requiere autorización individual como CarDD) |
| SYNDCAR — U. Minho / DTx CoLAB (Mendeley Data, DOI `10.17632/hzpj48krdt.1`) | **CC BY 4.0** | 245 imágenes **sintéticas**, 4 clases de daño (`broken glass`, `broken lights`, `cracks`, `scratch`) y 28 piezas en polígonos; formato YOLO; cinco dispositivos de captura para trazabilidad | **No descargado**: los enlaces de archivo se sirven por la interfaz JS; no se resolvió una descarga directa por API. Acción del operador: descargar el ZIP desde la página (sin mensaje a terceros) |
| Agregado actual (CarDD + VehiDE + HITL) | CC BY 4.0 declarado por el agregador, **contradicho** por la condición de acceso de CarDD | 12.094 imágenes | Se conserva **sólo como antecedente restringido**. No se mezclará con los conjuntos nuevos |

Notas que se respetan al experimentar:

- Las 998 imágenes de **piezas** de HITL **no** son vehículos sin daño: son recortes de piezas
  anotadas. No entran como negativos sin revisión.
- SYNDCAR es **sintético**: su desempeño no se traslada automáticamente a fotografías reales y así
  se reportará.
- El nuevo candidato se entrenará desde los pesos base preentrenados autorizados (ImageNet), **sin
  reutilizar** la cabeza entrenada con el agregado cuestionado.

## 4. Protocolo de la próxima comparación (cuando los datos estén descargados)

1. **Partición antes de mirar**: separar por identificador de dispositivo/sesión (SYNDCAR incluye
   el ID del dispositivo en el nombre) y por sesión de captura cuando exista; reservar ~20 % como
   prueba final, sin mirarla hasta el cierre.
2. **Revisión manual** de la prueba final: etiqueta correcta, daño visible, y para negativos
   "sin daño" con encuadre comparable.
3. **Entrenamiento** desde ImageNet con cabeza nueva; umbrales elegidos **sólo** en validación.
4. **Comparación** de: macro F1 por etiqueta, falsas alarmas por estrato (cierre, plano abierto,
   fuera de dominio), latencia CPU, tamaño del artefacto y viabilidad TFLite/TFJS.
5. **Una sola** evaluación en la prueba final; si se cambia algo después, la prueba se agota y hay
   que reservar otra.
6. Publicar intervalos de confianza y tamaños de muestra junto a cada número.

## 5. Estado de las otras vías ya autorizadas

- **Detección/segmentación**: viable con estos conjuntos (ambos traen cajas o polígonos) y sería la
  respuesta a "¿dónde está el daño?", que la clasificación no da. Requiere otro contrato (coordenadas)
  y otra métrica (mAP). No se implementa en esta entrega; queda como ampliación con su propio diseño.
- **Modelo especializado preentrenado**: no se encontró uno con licencia verificable y métricas
  publicadas para daño automotriz; si aparece, se evalúa con el mismo protocolo.
- **Autorización CarDD**: solicitud redactada en `docs/legal/cardd-authorization-request.md`, **no
  enviada**. Estas dos alternativas permiten avanzar sin depender de esa respuesta.
