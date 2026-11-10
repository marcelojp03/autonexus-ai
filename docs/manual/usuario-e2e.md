# Manual de usuario de AutoNexus AI

Fecha: 2026-11-10. Versión correspondiente al código y evidencia disponibles en esta copia.

Este manual describe las pantallas implementadas y un recorrido de prueba de extremo a extremo. No certifica una ejecución nueva de ese recorrido. El [checklist de cumplimiento](checklist-cumplimiento.md) distingue aceptación registrada, límites y requisitos pendientes.

## 1. Antes de empezar

AutoNexus administra un solo taller y cobra servicios automotrices. Los clientes no necesitan una cuenta. No hay inventario ni venta de repuestos.

Abrir `http://127.0.0.1:4280`. Mantener Docker Desktop y los contenedores del entorno encendidos. Usar el mismo origen: cambiar entre localhost, una IP y 127.0.0.1 puede romper la sesión y las copias offline.

### Disponibilidad de esta instalación

La última comprobación de esta conversación encontró la web, BFF, identidad, Operaciones, Empleados y Finanzas saludables; respondió HTTP 200 y la preparación demo terminó con código 0. Esto es una observación histórica, no un monitor en vivo.

| Función | Condición para probarla |
| --- | --- |
| Personal, horarios, clientes, vehículos, catálogo, citas, recepción, órdenes y cotizaciones | Entorno online y permisos del usuario |
| Confirmación y asignación | Mecánico habilitado, jornada disponible y cotización aprobada vigente |
| Avances de ejecución | Entrar como el mecánico asignado y activo |
| Evidencias y finalización técnica | S3 privado configurado; para solicitar revisión hace falta al menos una evidencia disponible |
| Cobro | Finalización técnica aprobada y confirmación global de la orden; una demo confirmada aún no es cobrable |
| Respaldo documental de gastos | Proveedor documental de Finanzas configurado; es independiente del S3 de Operaciones |
| IA visual | Modelo autorizado preparado; S3 para análisis de evidencia del servidor |
| Redacción mediante IA | Ollama activo y modelo de lenguaje disponible; seleccionar un modelo en la app no confirma su descarga |
| Sincronización offline | MS05 y DynamoDB operativos; quedaron sin iniciar en la preparación local por fallo de LocalStack |
| Automatizaciones y MCP | Se preparan aparte; no se habilitan por abrir la web |

La demo local dejó dos trabajos confirmados para **2026-11-17**. Si se usa otra instalación, consultar su fecha demo: no asumir que es la misma. Un día sin asignaciones puede mostrar una agenda vacía correcta.

### Cuentas de prueba

Los archivos privados de la raíz contienen `username` y `password`. No están versionados y no se deben copiar a documentación, capturas compartidas ni commits.

| Archivo / clave | Uso |
| --- | --- |
| `admin-account.private.json` | Administrador |
| `demo-accounts.private.json`, `accounts.reception` | Recepcionista |
| Mismo archivo, `accounts.finance` | Responsable financiero |
| Mismo archivo, `accounts.chief` | Jefe de taller |
| Mismo archivo, `accounts.mechanicA` y `accounts.mechanicB` | Dos mecánicos diferentes |

`chief` y `mechanicA` son etiquetas del archivo, no los nombres de inicio de sesión. Usar el `username` real de cada entrada y su propia contraseña. Para cambiar de usuario, cerrar sesión; no reemplazar tokens ni editar el almacenamiento del navegador.

## 2. Iniciar sesión y orientarse — CU01

1. Abrir la web y seleccionar la opción de ingreso.
2. En la pantalla de Keycloak, introducir usuario y contraseña.
3. Esperar el retorno automático a AutoNexus.
4. Elegir el módulo y su opción de navegación.

Resultado esperado: sesión autenticada y funciones acordes a los permisos efectivos. Una cuenta sin permisos puede entrar a identidad y aun así no tener acceso a una operación.

La cabecera ofrece los módulos según acceso y Trabajo sin conexión. La revisión UI local presenta el rol con una etiqueta legible y resalta la sección activa. Al entrar a Empleados, un jefe con permiso de equipo abre Agenda del equipo; un mecánico abre Mi agenda. Widgets/Panel demo quedaron fuera de la navegación habitual; sus rutas de desarrollo no acreditan indicadores reales del taller. Los diagnósticos técnicos no forman parte de la portada habitual.

| Sección | Ruta web integrada |
| --- | --- |
| Listado / alta de empleados | `/employees/list`, `/employees/new` |
| Horarios / seguridad | `/employees/schedules`, `/employees/security` |
| Mi agenda / agenda de equipo | `/employees/agenda`, `/employees/agenda/team` |
| Ejecución / verificación | `/employees/execution`, `/employees/verification` |
| Asistente y reportes | `/employees/assistant` |
| Clientes / vehículos | `/operations/customers`, `/operations/vehicles` |
| Catálogo / citas | `/operations/catalog`, `/operations/appointments` |
| Recepción / órdenes | `/operations/receptions`, `/operations/orders` |
| Confirmación | `/operations/confirmations` |
| Cotizaciones, cobros y gastos | `/finance` |
| Análisis visual del servidor | `/intelligence` |
| Superficie offline | `/offline.html` |

Una URL directa no concede permisos. La API autoriza cada acción, aunque se consiga abrir una pantalla.

## 3. Preparar personal — CU02, CU03 y CU04

Para la primera prueba, conviene usar los empleados demo: sus cuentas, roles y asignaciones ya se prepararon. Crear un empleado nuevo no lo deja automáticamente listo para iniciar sesión.

### Registrar un empleado

1. Entrar como administrador y abrir Empleados → Registrar empleado.
2. Completar nombres, apellidos, documento, email, teléfono, cargo y fecha de ingreso no futura.
3. En Especialidades, escribir una y pulsar **Enter**; repetir para cada especialidad. Ejemplo: `Motor`. El selector no consulta un catálogo precargado.
4. Si realizará reparaciones, marcar **Habilitar para asignaciones mecánicas**. Exige al menos una especialidad.
5. Si necesita iniciar sesión, abrir **Acceso al sistema** y marcar **Configurar usuario, rol y contraseña permanente**. Completar usuario (3–64 caracteres: minúsculas, números, punto, guion o guion bajo), rol y contraseña de 8–128 caracteres, y repetirla. Requiere permisos de personal y seguridad; el servidor comprueba ambos. El rol de acceso es distinto del cargo laboral.
6. Seleccionar **Registrar empleado** y comprobar el resultado en el listado/detalle.

Resultado esperado: empleado persistido y estado explícito de su cuenta. La creación de identidad ocurre fuera de la transacción laboral; puede quedar pendiente o fallar sin perder el empleado. Consultar el detalle y usar el reintento de acceso cuando corresponda.

**Cargo laboral, especialidad, habilitación mecánica y rol son distintos.** Escribir `mecanico` como cargo no concede permisos ni habilita asignaciones. La opción explícita de configurar acceso encadena sincronización, asignación del rol elegido y contraseña permanente. `Perfil sincronizado` por sí solo no confirma que esos otros pasos estén completos: esperar **Acceso listo. Usuario: …**.

No hay registro público. La contraseña se establece mediante el servidor en Keycloak, con `temporary=false`, sin exigir cambio al primer ingreso y sin guardarla en el registro laboral/historial. Si la política del proveedor la rechaza, corregirla. Si el empleado ya quedó guardado pero el acceso falla, **no registrarlo otra vez**: corregir el problema y pulsar **Habilitar acceso**. No confundir un timeout con rechazo confirmado.

Para empleados existentes, abrir **Editar → Acceso al sistema**, marcar la misma opción y completar los datos. **Habilitar acceso** utiliza el empleado guardado; **Guardar cambios** guarda también los cambios laborales del formulario. Funciona tanto si nunca se solicitó una identidad como si su perfil ya está sincronizado. Cambia el usuario/contraseña de la identidad vinculada y agrega el rol elegido, conservando otros roles; no usarlo para retirar roles. El subject y el historial laboral se conservan. La contraseña se limpia del formulario tras éxito, no se devuelve ni se vuelve a mostrar.

### Roles y permisos

1. Como administrador, abrir Empleados → Seguridad.
2. Consultar roles y permisos efectivos.
3. Crear o editar un rol con permisos del catálogo autorizado.
4. Asignarlo o retirarlo del empleado correspondiente y comprobar la sincronización.
5. Consultar el historial de seguridad.

Una persona puede tener varios roles. No se pueden otorgar permisos superiores a los propios ni retirar la última administración efectiva. Tras cambiar un rol puede ser necesario renovar la sesión para obtener sus claims nuevos; algunos servicios mantienen caché de permisos hasta 30 segundos.

### Jornadas y ausencias

1. Abrir Empleados → Horarios como administrador o jefe autorizado.
2. Buscar y seleccionar el empleado.
3. Elegir el día de la semana, inicio, fin y descanso si corresponde.
4. Seleccionar **Agregar turno**.
5. Elegir una fecha en Disponibilidad del día y revisar los intervalos.
6. Registrar ausencias con fechas y motivo cuando corresponda.

No superponer turnos, descansos ni ausencias con el intervalo que se pretende asignar. Si la pantalla pide reconocer asignaciones confirmadas, revisar primero el impacto. Ese reconocimiento no reasigna trabajos automáticamente.

## 4. Recorrido de prueba desde cero

Usar datos ficticios identificables como prueba y documentos/placas que no existan aún. No registrar personas reales para una demostración. Conservar el número de orden durante todo el recorrido.

### Paso 1. Preparar el servicio — CU09

**Actor:** administrador o jefe con permiso de catálogo.

1. Abrir Operaciones → Catálogo.
2. Buscar el servicio antes de duplicarlo.
3. Completar nombre, descripción, categoría, duración en minutos y tarifa referencial.
4. Seleccionar **Registrar** y comprobar que esté activo.

Ejemplo de ensayo: revisión de motor, 60 minutos y tarifa referencial de 100,00 BOB. Son datos de prueba, no precios recomendados. La duración es referencial; no es una predicción ML. La tarifa no es todavía una cotización definitiva.

### Paso 2. Registrar cliente — CU06

**Actor:** recepcionista o administrador autorizado.

1. Abrir Operaciones → Clientes y buscar por los datos disponibles.
2. Si no existe, completar el formulario de cliente.
3. Registrar y comprobar el cliente en el listado.
4. Si existe, actualizarlo en vez de crear otro.

Resultado esperado: cliente persistido sin crear una cuenta de acceso. Este formulario de gestión requiere conexión; no hay alta offline general de clientes en la superficie actual.

### Paso 3. Registrar vehículo — CU07

1. Abrir Operaciones → Vehículos.
2. Buscar por placa antes de crear.
3. Seleccionar el cliente y completar los datos del vehículo.
4. Guardar y comprobar placa y propietario.

Los cambios de propietario conservan trazabilidad. Ese historial de propietarios no es el historial de servicios CU08, que sigue pendiente.

### Paso 4. Programar cita — CU10

1. Abrir Operaciones → Citas.
2. Seleccionar cliente, vehículo y servicio activos.
3. Indicar fecha, horario y observaciones solicitadas.
4. Registrar y releer la cita.
5. Para reprogramar o cancelar, usar la acción correspondiente y proporcionar el motivo requerido.

La programación se valida online. Una cita no asigna todavía un mecánico ni ejecuta CU15. La ausencia de choque de citas no demuestra disponibilidad de un mecánico concreto. Revisar su jornada antes de confirmar el trabajo.

### Paso 5. Recepcionar — CU11

1. Cuando llegue el vehículo, abrir Operaciones → Recepción.
2. Buscar y seleccionar vehículo/propietario.
3. Vincular la cita programada o elegir recepción sin cita cuando proceda.
4. Completar kilometraje, motivo, síntomas y condiciones visibles.
5. Seleccionar **Confirmar recepción**.

Resultado esperado: recepción registrada y disponible para crear una orden. La pantalla actual no integra todo el flujo opcional de IA/fotos durante recepción; el análisis visual implementado trabaja con evidencias de ejecución.

### Paso 6. Crear orden — CU12

1. Abrir Operaciones → Órdenes.
2. En **Crear orden desde recepción**, buscar una recepción sin orden y seleccionarla.
3. Completar descripción del problema, prioridad y observaciones disponibles.
4. Añadir los servicios y sus cantidades: entre 1 y 20 servicios distintos, cantidades enteras de 1 a 99.
5. Seleccionar **Crear orden de trabajo**.
6. Anotar su número y comprobar cliente, placa y servicios en **Ver orden**.

Resultado esperado: orden registrada para continuar con cotización. No está confirmada ni asignada por crearla. No volver a crearla si se perdió la respuesta: consultar antes su resultado/listado.

### Paso 7. Cotizar — CU13

**Actor:** responsable financiero o administrador con permiso de cotización.

1. Cambiar de cuenta con cierre de sesión si corresponde.
2. Abrir Finanzas → Cotizaciones.
3. Buscar la orden por número, placa o identificador y seleccionarla.
4. Revisar servicios, cantidades, tarifas, descuento permitido, vigencia y notas.
5. Revisar subtotales, impuestos y total calculados por Finanzas.
6. Confirmar la creación y releer la cotización.

No calcular ni imponer una tasa fiscal desde este manual. Usar los importes y configuración del propietario. Una revisión conserva versiones previas; una cotización aprobada no se edita silenciosamente.

### Paso 8. Registrar decisión del cliente — CU14

**Actor:** recepcionista, financiero o jefe con permiso de decisión.

1. Abrir la cotización exacta de la orden y versión correspondientes.
2. Comunicar al cliente condiciones, vigencia y total.
3. Registrar aprobación o rechazo real y su evidencia/referencia; añadir motivo cuando corresponda.
4. Confirmar y releer el estado.

En una prueba, identificar expresamente la decisión como sintética. **Aprobada no equivale a servicio confirmado.** Un rechazo impide seguir como si existiera aprobación; revisar la orden/cotización antes de continuar.

### Paso 9. Confirmar y asignar — CU15

**Actor:** jefe de taller o administrador autorizado.

1. Abrir Operaciones → **Confirmar servicio**.
2. Elegir la orden y una versión aprobada y vigente de su cotización.
3. Buscar un mecánico elegible: activo, habilitado, con especialidades y jornada disponible.
4. Seleccionar la especialidad registrada, fecha e intervalo dentro de la disponibilidad, sin descanso ni ausencia.
5. Seleccionar **Iniciar confirmación del servicio**.
6. Seguir el panel y usar **Consultar estado**.
7. Continuar únicamente cuando la Saga muestre `confirmed`.

La plataforma reserva disponibilidad, vincula la cotización aprobada y confirma coordinadamente. Una reserva provisional, una solicitud aceptada o una espera agotada no equivalen a confirmación. Ante estado pendiente, usar la consulta/recuperación de esa misma Saga. No crear otra intención ni cambiar la selección para esconder un resultado incierto.

Resultado esperado: orden globalmente confirmada y asignación definitiva visible en agenda. La recepción de un evento no prueba que el mecánico haya leído una notificación.

### Paso 10. Consultar agenda — CU05

**Actor:** el mecánico seleccionado.

1. Cerrar la sesión del jefe e ingresar con la cuenta de ese mecánico.
2. Abrir Empleados → **Mi agenda**.
3. Seleccionar la fecha de la asignación; en la demo inicial, 17/11/2026.
4. Abrir el trabajo y revisar orden, vehículo, horario y servicios.

El jefe usa **Agenda del equipo** con sus filtros. Un mecánico distinto no obtiene autorización para ejecutar ese trabajo por conocer el número o URL.

### Paso 11. Ejecutar y registrar avances — CU16

1. Como el mecánico asignado, abrir Empleados → **Ejecución**.
2. Seleccionar el trabajo confirmado.
3. Seleccionar **Iniciar ejecución**.
4. Registrar tareas realizadas y minutos empleados; seleccionar **Registrar avance**.
5. Marcar cada actividad obligatoria como realizada cuando efectivamente lo esté.
6. Seleccionar una imagen permitida y usar **Adjuntar** en el avance correspondiente.
7. Esperar que la evidencia quede **disponible**, no solo pendiente de carga.

El flujo autoriza la carga, sube el archivo y comprueba sus metadatos antes de declararlo disponible. Un archivo seleccionado no prueba que esté guardado en S3. No asumir soporte de video; el recorrido visual vigente está acotado a imágenes JPEG/PNG, con límite de 5 MiB donde lo establece el formulario/contrato.

**Estado local (2026-11-10):** S3 ya está configurado en Operaciones y pasó una prueba directa de carga/lectura/eliminación temporal. Falta comprobar una evidencia desde esta interfaz. No hay que falsear evidencias ni saltarse el requisito para llegar al cobro.

### Paso 12. Solicitar revisión y finalizar — CU17

1. El mecánico comprueba que no queden actividades obligatorias y que haya al menos una evidencia disponible.
2. Selecciona **Solicitar revisión**. Mientras está en revisión no sigue registrando avances.
3. El jefe abre Empleados → **Verificación** y selecciona **Revisar trabajo**.
4. Revisa actividades, observaciones y evidencias.
5. Si hay fallos, indica el motivo y usa **Devolver al mecánico**. El mecánico corrige y vuelve a solicitar revisión.
6. Si corresponde, usa **Aprobar y finalizar**.

Resultado esperado: ejecución técnicamente finalizada. No confundir el estado de ejecución con la confirmación global de la orden: el cobro comprueba ambos. **Finalización técnica no registra entrega física**; CU18 sigue pendiente.

### Paso 13. Cobrar y consultar comprobante — CU19

**Actor:** financiero o administrador con permisos de cobro.

1. Abrir Finanzas → **Cobros** y consultar **Pendientes de cobro**.
2. Abrir el saldo de la orden finalizada y globalmente confirmada.
3. Revisar importe acordado, pagos previos y saldo del servidor.
4. Elegir efectivo, transferencia o QR e introducir el importe.
5. En efectivo, confirmar recepción humana. En transferencia/QR, registrar antes la comprobación humana de referencia e importe solicitada por la pantalla.
6. Confirmar el registro.
7. Releer el cobro y su comprobante interno; comprobar el saldo resultante.

La política vigente admite **cobro íntegro del saldo tras finalización**, sin abonos, anticipos ni cobros offline. La comprobación de transferencia/QR no consulta automáticamente al banco. El comprobante no es una factura fiscal.

Ante respuesta incierta, usar **Consultar resultado** o reintentar exactamente la misma intención cuando esté permitido. No duplicar la operación ni cerrar/recargar la pestaña antes de conciliar: la intención de la UI financiera vive durante el montaje/sesión actual, no como borrador durable entre recargas. No hay anulación/devolución implementada para probar.

### Paso 14. Entrega física e historial — CU18 y CU08

El software actual no ofrece el registro completo de entrega ni el historial de intervenciones del vehículo. Este es el final del recorrido implementado de esta guía. No registrar la entrega usando una nota y presentarla como CU18 completado; tampoco usar el historial de propietarios como CU08.

## 5. Registrar un gasto — CU20

No requiere recorrer previamente una orden; sirve para una prueba financiera independiente.

1. Como financiero/administrador autorizado, abrir Finanzas → **Gastos**.
2. Seleccionar **Registrar gasto**.
3. Completar categoría disponible, descripción, fecha no futura, importe y medio de pago.
4. Si corresponde, adjuntar respaldo documental privado y esperar su confirmación. Sin proveedor configurado, registrar sin respaldo cuando el negocio lo permita; no afirmar que el archivo fue guardado.
5. Revisar y confirmar explícitamente.
6. Comprobar responsable, importe y aparición en el listado y filtros del período.

Si aparece un posible duplicado, revisar el candidato. Otro gasto legítimo requiere motivo y confirmación de una intención nueva, no reenviar a ciegas. El responsable se deriva de la identidad, no se suplanta desde el formulario.

## 6. Asistente y reportes — CU25 y CU26

Abrir Empleados → **Asistente y reporte** con una cuenta autorizada. Que el enlace sea visible no autoriza a consultar toda la información.

### Asistente

1. Escribir una pregunta concreta, con período cuando corresponda.
2. Ejemplo operativo: «¿Qué trabajos pendientes hay esta semana?».
3. Ejemplo financiero: pedir un resumen de cobros y gastos entre dos fechas explícitas, con un rango de hasta 31 días.
4. Revisar respuesta, fuentes, período y límites; responder una aclaración si la solicita.

El resumen financiero requiere permisos de cobros y gastos, usa cifras de Finanzas y no necesita LLM para calcularlas. Movimiento neto no equivale a rentabilidad ni saldo bancario. Cero solo significa cero cuando lo confirma el propietario; dato ausente no es cero.

Ollama redacta ciertas respuestas/reportes si está disponible. No garantiza exactitud y no concede permisos. El asistente no registra pagos, anula cobros ni ejecuta acciones MCP de escritura. Si rechaza una petición, no cambiar de cuenta para eludir el control.

### Reportes

1. Elegir el período del reporte operativo o financiero en su sección.
2. Seleccionar generar y esperar el estado del trabajo.
3. Consultar el trabajo existente en vez de iniciar otro por lentitud. El identificador permite retomar la consulta; un trabajo interrumpido no significa reporte publicado.
4. Revisar indicadores, procedencia y si la narrativa es generativa o plantilla determinista.
5. Exportar los formatos habilitados, actualmente **JSON y CSV**.

La interfaz financiera está implementada pero no tiene aceptación completa de navegador registrada. Productividad, gráficos y filtros por indicador siguen pendientes. No prometer PDF ni un panel CU21 por ver una tabla del reporte. Una plantilla con cálculos correctos es un fallback explícito, no evidencia de redacción exitosa del modelo.

## 7. Inspecciones visuales — CU22 y CU23

### Modelo local: web y Android

Antes de cortar internet, preparar el trabajo autorizado y, para inferencia, los archivos del modelo. El repositorio incluye el modelo Keras del servidor desde `9315c9a`; las exportaciones TensorFlow.js para web y LiteRT para móvil requieren preparación adicional. La revisión humana manual puede funcionar sin modelo; no se inventan predicciones ni versiones.

Web: abrir **Trabajo sin conexión**, elegir un trabajo en ejecución propio y preparar sus recursos. Preparar el modelo solo cuando esté disponible. Seleccionar foto, ejecutar inferencia y guardar por separado la interpretación humana. «No concluyente» no significa «sin daño».

Android: requiere APK configurado y assets de modelo disponibles. Iniciar sesión online, descargar agenda, preparar el trabajo, capturar/seleccionar foto y guardar revisión/avance. No hay que instalar Flutter en el teléfono; Flutter/SDK son herramientas de compilación del operador. El borrador de texto al volver atrás tiene una pérdida conocida: no asumir que permanece sin guardarlo.

### Análisis del servidor

1. Con S3 y modelo servidor configurados, abrir **Inteligencia → Análisis visual** como actor autorizado.
2. Elegir un trabajo y una evidencia disponible.
3. Solicitar el análisis; el servidor valida acceso, obtiene la imagen autorizada y persiste resultados/metadatos en MongoDB.
4. Leer etiquetas, puntajes, umbrales y versión, y revisar las limitaciones.

La interfaz actual usa evidencias ya cargadas, no una carga genérica por lote desde esa pantalla. No asumir que todo el flujo de validación/corrección/descartado del adjunto esté aceptado globalmente. El modelo es **experimental y no validado como diagnóstico**. No prescribe reparaciones ni sustituye revisión técnica.

En esta instalación el modelo del servidor está cargado y se comprobó inferencia sintética el 2026-11-10. S3 ya está conectado y verificado directamente; falta comprobar el recorrido desde la interfaz con una evidencia autorizada. Las exportaciones offline para web/móvil siguen pendientes. La ejecución comprobada no acredita la calidad del modelo.

## 8. Trabajo offline y sincronización — CU27

Esta sección se puede ejecutar solo después de recuperar MS05/DynamoDB y preparar los recursos. La evidencia del repositorio en otro entorno no confirma disponibilidad en esta computadora.

1. Online, iniciar sesión con el mecánico y preparar su trabajo autorizado en ejecución.
2. Comprobar que se descargaron los recursos básicos; descargar el modelo si se usará inferencia.
3. Sin red, abrir la superficie preparada, registrar revisión/avance y foto cuando corresponda.
4. Guardar localmente. Reabrir y comprobar que el pendiente existe antes de darlo por conservado.
5. Recuperar conexión y autenticar la misma cuenta si se solicita.
6. Sincronizar y leer cada resultado.
7. Un archivo pasa por carga y confirmación antes del análisis cliente. Solo el resultado propietario confirma aplicación.
8. Ante rechazo o conflicto, conservar el pendiente y su evidencia; revisar la causa sin generar otro identificador para forzar el envío.

La gestión normal de clientes, citas, órdenes y finanzas no se vuelve offline por tener PWA. No confirmar reservas, servicios ni cobros sin servidor. No borrar caché, datos del sitio o SQLite con pendientes; no cambiar de origen/cuenta esperando ver la misma copia automáticamente.

## 9. Automatizaciones y MCP — CU28 a CU31

Estas integraciones requieren preparación de operador, no un botón público de registro.

**n8n:** flujos independientes, credenciales delegadas limitadas y canal local configurado. Para probar, habilitar un flujo aprobado en la instalación de prueba, producir su evento o esperar su programación y revisar ejecución/recibo. Un cron activo no garantiza una sesión delegada vigente para siempre. Esta instalación dejó deshabilitado el webhook opcional y no preparó n8n. No afirmar envío de correo/WhatsApp externo por ver un recibo del canal local.

**MCP de consulta:** iniciar y autorizar el servidor independiente, conectar un cliente compatible, descubrir herramientas permitidas y consultar órdenes/agenda/ejecución dentro de los permisos. El incremento actual expone seis herramientas de lectura. No asumir que existen todas las herramientas ilustrativas del adjunto.

**MCP de acciones y administración de clientes externos:** CU30/CU31 pendientes. No hay un flujo de usuario completo de escritura ni una pantalla CRUD de clientes MCP para describir como disponible.

## 10. Qué hacer ante problemas

| Problema | Acción |
| --- | --- |
| Especialidades vacío / «sin datos» | Escribir y pulsar Enter; no espera una lista de servidor. El texto vacío en chino es una deuda de traducción |
| Agenda vacía | Verificar cuenta, fecha, asignación definitiva, vínculo activo y filtros; una reserva no aparece como trabajo confirmado |
| No aparece un mecánico elegible | Revisar estado activo, habilitación mecánica, especialidades, jornada, ausencias y disponibilidad |
| Cuenta creada pero no entra | Verificar estado de identidad, contraseña en IdP y roles; `synced` solo no habilita login |
| Permiso insuficiente | Pedir al administrador revisar permisos efectivos; cargo/especialidad no conceden acceso |
| Resultado de envío incierto | Consultar la operación y conservar el mismo identificador/cuerpo al reintentar; no crear otra intención |
| No se habilita Solicitar revisión | Completar actividades y tener al menos una evidencia disponible, con S3 configurado |
| Orden no aparece para cobrar | Confirmación global y finalización técnica aprobada son necesarias; la demo inicial solo asegura trabajos confirmados |
| No se puede adjuntar evidencia/respaldo | Revisar proveedor correspondiente y tipo/tamaño permitido; no confundir archivo seleccionado con confirmado |
| IA no disponible | Revisar artefactos, recursos y aviso del servicio; usar revisión manual cuando corresponda |
| Reporte muestra plantilla | Leer la limitación: no hubo narración generativa aceptada; verificar cifras y fuente |
| Sync no disponible | El operador debe recuperar MS05/DynamoDB; no borrar pendientes ni repetir el seed para repararlo |

## 11. Guion de demostración y registro de resultados

Marcar solo después de ejecutar y observar cada resultado. Estas casillas comienzan sin marcar porque crear el manual no ejecuta operaciones de negocio.

- [ ] Ingreso como administrador, cierre de sesión y cambio real de rol.
- [ ] Cliente ficticio y vehículo asociados, sin duplicados.
- [ ] Servicio activo y cita online registrados.
- [ ] Recepción creada y una sola orden vinculada.
- [ ] Cotización versionada y decisión con evidencia.
- [ ] Saga confirmada y agenda del mecánico correcto.
- [ ] Inicio y avance textual persistidos.
- [ ] Evidencia real disponible en S3 (conexión configurada; falta verificar desde la interfaz).
- [ ] Actividades completas, revisión solicitada y finalización aprobada.
- [ ] Cobro íntegro confirmado, saldo y comprobante releídos.
- [ ] Gasto registrado y filtros/total consultados; respaldo solo si hay proveedor.
- [ ] Asistente con fuentes y rechazo de petición sin permiso.
- [ ] Reporte consultado y exportado; plantilla/generación identificadas correctamente.
- [ ] Offline y sincronización ejecutados con MS05 recuperado, conservando rechazos.

Por paso registrar fecha, rol, número ficticio de orden, resultado observado y evidencia sin secretos. Si falta una dependencia, marcar bloqueado; no aprobado. No marcar entrega, historial de servicios o ML de duración como demostrados: siguen pendientes.

## Fuentes

- [Estado comprobado](../context/STATUS.md), [plan de cobertura](../context/PLAN.md) y [alcance](../context/PROJECT.md).
- [Casos de uso](../use-cases), [permisos](../../contracts/auth/permissions.md), [identidad de empleados](../../contracts/auth/employees.md).
- [Saga](../../contracts/rest/saga.md), [ledger financiero](../../contracts/rest/financial-ledger.md), [sincronización](../../contracts/sync/overlay.md).
- [Evidencia financiera](../evidence/cu19-cu20-20261108.md) y [matriz de aceptación de asistentes/reportes](../evidence/cu25-cu26-acceptance-matrix.md).
- Rutas, formularios y restricciones contrastados con fuentes de `web/shell`, `web/mf-employees`, `web/mf-operations` y `web/mf-finance`.
