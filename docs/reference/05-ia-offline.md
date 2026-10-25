# 05 — IA local y remota, PWA, offline y sincronización
Fuente: https://app.notion.com/p/4032585d73c181328c87ed44bf1b5b91?pvs=204
Copia local exportada el 2026-10-25. Revisar vigencia en Notion antes de cambiar decisiones; estados/relaciones propuestos no son aprobaciones.

**Detalle de implementación del alcance vigente.** La elección de modelos, clases visuales, umbrales y objetivos de rendimiento deberá validarse con datos y dispositivos; no se atribuyen métricas todavía no medidas.

## IMPLEMENTACIÓN DETALLADA DE LA PWA

Este apartado concreta el diseño del MVP y sus pruebas de aceptación. Las capacidades descritas deberán implementarse y verificarse antes de la entrega. La PWA será la aplicación web de AutoNexus AI instalable en un equipo o teléfono compatible. Flutter será la aplicación móvil independiente; ambos clientes compartirán identidad y servicios, pero tendrán almacenamiento y ejecución locales propios.

### Instalación, Shell y microfrontends

El Shell incorporará un manifiesto web con nombre, iconos, start\_url, scope y modo standalone. La instalación se ofrecerá cuando el navegador lo permita y la aplicación se servirá por HTTPS; [localhost](http://localhost) se utilizará durante el desarrollo. El acceso instalado abrirá las mismas rutas y permisos que la web. Instalarla y disponer de funcionamiento offline son capacidades distintas, por lo que ambas se demostrarán.

Un service worker bajo el origen del Shell administrará la caché de la web. Se almacenarán el Shell, las rutas habilitadas de Angular y React, sus archivos JavaScript y CSS, fuentes e iconos necesarios, dependencias de TensorFlow.js, modelo, pesos, etiquetas y configuración de preprocesamiento. No se dependerá de descargar una biblioteca desde un CDN durante una inspección sin conexión.

Los microfrontends tendrán compilación independiente y ciclos de montaje y desmontaje mediante single-spa. MF01 Angular gestionará empleados; MF02 Angular, clientes, vehículos, citas y órdenes; MF03 React, finanzas e indicadores; MF04 React, inteligencia y reportes asistidos. El Shell resolverá navegación y sesión. Habrá contratos de comunicación y estilos encapsulados, con publicación inicial detrás de un mismo origen.

### Almacenamiento y preparación offline

Cache Storage conservará recursos de la aplicación. IndexedDB conservará órdenes y catálogos descargados, inspecciones, fotografías pendientes, resultados del modelo y la cola de cambios. Una query GraphQL enviada por POST no quedará disponible offline por el solo hecho de usar un service worker: su respuesta autorizada se guardará explícitamente en IndexedDB y la pantalla podrá consultar esa copia.

El empleado seleccionará sus órdenes y ejecutará «Preparar trabajo sin conexión». La aplicación verificará datos, rutas y modelo y mostrará su fecha de actualización y espacio requerido. La agenda, el catálogo y las cotizaciones descargadas serán referencias; un horario visto offline no constituirá una reserva.

Las actualizaciones de caché y modelo se descargarán completas antes de activarse. Se conservará la versión anterior si la descarga falla y nunca se eliminará la cola pendiente al actualizar el service worker. La aplicación sincronizará al abrirse o recuperar conexión; el MVP no dependerá de que el navegador ejecute tareas con la aplicación cerrada.

### Evidencia de aceptación

Se instalará y preparará la PWA, se cerrará, se deshabilitará la red y se volverá a abrir desde su icono. Se navegará a una orden descargada, se tomará una fotografía, se ejecutará la clasificación y se guardará una inspección pendiente. Al recuperar internet, el registro deberá aparecer en el servidor una sola vez. Se comprobará en las herramientas de red que la inferencia no necesita una petición remota.

## IA LOCAL EN WEB Y APLICACIÓN MÓVIL

### Función concreta del modelo local

La IA local apoyará la inspección visual de carrocería mediante un clasificador pequeño de fotografías. La selección inicial será un conjunto acotado de categorías de daño visible que el dataset disponible permita distinguir. No se ofrecerá diagnóstico del motor ni evaluación de seguridad del vehículo. Antes de entrenar se fijarán clases, licencias, cantidad de ejemplos y casos no cubiertos.

La entrada será una fotografía capturada o seleccionada por el mecánico. La salida será una categoría sugerida, sus puntuaciones, la versión del modelo y un estado de revisión humana. Se permitirá «No concluyente» cuando la imagen o el resultado no cumplan los criterios definidos. Una puntuación alta no se presentará como certeza de una falla mecánica. El mecánico podrá confirmar o corregir la sugerencia.

### Ejecución en la PWA

TensorFlow.js cargará desde el dispositivo la topología del modelo, sus pesos y las etiquetas. El cliente redimensionará y normalizará la imagen con el mismo procedimiento usado al entrenar, ejecutará la inferencia en un backend local compatible, como CPU o WebGL, y liberará los recursos de los tensores. Las operaciones se organizarán de forma asíncrona para mantener la interfaz utilizable.

El modelo estará almacenado localmente antes de perder la conexión. El envío posterior de una fotografía para incorporarla al expediente será una operación de sincronización separada: la clasificación podrá terminar aunque el servidor esté apagado. Se registrarán imagen o referencia local, predicción original, corrección humana, fecha, autor, orden y modelVersion; los resultados anteriores no se reescribirán al actualizar el modelo.

### Ejecución en Flutter

La aplicación Android en Flutter incluirá o descargará previamente un modelo .tflite y lo ejecutará mediante una integración compatible con LiteRT. Solicitará permiso de cámara y conservará fotografías en archivos privados de la aplicación; SQLite almacenará órdenes descargadas, observaciones, resultados y referencias a esos archivos. El adaptador móvil realizará el mismo redimensionamiento, normalización y orden de etiquetas que la versión web.

El registro de versiones del servicio de Inteligencia publicará modelo, etiquetas, configuración y huella del archivo. Cada cliente verificará la descarga y activará una versión compatible; si no tiene conexión seguirá usando la versión instalada. Se validará la conversión comparando imágenes comunes en Python, web y Android, porque un modelo exportado no garantiza por sí solo resultados idénticos.

### Límites y validación

Se medirá tamaño del modelo, tiempo de carga e inferencia y calidad de clasificación en los dispositivos de la demostración. Los objetivos numéricos se fijarán después de obtener una medición inicial, sin atribuir precisión o latencia todavía no comprobadas. Se mostrarán matriz de confusión, métricas por clase y ejemplos de errores.

En el MVP, «IA local» significa que el modelo visual ejecuta su inferencia en el dispositivo sin internet. Los agentes empresariales, la transcripción y la generación de reportes utilizarán el servicio de Inteligencia y requerirán conexión. Un asistente generativo completamente local implicaría otro modelo y requisitos de hardware; deberá confirmarse con el docente si también lo exige.

## OPERACIONES OFFLINE Y SINCRONIZACIÓN

### Disponibilidad por operación

| Operación | Sin conexión | Al recuperar conexión |
| --- | --- | --- |
| Consultar órdenes e historial | Solo los datos descargados; mostrar fecha. | Descargar cambios y actualizar la copia. |
| Inspeccionar y clasificar fotos | Capturar, inferir y guardar localmente. | Subir archivos y registrar inspección. |
| Agregar observaciones y avances | Guardar borradores o solicitudes pendientes. | Validar permisos, versión y reglas. |
| Consultar agenda o cotización | Última copia; no garantiza horario libre. | Actualizar y validar antes de confirmar. |
| Asignar, confirmar y registrar cobro | Sin confirmación definitiva offline. | CU15 valida asignación; Finanzas valida cobros. |
| Agentes y reportes nuevos | Consultar reportes ya descargados, si los hubiera. | Consultar servicios y generar nueva respuesta. |

### Cola de cambios y protocolo de envío

Cada operación tendrá un operationId UUID estable, entidad, versión base, tipo de cambio, autor, dispositivo y fecha de creación. La cola distinguirá pendiente, enviando, sincronizada, en conflicto y rechazada. Sincronización verificará identidad y permisos, guardará el sobre en DynamoDB y coordinará su aplicación; no confiará en un actor indicado por el cliente sin validarlo.

Las fotografías pendientes se cargarán a Amazon S3 mediante una URL prefirmada autorizada; después se enviará la inspección o avance que las referencia. La cola mantendrá las dependencias y claves de archivo estables para reintentar. La PWA enviará por GraphQL al BFF y Flutter por REST; ambos alcanzarán MS05, que dirigirá cada cambio al propietario correspondiente.

MS05 registrará intentos y resultado de coordinación en DynamoDB. El servicio propietario confirmará atómicamente cambio e idempotencia en su base: DynamoDB no formará una transacción global con PostgreSQL o MongoDB. Si el propietario guardó y se perdió la respuesta, MS05 consultará o repetirá el mismo operationId. No marcará sincronizado hasta comprobar la aceptación definitiva; otro contenido con igual identificador será rechazado.

### Conflictos, descarga y sesión

Las observaciones nuevas podrán agregarse como registros independientes. Una edición compartida llevará la versión conocida; si cambió en el servidor, se devolverá conflicto para comparar y resolver. No se aplicará «último cambio gana» sobre disponibilidad, cotizaciones o cobros. Los cambios rechazados permanecerán visibles y los errores temporales se reintentarán con espera creciente y variación aleatoria.

MS05 coordinará la descarga incremental con cursores opacos, versiones y marcas de eliminación suministrados por los propietarios. DynamoDB conservará el seguimiento por usuario y dispositivo. La fecha del teléfono no decidirá el orden de los cambios y el cursor local avanzará solo después de aplicar correctamente la página recibida.

Se requerirá sesión previa y preparación de datos para trabajar offline; no habrá autenticación central nueva sin red. Al reconectar se renovará o restablecerá la sesión antes de enviar cambios. Los datos locales se separarán por usuario y dispositivo, con permisos y vigencia de acceso local definidos. Cerrar sesión advertirá cambios pendientes y aplicará la política de datos sensibles.

## IA remota — CU23

El modelo visual utilizará transferencia de aprendizaje y se exportará a TensorFlow.js y LiteRT con iguales clases y preprocesamiento. CU22 ejecutará inferencia local. CU23 procesará imágenes de S3 en FastAPI y conservará sus resultados en MongoDB. Python centralizará entrenamiento, evaluación y versiones; los agentes internos, el análisis remoto y los reportes nuevos requerirán conexión. El mecánico enviará imágenes autorizadas a S3; FastAPI ejecutará TensorFlow y guardará puntuaciones, clases, revisión y modelVersion en MongoDB. Se presentará como apoyo visual, no diagnóstico definitivo. Si el servicio remoto falla, CU22 seguirá disponible cuando el modelo local esté preparado.

## ML, DEEP LEARNING Y MEJORA CONTROLADA

### Aprendizaje supervisado: duración de trabajos

Se entrenará un estimador de horas de reparación. Usará variables disponibles al planificar, como tipo de servicio, categoría del vehículo y cantidad de trabajos; la etiqueta será la duración real registrada al finalizar. No incluirá como entrada información conocida solo al cierre. El resultado será una duración estimada y una advertencia cuando el caso esté fuera del conjunto de entrenamiento.

Operaciones y el agente de planificación solicitarán la predicción por API interna; MCP podrá exponer capacidades adicionales solo si se autorizan. Se evaluará error absoluto medio contra una referencia simple. Si faltan datos o modelo validado, se mostrará la duración del catálogo como estimación manual. Ese fallback no sustituirá la evidencia de entrenamiento y evaluación exigida para demostrar ML.

### Aprendizaje no supervisado: agrupación de vehículos

Se agruparán vehículos por antigüedad, kilometraje y frecuencia de mantenimiento registrada, con preparación y normalización de variables. Un algoritmo como K-means permitirá explorar grupos con comportamientos semejantes. El panel mostrará tamaños, características y vehículos de cada grupo, para apoyar campañas o revisión de mantenimiento.

El número de grupos se contrastará mediante medidas de separación y revisión de sus perfiles. Un cluster no se etiquetará automáticamente como «vehículo peligroso» o «falla próxima»: no existe una etiqueta de diagnóstico que respalde esa conclusión. Se documentará el alcance exploratorio y la sensibilidad a datos incompletos.

### Deep learning: clasificación visual

Se utilizará TensorFlow/Keras con transferencia de aprendizaje de una red compacta, como MobileNet, para las clases visuales delimitadas. El trabajo incluirá preparación y aumento de imágenes, entrenamiento de la cabeza de clasificación y, solo si se justifica, ajuste de capas de la base. Se dividirán datos de entrenamiento, validación y prueba sin compartir el mismo vehículo u origen entre particiones.

El modelo elegido se exportará a TensorFlow.js y .tflite, conservando clases y preprocesamiento. El repositorio de modelos guardará versión, dataset, métricas, parámetros de entrada y archivos generados. El criterio de aceptación incluirá calidad por clase y ejecución offline real en web y móvil, no solamente que el entrenamiento termine.

### Autoaprendizaje como ampliación controlada

La corrección del mecánico podrá aportar un ejemplo candidato: imagen, etiqueta predicha, etiqueta corregida, modelVersion y revisión. Primero se revisará la calidad y autorización de uso del ejemplo. Guardar una corrección no cambiará los pesos del modelo en ese instante ni hará que el agente aprenda automáticamente.

Como ampliación condicionada al tiempo disponible, se preparará un lote validado, se reentrenará en Python y se comparará el candidato con la versión vigente sobre una prueba reservada. Una persona aprobará la publicación si cumple los criterios acordados. Los clientes descargarán la nueva versión cuando tengan conexión y conservarán la anterior si la actualización falla.

n8n podrá notificar que existe un lote o iniciar un trabajo de entrenamiento previamente autorizado; TensorFlow realizará el aprendizaje. Se conservará la posibilidad de volver a la versión anterior. Este ciclo de retroalimentación y reentrenamiento será una mejora propuesta, distinta del requisito base de ejecutar los modelos ML/DL y del uso de memoria contextual en un agente.

## Agentes empresariales internos — CU25

### Agentes y misiones delimitadas

El agente de planificación analizará «Proponé un mecánico y horario para estas órdenes». Consultará especialidades, turnos, reservas y estimaciones por APIs internas y explicará alternativas. El agente operativo atenderá atrasos y evolución de las órdenes. CU25 devolverá propuestas sin modificar asignaciones automáticamente.

El agente financiero analizará «Explicá los ingresos, gastos y cotizaciones pendientes». Obtendrá datos calculados por Finanzas y distinguirá cobros de importes cotizados. El perfil de reportes estructurará respuestas verificables. Estos perfiles pueden compartir un modelo de lenguaje con herramientas y permisos específicos.

Los agentes serán una capacidad interna de Inteligencia y consumirán APIs autorizadas aun cuando AutoNexus MCP Server esté detenido. Tendrán límites de pasos, tiempo y acceso. Una propuesta que requiera escritura se confirmará mediante el caso de uso de negocio y la aprobación humana correspondiente, fuera de la consulta CU25.

## Evidencia mínima de local y offline

- [ ] Arranque en frío de la PWA ya preparada con red deshabilitada.
- [ ] Captura, clasificación y guardado local en web y Android sin llamadas remotas.
- [ ] Comparar las mismas imágenes y preprocesamiento en Python, TensorFlow.js y LiteRT.
- [ ] Sincronizar después de perder la respuesta sin duplicar datos.
- [ ] Resolver un conflicto de versión y mostrar un rechazo de permisos.
- [ ] Recuperar carga S3 y dependencias sin marcar una inspección incompleta como sincronizada.
- [ ] Verificar que MS05/DynamoDB coordinan seguimiento y el propietario confirma cambio e idempotencia.

