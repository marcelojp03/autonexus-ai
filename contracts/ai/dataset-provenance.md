# Procedencia y licencia del dataset de CU23 — estado real

Este documento corrige una afirmación previa del cierre de CU23 («licencia verificada»). La
verificación de la fuente original **no confirma** que el agregado de Hugging Face pueda
redistribuirse bajo CC BY 4.0.

## Qué declara cada parte

| Fuente | Declaración | Qué implica |
| --- | --- | --- |
| Agregado `tugberkkalay/autodamageiq-vehicle-damage-dataset` | Licencia CC BY 4.0; fuentes: CarDD + VehiDE + etiquetado humano con GPT-4o | Declara una licencia permisiva sobre un material que él mismo describe como derivado de terceros |
| CarDD (sitio oficial, USTC) | «For downloading the data, please first fill in the licensing form and send us to get the link» + formulario `CarDD_license.pdf` | El acceso se concede por solicitud y autorización; **no** es una licencia abierta que el agregado pueda sublicenciar |
| VehiDE | No verificado en esta sesión | Pendiente de la misma comprobación |

Conclusión: la etiqueta del agregador **no resuelve** la diferencia. Un CC BY 4.0 declarado por
un tercero no puede conceder derechos que el titular original no otorgó.

## Qué hizo este proyecto y qué no

- Se descargaron las imágenes del agregado para un experimento **local y académico**; las imágenes
  **no se versionan** (`ml/data/` está ignorado) ni se redistribuyen con el repositorio.
- Los pesos entrenados (`ml/artifacts/…`, también ignorados) se generaron a partir de ese material.
  Su condición de redistribución hereda la misma incertidumbre: **no se declaran aptos para
  distribución**.
- El servicio, los contratos y la interfaz no dependen del dataset: cambian de artefacto sin tocar
  la plataforma.

## Consecuencia operativa

1. El modelo `automotive-damage-mobilenetv2-v1` se conserva como **referencia técnica restringida**,
   no como artefacto con licencia validada. Así queda escrito en `contracts/ai/vision-model.md` y en
   `docs/context/STATUS.md`.
2. Para poder distribuir un modelo entrenado hay tres caminos, en orden de coste:
   - solicitar la autorización de CarDD con su formulario y conservar la respuesta;
   - construir un dataset propio con imágenes del taller y consentimiento por imagen;
   - entrenar la misma arquitectura sobre un conjunto cuya licencia sea verificable desde el origen.
3. Mientras eso no ocurra, el repositorio **no** incluye imágenes ni pesos en Git, y ningún informe
   afirma que el dataset esté «validado» para el proyecto.

## Qué sí se puede afirmar hoy

- Las imágenes usadas no están en el repositorio.
- La calidad del modelo se mide y se documenta (incluido lo que no funciona: `crack` F1 0,458).
- La plataforma funciona igual con otro artefacto: `INTELLIGENCE_MODEL_PATH` y `modelVersion` son
  configuración, no código.
## Verificación visual de la correspondencia imagen–etiqueta (muestra de 3)

Revisión directa de tres imágenes de test con una sola etiqueta cada una. Las imágenes **no** se
versionan; estas son las observaciones:

| Imagen (test) | Etiqueta | Qué se ve |
| --- | --- | --- |
| `vehide_01102020_094657image929398.jpg` | `dent` | Parte trasera de una camioneta con abolladura visible en parachoques/compuerta: **anotación plausible**. La matrícula es legible: el conjunto **no está redactado** |
| `vehide_01022020_104459image894113.jpg` | `scratch` | Planchas metálicas de **maquinaria/equipo pesado** con recubrimiento desgastado y marcas de inspección: la etiqueta es defendible, pero el dominio **no es un automóvil** |
| `vehide_01022020_153342image229797.jpg` | `glass_shatter` | Carrocería desmontada en taller, **sin parabrisas**: la etiqueta es ambigua para «cristal roto» y el contenido real es un frontal desguazado |

Conclusiones que se incorporan al alcance del modelo:

1. El agregado mezcla **automóviles (CarDD) y equipo pesado (VehiDE)**: no es un dataset
   exclusivamente de carrocería de automóvil.
2. La calidad de anotación es heterogénea; `glass_shatter` incluye casos ambiguos. Un muestreo de
   tres imágenes no certifica el resto: es evidencia de que la etiqueta no se puede dar por buena,
   no una auditoría completa de las 11.093.
3. Hay **matrículas legibles** y marcas de agua de origen: no se publican imágenes del conjunto en
   documentación, capturas ni repositorio.