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
