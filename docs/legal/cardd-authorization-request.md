# Solicitud de autorización a CarDD — borrador (NO enviado)

> **Estado: borrador.** No se ha enviado ningún correo ni formulario. Este documento existe para que
> la persona responsable del proyecto decida y envíe. Mientras no haya respuesta, el dataset y los
> pesos derivados siguen marcados como **restringidos** en `contracts/ai/dataset-provenance.md`.

## Por qué hace falta

El conjunto usado para entrenar (`tugberkkalay/autodamageiq-vehicle-damage-dataset`) declara CC BY 4.0,
pero una de sus fuentes declaradas es **CarDD**, cuyos autores publican:

> «For downloading the data, please first fill in the licensing form and send us to get the link.»
> — https://cardd-ustc.github.io/ (formulario: `/docs/CarDD_license.pdf`)

Un tercero no puede sublicenciar ese material. Por lo tanto:

- **No** se puede afirmar que el dataset tenga licencia verificable.
- **No** se puede afirmar que los pesos entrenados sean redistribuibles.
- No publicar las imágenes en el repositorio **no** es suficiente: el modelo entrenado con ellas
  también puede considerarse obra derivada según cómo se interprete la licencia original.

## Qué hay que pedir (tres permisos distintos)

1. **Uso académico** del conjunto CarDD en este proyecto de curso (investigación sin fines
   comerciales, sin redistribución de imágenes).
2. **Distribución del modelo entrenado** con esas imágenes (pesos), al menos dentro del repositorio
   académico del curso y sin uso comercial.
3. **Autorización de los datos derivados** que se producen: etiquetas a nivel de imagen, métricas y
   manifiestos de evaluación (no las imágenes originales).

Si (2) no se concede, la alternativa es entrenar el modelo final con un conjunto propio.

## Texto propuesto (inglés, para el formulario o el correo)

> Subject: CarDD licence request — academic project, model training and non-commercial distribution
>
> Dear CarDD authors,
>
> We are a software engineering course team at Universidad Autónoma Gabriel René Moreno (Bolivia).
> We are building an academic workshop-management system that includes a visual inspection aid for
> vehicle damage: a photograph is classified into a few damage categories and the result is shown to
> a mechanic as a *signal for human review*, never as a diagnosis.
>
> We would like to request the CarDD dataset under your licence terms for the following uses:
> 1. non-commercial academic research and model training;
> 2. distribution of the trained model weights in our course repository (no images redistributed);
> 3. publication of aggregate results (per-class precision/recall) in our course report.
>
> We will not redistribute the images, will cite your paper
> (Wang, Li, Wu — *CarDD: A New Dataset for Vision-based Car Damage Detection*, IEEE T-ITS 2023) and
> will follow any additional conditions you require. If distributing the weights is not covered by
> your licence, please tell us and we will train the final model on our own data instead.
>
> Contact: <responsable del proyecto>
> Project: <URL del repositorio académico>
>
> Kind regards,

## Qué hacer cuando llegue la respuesta

| Respuesta | Acción |
| --- | --- |
| Autoriza uso académico y pesos | Actualizar `dataset-provenance.md` con la fecha y el alcance concedido; el artefacto pasa a «licencia documentada» con esa condición |
| Solo autoriza uso interno, no pesos | Mantener el artefacto como interno, no publicarlo, y entrenar el modelo final con datos propios |
| No responde / deniega | Entrenar con un conjunto propio (imágenes de taller con consentimiento por imagen) o con un dataset cuya licencia se verifique en el origen |

## Comprobaciones pendientes que no dependen de la respuesta

- Ampliar la muestra de anotaciones revisadas (hoy: 3 imágenes) con una muestra aleatoria mayor.
- Construir un conjunto equilibrado de negativos (hoy: 80 imágenes con licencia, 60 en entrenamiento)
  para bajar la tasa de falsas alarmas, que sigue en 0,60 sobre autos sin daño.
- Reservar una prueba final independiente: la evaluación actual se filtró retrospectivamente
  (duplicados y sesiones), lo que **no** sustituye una nueva prueba separada desde el inicio.
