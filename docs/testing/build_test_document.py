"""Build a self-contained Word document using OOXML and Pillow; no Word dependency.

Run from repository root: python docs/testing/build_test_document.py
The document is a test design, not a record of executions.
"""
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED
import io
import re
import subprocess
import textwrap
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/testing/AutoNexus_AI_Pruebas_Caja_Negra_y_Blanca_31_CU.docx'
DATE = '10 de noviembre de 2026'
OP = 'services/operations/src/main/java/bo/edu/uagrm/autonexus/operations/'
EMP = 'services/employees/src/'
FIN = 'services/finance/app/'
SYN = 'services/sync/src/'
AG = 'integration/agent/src/'
PENDING = 'No ejecutado en esta elaboración. Resultado obtenido pendiente de registrar.'

# Scenario tuples: name, input, concrete action, observable acceptance criterion.
CASES = {
1: [
 ('Ingreso y SSO', 'Cuenta activa de prueba con rol recepcionista; conexión con Keycloak.', 'Iniciar sesión y abrir Operaciones y Finanzas desde Shell.', 'La sesión se comparte; cada módulo permite solamente las acciones autorizadas, sin pedir otra autenticación innecesaria.'),
 ('Credenciales incorrectas', 'Cuenta de prueba y contraseña deliberadamente incorrecta.', 'Intentar el ingreso y luego consultar una API protegida sin sesión.', 'Se informa el rechazo; no se crea sesión válida ni se obtiene información protegida.'),
 ('Cuenta deshabilitada', 'Cuenta de prueba deshabilitada en el proveedor.', 'Intentar una autenticación nueva.', 'Keycloak rechaza el acceso; la aplicación no muestra una sesión autenticada.'),
 ('Expiración o caída del proveedor', 'Sesión previa; renovación rechazada o Keycloak inaccesible.', 'Forzar expiración en el entorno de prueba e intentar una operación protegida.', 'Se solicita reautenticación o se informa indisponibilidad; no se acepta un token vencido ni se confirma la operación.')],
2: [
 ('Rol limitado', 'Administrador autorizado; nombre de rol único y permisos contenidos en sus permisos efectivos.', 'Crear el rol, asignarlo a un empleado y consultar una operación permitida y otra prohibida.', 'El empleado obtiene solamente el alcance asignado; la acción prohibida es rechazada por el servidor y hay auditoría.'),
 ('Escalamiento', 'Actor sin permiso de cobro intenta otorgarlo a otro empleado.', 'Crear o asignar un rol con permisos superiores a los del actor.', 'Se rechaza el escalamiento y no cambia el acceso efectivo del destinatario.'),
 ('Último administrador', 'Un único administrador autorizado activo.', 'Intentar retirarle el último acceso administrativo.', 'Se impide dejar el sistema sin administrador autorizado.'),
 ('Revocación y duplicado', 'Rol existente, operación identificada y empleado vinculado.', 'Repetir la asignación con el mismo operationId; retirar después el rol y efectuar una nueva consulta.', 'La repetición no duplica la asignación; la autorización posterior consulta permisos vigentes y refleja la retirada.')],
3: [
 ('Alta y modificación', 'Persona sintética: Ana Prueba, documento único, correo ana.prueba@example.invalid y campos laborales válidos.', 'Registrar al empleado, releerlo, modificar su especialidad con la versión vigente y releer.', 'Existe un empleado con los datos confirmados y versiones coherentes; cuenta y rol se gestionan explícitamente.'),
 ('Duplicado o datos inválidos', 'Documento o correo ya existente; en otro intento omitir un nombre obligatorio.', 'Enviar cada alta por separado.', 'Se informa duplicidad o validación; no se crea un segundo empleado ni un registro incompleto.'),
 ('Desactivación con historia', 'Empleado sintético con asignaciones históricas.', 'Desactivarlo y consultar su ficha e historia.', 'Queda inactivo conservando trazabilidad; no se elimina físicamente su historial.'),
 ('Identidad pendiente y replay', 'Alta con acceso solicitado; fallo controlado del proveedor y operationId estable.', 'Registrar, repetir la misma solicitud y efectuar el reintento de sincronización de identidad.', 'El alta laboral permanece; no se duplica y el estado de acceso distingue pendiente/fallido de sincronizado.')],
4: [
 ('Turno con descanso', 'Mecánico activo; lunes 08:00–17:00; descanso 12:00–13:00.', 'Registrar el turno y consultar la disponibilidad para ese lunes.', 'El descanso se excluye de los intervalos disponibles.'),
 ('Horario inválido', 'Inicio 17:00 y fin 08:00; descanso incompleto o fuera del turno.', 'Intentar guardar cada variante por separado.', 'Se rechazan los intervalos inválidos y se conserva la planificación anterior.'),
 ('Superposición o ausencia', 'Turno existente 08:00–12:00; nuevo turno 10:00–14:00; ausencia para una fecha de trabajo.', 'Intentar superponer turnos; después registrar y consultar la ausencia.', 'Se informa el solapamiento; la ausencia válida bloquea disponibilidad en las fechas afectadas.'),
 ('Asignación confirmada', 'Trabajo confirmado dentro del tramo que se quiere modificar.', 'Cambiar el horario sin reconocimiento/autorización y repetir con el mecanismo permitido por el contrato.', 'El conflicto es visible; el cambio exige el reconocimiento autorizado previsto y no reasigna trabajos de manera implícita.')],
5: [
 ('Agenda propia', 'Mecánico A con dos trabajos y mecánico B con otro trabajo en el mismo día.', 'Ingresar como A, consultar el día y abrir una asignación propia.', 'Se muestran trabajos y detalle autorizados de A; no aparecen los trabajos de B.'),
 ('Registro ajeno', 'Identificador de asignación de B; sesión de A con alcance propio.', 'Solicitar directamente el detalle ajeno.', 'No se revelan datos de la asignación ajena.'),
 ('Día sin trabajos', 'Fecha del entorno sin asignaciones para A.', 'Consultar la agenda de esa fecha.', 'Se informa una agenda vacía auténtica; no se interpreta un error como lista vacía.'),
 ('Copia preparada offline', 'Trabajo previamente preparado mediante CU27 y luego dispositivo sin red.', 'Reabrir la copia local y consultar su fecha de preparación.', 'Solo se presentan datos preparados, con antigüedad visible; no se afirma una consulta online ni agenda offline completa.')],
6: [
 ('Alta, búsqueda y edición', 'Cliente sintético Luis Prueba, documento único, teléfono y correo válidos.', 'Registrar, buscar por documento, editar teléfono con versión vigente y releer.', 'Existe un solo cliente con los cambios persistidos; no se exige cuenta de cliente.'),
 ('Documento duplicado', 'Documento ya registrado y operationId nuevo.', 'Intentar crear otro cliente con ese documento.', 'Se rechaza el duplicado sin alterar al cliente original.'),
 ('Campos y concurrencia', 'Nombre vacío o correo inválido; otra edición usa una versión antigua.', 'Enviar cada variante y consultar después el registro.', 'Se rechazan los datos inválidos y la edición obsoleta; la versión actual se conserva.'),
 ('Alta offline ampliada', 'Sin conectividad; alta local de cliente descrita en el CU funcional.', 'Intentar registrar el cliente y verificar si existe soporte provisional.', 'El alcance funcional exige estado pendiente y validación posterior; la superficie offline vigente no lo implementa: prueba bloqueada hasta ampliar ese flujo.')],
7: [
 ('Alta y asociación', 'Cliente de prueba existente; placa sintética única 1234-TST, marca/modelo y año válidos.', 'Registrar el vehículo y consultar su ficha desde el cliente.', 'El vehículo queda vinculado al cliente correcto con identificación única.'),
 ('Placa duplicada', 'Placa ya registrada con otra solicitud.', 'Intentar un segundo registro.', 'Se rechaza la duplicidad; se conserva el vehículo original.'),
 ('Cliente o año inválido', 'UUID de cliente inexistente; en otro intento año fuera de límites.', 'Intentar guardar cada variante.', 'Se informa referencia inexistente o dato inválido, sin crear asociaciones huérfanas.'),
 ('Cambio de propietario', 'Vehículo existente y dos clientes sintéticos activos.', 'Modificar la asociación con versión vigente y consultar la trazabilidad disponible.', 'Se conserva la trazabilidad del cambio; la consulta consolidada de servicios de CU08 se verifica por separado.')],
8: [
 ('Historial autorizado', 'Vehículo con dos servicios históricos y evidencia de prueba privada.', 'Abrir el historial, seleccionar una intervención y consultar su evidencia autorizada.', 'Se muestran servicios, fechas, estados y detalle del vehículo sin modificar registros.'),
 ('Historial vacío', 'Vehículo existente sin intervenciones.', 'Consultar su historial.', 'Se informa ausencia real de servicios anteriores.'),
 ('Permiso o vehículo inexistente', 'Actor sin permiso; otro intento con UUID inexistente.', 'Solicitar el historial en ambas condiciones.', 'Se rechaza el acceso o se informa inexistencia sin divulgar datos de otros vehículos.'),
 ('Evidencia no disponible y offline', 'Historial con una referencia inaccesible; copia local descargada previamente.', 'Abrir la evidencia fallida y consultar la copia sin red.', 'Se informa el archivo no disponible; offline solo se muestra lo preparado con fecha de actualización. Diseño pendiente de implementación completa de CU08.')],
9: [
 ('Servicio válido', 'Nombre único, descripción, categoría admitida, 60 minutos y tarifa BOB 100,00.', 'Crear, consultar y modificar el servicio.', 'El catálogo guarda los datos y habilita el servicio activo para citas/cotizaciones.'),
 ('Límites inválidos', 'Duración cero o tarifa negativa.', 'Intentar registrar cada variante.', 'Se rechazan duración o tarifa inválidas sin persistir el servicio.'),
 ('Nombre duplicado', 'Nombre de un servicio existente cambiando solo mayúsculas/minúsculas.', 'Intentar una nueva alta.', 'Se aplica la regla de unicidad sin crear un duplicado por capitalización.'),
 ('Desactivación', 'Servicio con uso histórico.', 'Desactivarlo y consultar sus referencias anteriores.', 'No se ofrece en nuevas selecciones activas; se conservan sus referencias históricas, sin eliminación física.')],
10: [
 ('Cita válida', 'Cliente/vehículo relacionados, servicio activo y franja admitida.', 'Programar una cita y consultar el calendario.', 'Se registra la cita; no se presenta como asignación definitiva de mecánico ni servicio confirmado por CU15.'),
 ('Referencia inválida', 'Servicio inactivo o vehículo no asociado al cliente.', 'Intentar programar cada variante.', 'Se rechaza la referencia inválida y no aparece una cita confirmada.'),
 ('Reprogramación y cancelación', 'Cita vigente, versión actual, nuevo horario y motivo de cancelación.', 'Reprogramar, releer y luego cancelar.', 'Se valida nuevamente el horario; la cancelación conserva motivo y estado sin fingir una reserva mecánica inexistente.'),
 ('Duplicado y modo sin red', 'Mismo operationId; después intento de alta sin conexión.', 'Repetir el alta y examinar el comportamiento offline.', 'Replay no duplica. La cita provisional offline es alcance ampliado no implementado en la cola vigente; no debe mostrarse como confirmación del servidor.')],
11: [
 ('Recepción con cita', 'Vehículo y cita válidos; 45.000 km, motivo y condiciones visibles.', 'Registrar recepción y consultar los datos guardados.', 'Queda una recepción vinculada al vehículo y disponible para crear la orden.'),
 ('Recepción sin cita', 'Vehículo registrado y recepción sin cita permitida por el flujo autorizado.', 'Registrar kilometraje, motivo y observaciones sin appointmentId.', 'Se guarda la recepción válida sin inventar una cita.'),
 ('Datos inválidos o duplicado', 'Kilometraje negativo, motivo vacío o recepción ya abierta para el vehículo.', 'Enviar cada variante con solicitudes independientes.', 'Se informa validación o duplicidad; no se crean recepciones inconsistentes.'),
 ('Fotos e IA en recepción', 'Fotografía sintética permitida; repetir con archivo inválido y sin conexión.', 'Intentar el recorrido opcional de evidencias/IA desde recepción.', 'La especificación exige carga autorizada o pendiente local. No se considera cubierta por la IA de ejecución: integración específica pendiente de acreditar.')],
12: [
 ('Orden desde recepción', 'Recepción válida; un servicio activo con cantidad 1, descripción y prioridad admitida.', 'Crear la orden y consultar número, recepción y servicios.', 'Se genera una orden única pendiente de cotización; crearla no asigna mecánico ni autoriza ejecución.'),
 ('Servicios inválidos', 'Lista vacía, más de 20 líneas, cantidad cero o servicio inactivo.', 'Intentar cada variante por separado.', 'Se rechazan los datos fuera del contrato sin persistir una orden incompleta.'),
 ('Recepción repetida y replay', 'Recepción ya usada; mismo operationId del alta original y luego uno nuevo.', 'Repetir el alta y después intentar una segunda orden sobre la recepción.', 'El replay devuelve el resultado original; la segunda orden incompatible se rechaza.'),
 ('Orden provisional offline', 'Dispositivo sin conexión y recepción preparada.', 'Intentar el alta local de orden.', 'La variante provisional del CU necesita implementación específica: no se acredita con la cola actual de avances y no se afirma orden confirmada.')],
13: [
 ('Cálculo y persistencia', 'Dos unidades de servicio a BOB 100,00; descuento 10 %; impuesto configurado 0 %.', 'Crear cotización y releer sus líneas y total.', 'Subtotal BOB 200,00; descuento BOB 20,00; total BOB 180,00, calculados en Finanzas; estado pendiente.'),
 ('Importes y descuentos', 'Cantidad cero, precio negativo o descuento 21 %.', 'Intentar guardar cada cotización.', 'Se rechazan líneas inválidas o descuento superior al máximo autorizado de 20 %.'),
 ('Total manipulado', 'Mismas líneas del caso válido, total declarado BOB 1,00.', 'Enviar la solicitud con total inconsistente.', 'Se rechaza la inconsistencia; el total recibido del cliente no reemplaza al cálculo del propietario.'),
 ('Versión aprobada', 'Cotización aprobada y petición de cambio de precio.', 'Intentar modificar esa versión; utilizar después el flujo autorizado de nueva versión.', 'No se altera silenciosamente la versión aprobada; la revisión permitida mantiene trazabilidad y las restricciones de vínculo.')],
14: [
 ('Aprobación', 'Cotización pendiente y vigente; evidencia textual sintética de aceptación.', 'Registrar approved y consultar la cotización y la orden.', 'La decisión queda auditada sobre la cotización exacta; no se confirma ejecución sin CU15.'),
 ('Rechazo', 'Cotización pendiente vigente; evidencia y motivo de rechazo.', 'Registrar rejected y verificar el estado.', 'Queda rechazada y no habilita la ejecución.'),
 ('Evidencia o vigencia inválida', 'Evidencia vacía; en otro intento cotización vencida.', 'Registrar la decisión en cada condición.', 'Se rechaza el registro inválido o vencido, preservando el estado anterior.'),
 ('Replay y doble decisión', 'Decisión ya aplicada; mismo operationId y luego nueva solicitud contradictoria.', 'Repetir la primera decisión e intentar después cambiarla.', 'El replay devuelve el resultado original; se rechaza una decisión posterior incompatible.')],
15: [
 ('Saga satisfactoria', 'Orden válida, cotización aprobada, mecánico activo compatible y franja libre; servicios online.', 'Confirmar, esperar la conclusión y releer Operaciones, reserva y vínculo financiero mediante sus APIs.', 'Solo el estado global confirmed acredita éxito; reserva y vínculo corresponden a la misma orden y Saga.'),
 ('Franja ocupada', 'Dos órdenes compiten por la misma disponibilidad de un mecánico.', 'Solicitar las confirmaciones de forma concurrente.', 'No hay doble reserva confirmada del mismo tramo; se identifica el rechazo o conflicto.'),
 ('Rechazo del participante', 'Reserva aplicada y rechazo confirmado de Finanzas.', 'Ejecutar la Saga y seguir sus compensaciones.', 'Se liberan recursos reversibles mediante compensaciones idempotentes; la orden no queda confirmada incompletamente.'),
 ('Respuesta perdida', 'Participante aplica una operación; la respuesta se pierde y se repite el mismo identificador.', 'Interrumpir la respuesta, reanudar y observar la consulta de resultado.', 'Permanece pendiente de conciliación hasta conocer el resultado; no se interpreta timeout como rechazo ni se duplican efectos.')],
16: [
 ('Inicio y avance', 'Orden confirmada asignada al mecánico autenticado; descripción y 30 minutos de trabajo.', 'Iniciar ejecución, registrar un avance y releerlo.', 'El avance queda asociado al trabajo y actor correctos; no finaliza técnicamente la orden.'),
 ('Evidencia privada', 'JPEG/PNG sintético permitido, tamaño y checksum coherentes; S3 preparado.', 'Solicitar carga, transferir bytes, confirmar disponibilidad y descargar con autorización.', 'Se valida el objeto real; la referencia disponible permite recuperar los mismos bytes con acceso autorizado.'),
 ('Acceso o archivo inválido', 'Trabajo ajeno; en otra solicitud archivo no admitido o excesivo.', 'Intentar escribir o adjuntar la evidencia.', 'Se rechaza la operación sin asociar evidencia a un trabajo ajeno ni marcar disponible una carga fallida.'),
 ('Avance offline y concurrencia', 'Trabajo previamente preparado; sin red; reconexión con versión antigua.', 'Guardar avance local y sincronizar con CU27.', 'Permanece pendiente hasta respuesta propietaria; el conflicto se conserva para revisión sin pérdida ni confirmación ficticia.')],
17: [
 ('Verificación satisfactoria', 'Checklist completo, avance registrado y evidencia disponible; jefe distinto del mecánico ejecutor.', 'Solicitar revisión y aprobar con la versión vigente.', 'La ejecución queda técnicamente completada; no se registra entrega física automáticamente.'),
 ('Actividad o evidencia faltante', 'Un ítem obligatorio pendiente o cero evidencias disponibles.', 'Solicitar revisión.', 'Se bloquea la revisión por checklist/evidencia incompletos.'),
 ('Devolución', 'Trabajo pendiente de verificación; motivo de corrección válido.', 'Rechazar la revisión y consultar el estado.', 'Queda devuelto para corrección con motivo y auditoría.'),
 ('Autoaprobación y replay', 'Jefe y mecánico son la misma identidad; otra aprobación válida repetida con igual operationId.', 'Intentar autoaprobar; repetir una aprobación autorizada previa.', 'Se impide la autoaprobación por identidad; la repetición válida no crea una segunda decisión.')],
18: [
 ('Entrega autorizada', 'Orden técnicamente finalizada, obligación saldada y receptor autorizado.', 'Registrar receptor, fecha, hora, observaciones y evidencia de entrega.', 'Se registra una entrega única y la intervención aparece en el historial. Flujo pendiente de implementación.'),
 ('Orden no finalizada', 'Orden todavía en ejecución.', 'Intentar registrar entrega.', 'Se rechaza la entrega sin cerrar el trabajo.'),
 ('Saldo pendiente', 'Orden finalizada con cobro pendiente y sin autorización administrativa aplicable.', 'Intentar entregar.', 'Se impide la entrega conforme a la política vigente; no se presume crédito habilitado.'),
 ('Receptor o duplicado', 'Receptor no autorizado; en otro caso vehículo ya entregado.', 'Intentar la entrega en ambas situaciones.', 'Se rechaza la operación incompatible y se conserva el registro original.')],
19: [
 ('Cobro íntegro', 'Orden finalizada; obligación y saldo 10.000 centavos BOB; efectivo recibido 10.000.', 'Registrar el cobro online, consultar el saldo y releer el comprobante interno.', 'Se registra un único cobro de BOB 100,00, saldo cero y comprobante interno; no implica factura fiscal.'),
 ('Parcial o exceso', 'Saldo 10.000; importes 5.000 y 10.001 centavos.', 'Intentar ambos cobros de forma independiente.', 'Se rechazan abono parcial y exceso según FULL_AFTER_COMPLETION_V1; no cambia el saldo.'),
 ('Referencia no verificada', 'Método que requiere referencia, sin verificación autorizada o con referencia incompatible.', 'Intentar confirmar el cobro.', 'Se rechaza la referencia; registrar una referencia humana no acredita una transferencia bancaria real.'),
 ('Replay, pérdida de respuesta y offline', 'operationId constante; interrupción tras aplicar el cobro; después dispositivo sin red.', 'Consultar resultado, repetir con igual intención e intentar confirmar otro cobro offline.', 'Se conserva un único efecto financiero y recibo; el cobro definitivo offline no se confirma.')],
20: [
 ('Gasto válido', 'Categoría activa, fecha 2026-11-10, BOB 50,00, descripción y método admitidos.', 'Registrar, filtrar por fecha y consultar responsable e importe.', 'Existe un gasto de 5.000 centavos BOB asociado al actor autorizado.'),
 ('Categoría o importe inválido', 'Categoría inexistente/inactiva; importe cero o negativo.', 'Intentar cada registro por separado.', 'Se rechazan entradas inválidas sin efecto en los totales.'),
 ('Respaldo documental', 'Documento sintético privado disponible del actor; repetir con documento ajeno o pendiente.', 'Registrar el gasto y descargar el respaldo autorizado.', 'Solo se vincula un documento disponible propio y no consumido; la descarga preserva sus bytes y autorización.'),
 ('Duplicado y replay', 'Misma fecha/categoría/importe/método/descripción; después mismo operationId.', 'Intentar un posible duplicado sin justificación y repetir un registro ya aceptado.', 'Se advierte y rechaza el duplicado no reconocido; replay no crea otro gasto. Una intención nueva requiere el flujo explícito previsto.')],
21: [
 ('Panel consolidado', 'Datos sintéticos conocidos en Operaciones, Empleados y Finanzas; período delimitado.', 'Consultar indicadores por GraphQL y contrastar cada cifra con su API propietaria.', 'Se muestran indicadores y fuentes coherentes sin modificar los datos. Panel completo pendiente de implementar.'),
 ('Período vacío', 'Período verificado sin movimientos.', 'Aplicar el filtro temporal.', 'Se muestra un vacío real o cero cuando corresponde al indicador; no se inventan movimientos.'),
 ('Fallo parcial', 'Un propietario indisponible y otros dos disponibles.', 'Consultar el panel.', 'Se identifican métricas parciales/no disponibles, sin sustituir el fallo por cero.'),
 ('Permisos y filtros', 'Actor sin permiso financiero; rango invertido.', 'Consultar métricas restringidas y luego enviar un filtro inválido.', 'No se divulgan métricas prohibidas; se rechaza el rango inválido.')],
22: [
 ('Inferencia real sin internet', 'Modelo y runtime preparados; fotografía sintética autorizada; web y Android, cada plataforma por separado.', 'Desconectar la red, ejecutar la inferencia y guardar la revisión humana.', 'Se ejecuta TFJS/LiteRT local, se guardan modelVersion y predicción; la revisión humana queda separada y el envío sigue pendiente.'),
 ('Modelo ausente', 'Dispositivo sin artefacto local o artefacto dañado.', 'Solicitar inspección local.', 'Se informa ausencia/incompatibilidad sin inventar predicción; se permite el registro manual previsto.'),
 ('Foto y recursos inválidos', 'Archivo de formato no admitido; foto inferior al mínimo; fallo de memoria controlado.', 'Intentar procesar cada variante.', 'Se informa rechazo o insuficiencia de recursos; no se persiste una inferencia como exitosa.'),
 ('Salida bajo umbral', 'Imagen autorizada con resultados debajo de los umbrales versionados; revisión manual.', 'Ejecutar, revisar y registrar una corrección humana.', 'Se distingue salida insuficiente de diagnóstico definitivo; se conserva la predicción original y la revisión, sin atribuir precisión no evaluada.')],
23: [
 ('Análisis remoto', 'Orden autorizada, evidencia privada disponible en S3 y modelo preparado en MS04.', 'Solicitar análisis, consultar resultado y releer metadatos desde la API.', 'Se conservan referencia de imagen, checksum, versión del modelo y resultados en MongoDB; la predicción no se convierte en diagnóstico definitivo.'),
 ('Imagen no autorizada', 'Referencia a evidencia ajena o fuera del alcance del actor.', 'Enviar la solicitud de análisis.', 'Se rechaza el acceso sin leer ni procesar una imagen no autorizada.'),
 ('Modelo o infraestructura ausentes', 'Modelo no preparado; después S3 o MongoDB indisponible, cada condición por separado.', 'Intentar el análisis.', 'Se informa la dependencia fallida y no se declara análisis persistido con éxito.'),
 ('Archivo y recorrido humano', 'Imagen corrupta o no admitida; después solicitud de corregir/incorporar un resultado válido.', 'Enviar el archivo inválido y recorrer la revisión humana disponible.', 'Se rechaza el archivo. Corrección/incorporación o lote no entregados se registran como brecha, sin dar por cubierto todo el CU.')],
24: [
 ('Predicción con modelo validado', 'Modelo entrenado/evaluado, variables compatibles y datos históricos autorizados.', 'Solicitar estimación y consultar fuente, versión e incertidumbre disponible.', 'Se muestra una duración razonable trazable al modelo. Prueba bloqueada mientras falte la implementación y evaluación.'),
 ('Fallback referencial', 'Sin modelo validado; servicio con duración referencial de 60 minutos.', 'Solicitar estimación.', 'Se identifican explícitamente 60 minutos como referencia del catálogo, sin presentarlos como predicción ML.'),
 ('Variables inválidas', 'Servicio inexistente o variables incompletas/incompatibles.', 'Solicitar estimación.', 'Se informa el problema y no se inventa una predicción.'),
 ('Ajuste humano', 'Estimación identificada; jefe modifica de 60 a 75 minutos.', 'Guardar el ajuste y consultar su trazabilidad.', 'Se conserva la fuente original junto con el ajuste humano y su responsable; no se reemplaza la historia del modelo.')],
25: [
 ('Consulta con fuentes', 'Empleado autorizado y consulta de órdenes o agenda de prueba.', 'Preguntar al asistente y contrastar la respuesta con la fuente propietaria.', 'Se responde con datos autorizados y referencias; no hay escrituras de negocio ni dependencia obligatoria de MCP.'),
 ('Resumen financiero delimitado', 'Responsable con payments:read y expenses:read; período explícito de hasta 31 días.', 'Pedir cobros y gastos entre dos fechas civiles.', 'Las cifras coinciden con Finanzas; neto no se presenta como rentabilidad o caja.'),
 ('Ambigüedad o falta de permiso', 'Pregunta financiera sin fechas; otra consulta sin alcance financiero.', 'Enviar ambas consultas.', 'Se pide aclaración o se deniega, sin adivinar períodos ni filtrar información restringida.'),
 ('Instrucción maliciosa o fuente caída', 'Texto de prueba que pide ignorar permisos; en otro caso propietario inaccesible.', 'Solicitar una escritura o consultar durante la caída.', 'Se rechaza la escritura y no se ejecutan instrucciones de datos no confiables; se informa indisponibilidad sin inventar cifras.')],
26: [
 ('Reporte operativo', 'Actor autorizado, período con datos de prueba y trabajo de generación identificado.', 'Generar, releer y exportar por un formato habilitado.', 'Las métricas coinciden con las fuentes y la narrativa se distingue de los datos; el trabajo conserva identidad.'),
 ('Reporte financiero', 'Período delimitado y permisos financieros vigentes.', 'Generar el reporte financiero y comparar importes con el ledger.', 'Se preservan centavos y fuentes financieras; la salida no se mezcla con un trabajo operativo.'),
 ('Fallo o cifra incorrecta de IA', 'Fallo controlado del modelo o narrativa que altera una cifra.', 'Generar y examinar narrativa y rótulo de procedencia.', 'El verificador impide publicar la narrativa incorrecta; se informa el fallo o se usa plantilla determinista identificada.'),
 ('Replay y alcance faltante', 'Mismo jobId y período; luego otro período con igual jobId y un tipo no implementado.', 'Repetir, cambiar intención e intentar productividad/gráficos pendientes.', 'Replay recupera el mismo trabajo; se rechaza intención incompatible; los tipos/exportaciones no entregados se marcan pendientes.')],
27: [
 ('Cola y dependencias', 'Trabajo preparado; avance y foto offline con operationId estables y dependencias.', 'Reabrir la app sin red, reconectar y sincronizar.', 'El propietario acepta cambios en orden; solo se marca aplicado lo confirmado y se conserva trazabilidad local.'),
 ('Respuesta perdida y replay', 'Propietario aplica un avance pero no llega su respuesta.', 'Reconectar y reenviar la misma operación.', 'Se recupera el resultado sin un avance o archivo adicional; la idempotencia se confirma en el propietario.'),
 ('Permiso o versión revocados', 'Operación local pendiente; al reconectar el actor pierde acceso o la versión cambia.', 'Sincronizar.', 'Se registra rechazo/conflicto sin borrar evidencia local necesaria ni convertirlo en éxito.'),
 ('Autenticación o dependencia caída', '401 o 503 del propietario; dependencia aún no aplicada.', 'Enviar la cola y reintentar después de corregir la condición.', 'La operación permanece pendiente; dependientes no se ejecutan antes que sus prerrequisitos; cobros definitivos no se cuelan en la cola.')],
28: [
 ('Evento empresarial real', 'Flujo n8n habilitado, credenciales limitadas y destinatario local autorizado.', 'Generar un evento empresarial permitido y consultar su ejecución/recibo.', 'Se ejecuta la acción permitida con seguimiento; canal local no se presenta como entrega externa.'),
 ('Evento duplicado', 'Mismo eventId y contenido repetidos.', 'Entregar el evento dos veces y revisar efectos.', 'Se deduplica o recupera el mismo resultado; no hay efectos adicionales incompatibles.'),
 ('Fallo y reintento', 'Receptor temporalmente caído o destinatario inexistente.', 'Ejecutar, registrar el fallo y reintentar cuando corresponda.', 'Se conserva el resultado y se reintenta de forma controlada; no se revierte la reparación previamente confirmada.'),
 ('Programación y autorización', 'Semana lunes 2026-11-02 a domingo 2026-11-08, zona America/La_Paz; otro intento sin credencial.', 'Disparar el flujo programado y luego una solicitud no autorizada.', 'El período y autorización se validan; la solicitud inválida se rechaza y no genera una ejecución autorizada.')],
29: [
 ('Descubrimiento y consulta', 'Cliente MCP autorizado; scopes de lectura y usuario delegado con vínculo activo.', 'Negociar capacidades, listar herramientas e invocar una herramienta GET disponible.', 'Se devuelve información estructurada autorizada y auditoría sin secretos; solo se anuncia el catálogo efectivo.'),
 ('Scope insuficiente', 'Cliente sin el scope exigido para una herramienta.', 'Intentar descubrir/invocar la herramienta restringida.', 'No se permite la invocación; el propietario mantiene su control de acción y registro.'),
 ('Token o argumentos inválidos', 'Token vencido o de audiencia de API; otro intento con campos extra/UUID inválido.', 'Enviar cada variante al servidor MCP.', 'Se rechazan credenciales o argumentos sin acceder indebidamente a la API interna.'),
 ('Propietario o herramienta ausente', 'Propietario devuelve 403/503; herramienta de historial/listar_servicios no disponible en el catálogo actual.', 'Invocar la consulta y solicitar la herramienta ausente.', 'No se convierte un fallo en lista vacía ni se inventa una herramienta; se comunica el límite del catálogo.')],
30: [
 ('Acción autorizada confirmada', 'Cliente/usuario autorizados; herramienta de escritura habilitada; confirmación humana válida.', 'Solicitar una acción con operationId y consultar el resultado propietario.', 'Se ejecuta una sola acción permitida y queda auditada. Flujo de escritura pendiente de implementar.'),
 ('Confirmación ausente', 'Solicitud que exige confirmación, sin evidencia válida de aprobación humana.', 'Invocar la herramienta de escritura.', 'La acción queda pendiente o se rechaza; no se ejecuta la mutación.'),
 ('Acceso o regla de negocio', 'Scope insuficiente; en otro intento franja ocupada o datos inválidos.', 'Solicitar la operación.', 'Se rechaza por autorización o regla del propietario sin omitir controles.'),
 ('Replay y respuesta perdida', 'Mismo operationId, misma intención; luego contenido distinto con igual identificador.', 'Repetir tras perder respuesta y después cambiar los argumentos.', 'Se recupera el único resultado; el identificador con otra intención produce conflicto, no una segunda operación.')],
31: [
 ('Alta de cliente limitado', 'Administrador autorizado, identificador único y scopes permitidos.', 'Registrar el cliente MCP, releerlo y comprobar su catálogo efectivo.', 'El cliente dispone solo de herramientas autorizadas y existe auditoría. CRUD administrativo pendiente.'),
 ('Duplicado y escalamiento', 'Identificador existente; otra solicitud con permisos superiores a los del administrador.', 'Intentar ambas configuraciones.', 'Se rechazan duplicidad y permisos excesivos sin ampliar acceso.'),
 ('Suspensión o revocación', 'Cliente autorizado con credenciales emitidas.', 'Suspender/revocar y efectuar una nueva operación conforme a la política de vigencia.', 'Nuevas operaciones son bloqueadas conforme al mecanismo definido; no se promete revocación instantánea universal de JWT.'),
 ('Fallo del mecanismo de autorización', 'Actualización de configuración con proveedor inaccesible.', 'Solicitar modificación y consultar estado/auditoría.', 'Se informa estado pendiente/fallido sin afirmar permisos sincronizados; el archivo local actual no sustituye este CU administrativo.')],
}

# The source anchors delimit literal excerpts. Flows are explicitly reduced block diagrams;
# they document the selected unit, not an exhaustive CFG of the entire CU.
WHITE = {}
def white(n, path, start, stop, function, nodes, paths, note=''):
    WHITE[n] = dict(path=path, start=start, stop=stop, function=function, nodes=nodes, paths=paths, note=note)

white(1, 'web/browser-auth/session.ts', '  async function refresh()', '  sdk.onAuthLogout', 'refresh',
 ['Capturar epoch y comprobar sesión activa', 'Renovar token con updateToken(30)', 'Comprobar que epoch no cambió y no se dispuso la sesión', 'Comprobar autenticación y token del SDK', 'Publicar y volver a comprobar sesión'],
 [('1→E', 'disposed=true o authenticated=false', 'Error: sesión no disponible'), ('1→2→E', 'updateToken rechaza', 'Error de renovación; fail solo para epoch vigente'), ('1→2→3→E', 'epoch cambia durante renovación', 'Rechazo de respuesta antigua; limpiar token según loggingOut'), ('1→2→3→4→E', 'SDK sin token o sin autenticación', 'fail y rechazo'), ('1→2→3→4→5→S', 'Sesión válida y epoch estable', 'Publicación authenticated y fin sin error')],
 'Unidad web de renovación que protege las operaciones posteriores al login. La validación criptográfica, credenciales y cuenta deshabilitada se prueban además en Keycloak/API; este fragmento no las implementa.')
white(2, EMP+'domain/security.ts', 'export function assertNoEscalation', None, 'assertNoEscalation',
 ['Recibir permisos solicitados y efectivos', 'Evaluar si existe permiso solicitado que el actor no posee', 'Permitir continuar sin elevar privilegios'],
 [('1→2→E', 'requested=[payments:write], effective=[]', 'SecurityError 409 PERMISSION_ESCALATION'), ('1→2→3→S', 'requested contenido en effective', 'Sin excepción'), ('1→2→3→S', 'requested=[]', 'Sin escalamiento; otras reglas se verifican en sus unidades')], 'La protección del último administrador y la persistencia pertenecen a otras unidades y necesitan pruebas complementarias.')
white(3, EMP+'application/manage-employees.ts', '  async mutate(', '\n}\n', 'ManageEmployees.mutate',
 ['Validar comando y ejecutar transición local', 'Evaluar replay y acceso pending', 'Sincronizar identidad cuando corresponde', 'Clasificar errores del proveedor sin perder commit local', 'Devolver resultado de la mutación'],
 [('1→E', 'Comando inválido', 'Error de validación antes de sincronizar'), ('1→2→5→S', 'replayed=true o access.status distinto de pending', 'No repetir sincronización'), ('1→2→3→5→S', 'Alta nueva con acceso pending; IdP responde', 'Intento de sincronización y retorno del resultado'), ('1→2→3→4→5→S', 'IdentitySyncError o fallo al confirmar sincronización', 'Se conserva commit local; error clasificado o conciliable')])
white(4, EMP+'domain/schedule.ts', 'export function shift(', '\nexport function absence', 'shift',
 ['Validar objeto, día y formato de horas', 'Exigir inicio menor que fin', 'Determinar si se declaró un descanso', 'Validar par de descanso, orden y pertenencia al turno', 'Devolver turno normalizado'],
 [('1→E', 'weekday=9 o startsAt=25:00', 'VALIDATION_ERROR'), ('1→2→E', 'startsAt=17:00, endsAt=08:00', 'VALIDATION_ERROR'), ('1→2→3→5→S', '08:00–17:00 sin descanso', 'breakStart y breakEnd nulos'), ('1→2→3→4→E', 'Solo breakStart o descanso fuera del turno', 'VALIDATION_ERROR'), ('1→2→3→4→5→S', 'Descanso 12:00–13:00 dentro de 08:00–17:00', 'Turno con descanso normalizado')])
white(5, EMP+'application/read-agenda.ts', '  async check(', '\n}\n', 'ReadAgenda.check',
 ['Validar scope e identificadores', 'Autorizar contexto del actor', 'Consultar asignaciones propias o del equipo según scope', 'Comparar cantidad encontrada con la solicitada', 'Devolver actor, trabajos y observedAt'],
 [('1→E', 'Scope/UUID inválido', 'Rechazo de entrada'), ('1→2→E', 'Actor sin scope solicitado', 'AGENDA_ACCESS_DENIED'), ('1→2→3→4→E', 'Una asignación ajena no aparece en consulta self', 'AGENDA_WORK_NOT_FOUND'), ('1→2→3→4→5→S', 'Todas las asignaciones son autorizadas', 'Resultado y marca de observación')])
for n, cls in [(6,'Customers'), (7,'Vehicles')]:
    white(n, OP+'application/Manage'+cls+'.java', '    public Mutation<', '    public Mutation<', 'Manage'+cls+'.create',
      ['Validar claves permitidas del cuerpo', 'Validar operationId como UUID', 'Construir Draft mediante validaciones de dominio', 'Delegar creación al repositorio propietario', 'Devolver mutación o propagar error del propietario'],
      [('1→E', 'Campo adicional no permitido', 'Validación rechazada'), ('1→2→E', 'operationId no es UUID', 'Validación rechazada'), ('1→2→3→E', 'Dato obligatorio inválido en Draft', 'Sin llamada de creación válida'), ('1→2→3→4→5→S', 'Datos válidos y repositorio acepta', 'Mutación persistida'), ('1→2→3→4→5→E', 'Duplicado o referencia inválida detectados por repositorio', 'Error propietario sin alta adicional')],
      'Las comprobaciones de unicidad, referencias e idempotencia se ejecutan en el repositorio; no son condiciones locales de este método. Para comprobar integración se necesita la base real.')
white(9, OP+'application/ManageServices.java', '    public Mutation<ServiceOffering> create(', '    public Mutation<ServiceOffering> update', 'ManageServices.create',
 ['Validar claves permitidas', 'Validar operationId', 'Construir ServiceOffering.Draft', 'Crear en repositorio y devolver mutación'],
 [('1→E', 'Campo adicional', 'Validación rechazada'), ('1→2→3→E', 'Duración cero o tarifa negativa', 'Error desde validación de Draft'), ('1→2→3→4→E', 'Nombre duplicado según repositorio', 'Error sin alta adicional'), ('1→2→3→4→S', 'Servicio válido y nombre libre', 'Servicio creado')])
white(10, OP+'application/ManageAppointments.java', '    public Mutation<Appointment> cancel(', '    private static int queryInt', 'ManageAppointments.cancel',
 ['Validar claves y UUID de cita/operación', 'Validar expectedVersion', 'Validar motivo de 1 a 200 caracteres', 'Delegar cancelación al repositorio'],
 [('1→E', 'UUID inválido o campo extra', 'Validación rechazada'), ('1→2→E', 'Versión inválida', 'Validación rechazada'), ('1→2→3→E', 'Motivo vacío o mayor que 200', 'Validación rechazada'), ('1→2→3→4→S', 'Cita vigente, versión y motivo válidos', 'Cancelación aceptada'), ('1→2→3→4→E', 'Conflicto de versión en repositorio', 'Conflicto sin sobrescribir la cita')])
white(11, OP+'domain/Reception.java', '        public static Draft from(', '\n    }', 'Reception.Draft.from',
 ['Leer appointmentId opcional', 'Validar vehicleId y appointmentId si existe', 'Validar kilometraje y motivo', 'Validar textos opcionales y devolver Draft'],
 [('1→2→3→4→S', 'appointmentId=null y demás datos válidos', 'Recepción sin cita en el Draft'), ('1→2→3→4→S', 'UUID de cita y vehículo válidos', 'Draft con cita; existencia se comprueba posteriormente'), ('1→2→E', 'appointmentId presente pero no UUID', 'Validación rechazada'), ('1→2→3→E', 'mileage negativo o reason vacío', 'Validación rechazada')])
white(12, OP+'domain/WorkOrder.java', '        public static Draft from(', '\n    }', 'WorkOrder.Draft.from',
 ['Exigir lista de servicios con 1 a 20 elementos', 'Recorrer elementos y exigir objeto con claves permitidas', 'Validar serviceId y quantity por línea', 'Validar recepción, descripción, prioridad y notas', 'Construir Draft con las líneas'],
 [('1→E', 'services=[] o 21 elementos', 'Validación rechazada'), ('1→2→E', 'Elemento no objeto o con clave extra', 'Validación rechazada'), ('1→2→3→E', 'quantity=0 o serviceId inválido', 'Validación rechazada'), ('1→2→3→2→3→4→5→S', 'Dos líneas válidas y cabecera correcta', 'Draft con dos servicios'), ('1→2→3→4→E', 'Prioridad o recepción mal formada', 'Validación rechazada')])
white(13, FIN+'Domain/QuotePolicy.php', '    public static function calculate(', '    /** The client', 'QuotePolicy.calculate',
 ['Exigir 1 a 20 ítems', 'Validar descuento 0–20 y tributo 0–30', 'Recorrer ítems: referencia única, cantidad 1–99 y precio no negativo', 'Acumular líneas y subtotal redondeados', 'Calcular descuento, base, impuesto y total'],
 [('1→E', 'items=[]', 'QUOTE_ITEMS_INVALID'), ('1→2→E', 'discountPercent=21', 'DISCOUNT_NOT_AUTHORIZED'), ('1→2→E', 'taxPercent=31', 'TAX_INVALID'), ('1→2→3→E', 'Referencia repetida o quantity=0', 'QUOTE_ITEMS_INVALID'), ('1→2→3→4→5→S', 'quantity=2, unitPrice=100, descuento=10, impuesto=0', 'subtotal=200; discountAmount=20; total=180')])
white(14, FIN+'Http/Controllers/QuoteController.php', '    private function decideInTransaction(', '    private function view(', 'QuoteController.decideInTransaction',
 ['Validar operationId y calcular fingerprint', 'Consultar resultado idempotente', 'Validar decisión y evidencia', 'Bloquear cotización y comprobar existencia, estado, vínculo y vigencia', 'Persistir decisión, estado y resultado idempotente en transacción'],
 [('1→E', 'operationId inválido', '400 VALIDATION_ERROR'), ('1→2→S', 'Replay con igual fingerprint', 'quote previa; replayed=true'), ('1→2→3→E', 'evidence vacía', '400 VALIDATION_ERROR'), ('1→2→3→4→E', 'Cotización vencida o ya decidida', '409 QUOTE_EXPIRED o QUOTE_ALREADY_DECIDED'), ('1→2→3→4→5→S', 'Cotización pendiente, vigente, sin vínculo; decisión válida', 'Decisión persistida y orderStatusHint; replayed=false')])
white(15, OP+'application/RunConfirmation.java', '    private void run(', '    private void defer(', 'RunConfirmation.run',
 ['Cargar Saga; salir si ausente/terminal y finalizar fase terminal', 'Preparar paso y persistir dispatched bajo claim', 'Consultar resultado si requiere conciliación; ejecutar si no existe', 'Validar respuesta y clasificar applied/rejected', 'Avanzar fase o compensar; en excepción marcar uncertain y diferir', 'Guardar estado persistente'],
 [('1→S', 'Saga null o terminal', 'Sin nueva llamada participante'), ('1→2→S', 'save devuelve false por claim perdido', 'Sin ejecutar participante'), ('1→2→3→4→5→6→S', 'Respuesta applied válida', 'Siguiente fase; estado running si no compensa'), ('1→2→3→4→5→6→S', 'Respuesta rejected confirmada', 'Compensación o compensation_pending según dirección'), ('1→2→3→5→6→S', 'Timeout en participante; si respuesta mal formada, pasa primero por validación del nodo 4', 'Paso uncertain; recovery_pending o compensation_pending; reintento diferido')],
 'El diagrama agrupa fases; no enumera el espacio completo de estados de la Saga. Deben agregarse pruebas de validate, claims, concurrencia, Outbox y participantes reales.')
white(16, OP+'application/ManageExecutions.java', '    public Mutation<Execution> advance(', '    public EvidenceUpload requestEvidence(', 'ManageExecutions.advance',
 ['Validar cuerpo, UUID, versión, texto, minutos y fecha opcional', 'Autorizar asignación y comprobar confirmación y ejecución editable', 'Resolver fecha y exigir que no sea futura ni anterior al inicio', 'Calcular fingerprint y consultar replay', 'Anexar avance con expectedVersion o devolver ejecución previa'],
 [('1→E', 'description vacía o minutesWorked inválido', 'Validación rechazada'), ('1→2→E', 'Asignación ajena o estado no editable', 'Denegación/conflicto según regla'), ('1→2→3→E', 'occurredAt futuro o anterior al inicio', 'Validación rechazada'), ('1→2→3→4→5→S', 'Replay con igual fingerprint y estado editable', 'Ejecución previa; replayed=true'), ('1→2→3→4→5→S', 'Operación nueva y versión actual', 'Avance anexado; replayed=false')],
 'El estado editable se comprueba antes del replay en este método. No se atribuye éxito automático a un reenvío después de que CU17 cierre el trabajo. El flujo S3 necesita pruebas de sus métodos separados.')
white(17, OP+'application/ManageVerification.java', '    public Verification.View requestReview(', '    public Verification.View approve(', 'ManageVerification.requestReview',
 ['Validar UUID/versión, autorizar trabajo y confirmar referencias', 'Consultar replay antes de exigir transición', 'Exigir in_progress y al menos un avance', 'Exigir evidencia disponible y checklist sin pendientes', 'Solicitar revisión con versión actual y devolver vista'],
 [('1→2→5→S', 'Resultado idempotente encontrado', 'Vista actual sin nueva transición'), ('1→2→3→E', 'Sin avances', 'EVIDENCE_REQUIRED'), ('1→2→3→4→E', 'Sin evidencia disponible', 'EVIDENCE_REQUIRED'), ('1→2→3→4→E', 'Checklist con pendientes', 'CHECKLIST_INCOMPLETE'), ('1→2→3→4→5→S', 'Requisitos satisfechos; requestReview=true', 'Pendiente de verificación'), ('1→2→3→4→5→E', 'requestReview=false', 'VERSION_CONFLICT')],
 'La decisión approve/reject y SELF_VERIFICATION_FORBIDDEN pertenecen a decide; este análisis selecciona la solicitud de revisión. Deben verificarse esas unidades para cerrar todo CU17.')
white(19, FIN+'Domain/Ledger/CollectionPolicy.php', '    public static function paymentError(', '\n}', 'CollectionPolicy.paymentError',
 ['Comprobar saldo negativo', 'Comprobar saldo cero', 'Comparar importe con saldo mediante Money', 'Devolver error de parcial/exceso o null'],
 [('1→E', 'amount=10000, balance=-1', 'BALANCE_INCONSISTENT'), ('1→2→E', 'amount=10000, balance=0', 'NO_BALANCE_DUE'), ('1→2→3→4→E', 'amount=5000, balance=10000', 'PAYMENT_PARTIAL_UNSUPPORTED'), ('1→2→3→4→E', 'amount=10001, balance=10000', 'PAYMENT_EXCEEDS_BALANCE'), ('1→2→3→4→S', 'amount=10000, balance=10000', 'null: la política de importe permite continuar')],
 'Valores en strings de centavos. null significa que esta regla acepta el importe; autorización, estado de orden, referencia, transacción e idempotencia se verifican en otras unidades.')
white(20, FIN+'Application/Ledger/FinancialLedger.php', '    private function expense(', '    public function receipt(', 'FinancialLedger.expense',
 ['Validar categoría activa', 'Si hay documento, exigir propiedad, disponibilidad y no consumo', 'Calcular clave y tomar locks en orden', 'Buscar candidatos duplicados y exigir duplicateOf compatible', 'Guardar gasto y asociar documento si corresponde'],
 [('1→E', 'Categoría inexistente/inactiva', 'EXPENSE_CATEGORY_INVALID'), ('1→2→E', 'Documento ajeno', 'DOCUMENT_NOT_FOUND'), ('1→2→E', 'Documento no disponible o ya consumido', 'DOCUMENT_NOT_AVAILABLE'), ('1→2→3→4→E', 'Candidatos sin duplicateOf aceptable', 'EXPENSE_POSSIBLE_DUPLICATE'), ('1→2→3→4→5→S', 'Categoría válida; sin candidatos ni documento', 'Gasto guardado'), ('1→2→3→4→5→S', 'Documento propio disponible; duplicado reconocido correctamente', 'Gasto y vínculo documental')],
 'El wrapper command valida intención/idempotencia y abre la transacción; el input monetario se valida antes de expense. Este método no es una API aislada.')
white(22, 'web/shell/src/offline/inference.ts', 'function checkDimensions(', '\nexport async function validatePhoto', 'checkDimensions',
 ['Comprobar dimensiones positivas y límites máximos', 'Comprobar mínimo de 32 píxeles por lado', 'Aceptar dimensiones sin error'],
 [('1→E', 'width=8193, height=100', 'Rechazo por límite de lado'), ('1→E', 'width=6000, height=5000', 'Rechazo por más de 24 megapíxeles'), ('1→2→E', 'width=31, height=100', 'Calidad insuficiente'), ('1→2→3→S', 'width=32, height=32', 'Aceptado por dimensiones'), ('1→2→3→S', 'width=4000, height=6000', 'Límite de 24 megapíxeles aceptado')],
 'Unidad web de entrada a inferencia. No demuestra calidad del modelo ni LiteRT; validar foto, inferencia, persistencia y revisión humana requiere unidades y recorridos adicionales.')
white(23, 'services/intelligence/app/vision.py', '    def analyze(', '    def preview(', 'VisionModel.analyze (método de análisis)',
 ['Exigir modelo cargado', 'Preparar imagen validando formato y dimensiones', 'Predecir y construir etiquetas con umbrales', 'Construir Prediction con versión, hash y metadatos'],
 [('1→E', 'self._model=None', 'MODEL_NOT_READY 503'), ('1→2→E', 'Payload inválido rechazado por _prepare', 'Error de entrada; sin Prediction'), ('1→2→3→E', 'predict falla', 'No se obtiene Prediction; capa de aplicación debe informar fallo'), ('1→2→3→4→S', 'Modelo y foto válidos; score igual al umbral', 'flagged=true para esa etiqueta'), ('1→2→3→4→S', 'score inferior al umbral', 'flagged=false; Prediction conserva versión/hash')],
 'La persistencia MongoDB y la autorización de evidencia S3 ocurren fuera de este método. La prueba de inferencia debe usar el artefacto real preparado y no atribuye precisión clínica/mecánica.')
white(25, AG+'planner.ts', 'export function plan(', None, 'plan',
 ['Rechazar intención financiera de escritura o patrones de escalamiento', 'Si fase safety, permitir continuar', 'Si intención financiera, exigir período y herramienta autorizada', 'Resolver avances u órdenes y exigir identificador/herramienta', 'Elegir agenda autorizada o rechazar por falta de alcance'],
 [('1→E', 'Consulta: cambia los permisos del administrador', 'refuse solo_lectura'), ('1→2→S', 'Consulta segura; phase=safety', 'continue'), ('1→2→3→E', 'Consulta financiera sin dos fechas', 'refuse financial_clarification'), ('1→2→3→S', 'Consulta financiera con período y FINANCIAL_TOOL', 'call a herramienta financiera'), ('1→2→3→4→E', 'Pide avances sin assignmentId', 'refuse falta_asignacion'), ('1→2→3→4→5→S', 'Consulta de agenda con herramienta propia disponible', 'call de agenda con rango')],
 'Planificador determinista de selección; no sustituye la autorización en la herramienta/propietario ni valida por sí solo toda inyección de instrucciones en resultados.')
white(26, AG+'report/contract.ts', 'export function checkReportContract(', '  const figures =', 'checkReportContract: bloque de estructura inicial',
 ['Inicializar lista de problemas', 'Exigir documento objeto', 'Recorrer campos REQUIRED y detectar ausentes', 'Validar el tipo de cada campo presente y acumular problemas'],
 [('1→2→E', 'value=null', 'Retorno temprano con problema type en document'), ('1→2→3→4', 'Falta figures.totalWorks', 'Se agrega missing, no se reemplaza por cero'), ('1→2→3→4', 'figures.totalWorks=-1', 'Se agrega problema de tipo'), ('1→2→3→4', 'Todos los campos requeridos presentes y de tipo válido', 'Sin problemas estructurales; continúa validación restante')],
 'Extracto parcial: los caminos terminan en continuación del método, no en reporte aprobado. Más abajo se comprueban consistencia y otras reglas. Narrativa financiera y jobs tienen verificadores propios.')
white(27, SYN+'application/push-overlay.ts', '  async push(', '\n}\n', 'PushOverlay.push',
 ['Recuperar operaciones y ordenarlas por dependencias', 'Por cada operación: si terminal, clasificar sin reenviar', 'Si dependencias no aplicadas, mantener pendiente', 'Guardar sending e invocar propietario con token de la petición', 'Clasificar respuesta, guardar resultado saneado y actualizar estado', 'Devolver resumen con estado persistido'],
 [('1→2→6→S', 'Una operación ya applied', 'Se incluye aplicada sin owner.apply'), ('1→2→3→6→S', 'Operación depende de otra pending', 'Pendiente sin owner.apply'), ('1→2→3→4→5→6→S', 'Propietario devuelve aceptación', 'Estado applied persistido'), ('1→2→3→4→5→6→S', 'Propietario devuelve 401 o 503', 'pending; requiere renovar/reintentar'), ('1→2→3→4→5→6→S', 'Propietario devuelve rechazo/conflicto', 'Estado terminal visible; no se borra operación')],
 'El token no se persiste. classify, validación del overlay, saneamiento e idempotencia del propietario necesitan pruebas propias. Si apply lanza en lugar de devolver resultado, este método no tiene catch local.')
white(28, AG+'report/weekly-deliveries.ts', '  select(subject:', '  pending(subject:', 'WeeklyDeliveryStore.select',
 ['Normalizar período semanal y validar timestamp', 'Leer entregas del sujeto', 'Elegir pendiente más antigua o entrega del mismo período', 'Si existe, devolverla sin crear otra', 'Crear entrega pending con IDs estables y persistir'],
 [('1→E', 'Semana no inicia lunes o now inválido', 'CU28_INVALID_PERIOD o WEEKLY_DELIVERY_INVALID_TIME'), ('1→2→3→4→S', 'Existe entrega pendiente anterior', 'Recupera esa entrega aunque se consulte otra semana'), ('1→2→3→4→S', 'Sin pendientes; mismo período ya registrado', 'Devuelve entrega existente'), ('1→2→3→5→S', 'Sin entrega reutilizable', 'Crea pending con operationId/eventId estables'), ('1→2→3→5→E', 'Fallo de escritura', 'Error; no afirmar entrega realizada')],
 'Unidad de entrega semanal de CU28; los webhooks, otros eventos, credenciales, n8n y receptor se verifican en sus componentes y recorridos reales.')
white(29, 'integration/mcp-server/src/domain/access.ts', 'export function requireScope(', None, 'requireScope',
 ['Recibir actor verificado y scope requerido', 'Comprobar pertenencia del scope', 'Permitir continuación de la consulta'],
 [('1→2→E', 'scopes=[mcp]; requerido mcp:orders:read', 'AccessError insufficient_scope; status 403'), ('1→2→3→S', 'scopes incluye mcp:orders:read', 'Sin excepción; continúa autorización restante'), ('1→2→E', 'scopes=[]', '403 por scope ausente')],
 'Esta función recibe un actor ya verificado. Token, registro de cliente, exchange, descubrimiento y permisos/registro del propietario se prueban aparte; un scope presente no basta para cerrar toda la autorización.')

PROPOSED = {
8: (['Autorizar actor y vehículo', 'Consultar historial al propietario', 'Distinguir vacío real de fallo de fuente', 'Filtrar detalle y emitir accesos privados autorizados', 'Devolver historial sin mutaciones'],
 [('1→E', 'Sin permiso o vehículo fuera de alcance', 'Denegación'), ('1→2→3→S', 'Consulta válida sin servicios', 'Historial vacío explícito'), ('1→2→3→E', 'Fuente indisponible', 'Error, nunca vacío ficticio'), ('1→2→3→4→5→S', 'Historial y referencias disponibles', 'Detalle autorizado sin cambios')]),
18: (['Autorizar registro de entrega', 'Resolver idempotencia y cargar orden', 'Exigir finalización técnica y condición administrativa vigente', 'Validar receptor y evidencia de entrega', 'Persistir entrega, estado y resultado idempotente atómicamente'],
 [('1→E', 'Actor no autorizado', 'Denegación'), ('1→2→S', 'Misma intención ya aplicada', 'Resultado previo'), ('1→2→3→E', 'Orden no finalizada o saldo pendiente sin autorización', 'Entrega rechazada'), ('1→2→3→4→E', 'Receptor no autorizado', 'Entrega rechazada'), ('1→2→3→4→5→S', 'Condiciones satisfechas', 'Una entrega persistida')]),
21: (['Validar autorización, período y filtros', 'Consultar APIs propietarias permitidas', 'Distinguir respuestas, fallos y ausencia real de datos', 'Calcular indicadores con procedencia y disponibilidad', 'Devolver panel sin escribir en las fuentes'],
 [('1→E', 'Período invertido o permiso insuficiente', 'Rechazo'), ('1→2→3→4→5→S', 'Fuentes completas y datos conocidos', 'Indicadores contrastables'), ('1→2→3→4→5→S', 'Una fuente caída', 'Indicadores afectados no disponibles/parciales'), ('1→2→3→4→5→S', 'Fuentes accesibles sin movimientos', 'Vacío real según definición de cada indicador')]),
24: (['Autorizar y validar servicio/variables', 'Comprobar modelo entrenado y evaluado compatible', 'Si no existe, seleccionar referencia del catálogo identificada', 'Si existe, inferir y validar duración/versión/incertidumbre', 'Registrar fuente original y ajuste humano separado'],
 [('1→E', 'Servicio o variables inválidos', 'Rechazo o fallback según contrato por definir'), ('1→2→3→5→S', 'Sin modelo validado; catálogo=60', 'Referencia 60, fuente catálogo, no ML'), ('1→2→4→E', 'Predicción fuera de límites', 'No aceptar una duración inválida'), ('1→2→4→5→S', 'Modelo validado; salida válida; ajuste humano', 'Predicción y ajuste trazables')]),
30: (['Autenticar cliente/usuario y autorizar herramienta/registro', 'Validar argumentos, operationId e intención', 'Exigir confirmación humana cuando corresponda', 'Invocar API propietaria con resultado idempotente', 'Devolver resultado o incertidumbre conciliable y auditar'],
 [('1→E', 'Cliente/usuario sin alcance', 'Denegación'), ('1→2→E', 'Mismo ID con intención distinta', 'Conflicto'), ('1→2→3→E', 'Confirmación requerida ausente', 'Pendiente/rechazado sin invocar mutación'), ('1→2→3→4→5→S', 'Confirmación y reglas satisfechas', 'Único resultado propietario'), ('1→2→3→4→5→S', 'Respuesta perdida', 'Resultado incierto y conciliación, sin éxito inventado')]),
31: (['Autorizar administrador y validar configuración', 'Impedir cliente duplicado y escalamiento de permisos', 'Persistir solicitud y actualizar mecanismo de autorización', 'Distinguir aplicado de pendiente/fallido', 'Registrar auditoría y hacer efectiva suspensión/revocación según vigencia'],
 [('1→E', 'Actor no autorizado o configuración inválida', 'Rechazo'), ('1→2→E', 'Cliente duplicado o alcance excesivo', 'Rechazo sin ampliación de acceso'), ('1→2→3→4→5→S', 'Actualización confirmada', 'Acceso limitado actualizado y auditado'), ('1→2→3→4→S', 'Proveedor no disponible', 'Pendiente/fallido explícito'), ('1→2→3→4→5→S', 'Suspensión/revocación confirmada', 'Nuevas operaciones bloqueadas según vigencia')]),
}

CONTRACTS = {
1:'contracts/auth/README.md; contracts/rest/technical-auth.openapi.yaml',
2:'contracts/rest/security.openapi.yaml', 3:'contracts/rest/employees.openapi.yaml',
4:'contracts/rest/staffing.md', 5:'contracts/rest/agenda.md',
6:'contracts/rest/operations.openapi.yaml',7:'contracts/rest/operations.openapi.yaml',
8:'docs/use-cases/CU08.md (sin contrato completo identificado)',9:'contracts/rest/operations.openapi.yaml',
10:'contracts/rest/operations.openapi.yaml',11:'contracts/rest/operations.openapi.yaml',12:'contracts/rest/operations.openapi.yaml',
13:'contracts/rest/finance.openapi.yaml',14:'contracts/rest/finance.openapi.yaml',15:'contracts/rest/saga.md; contracts/events/cu15.v1.md',
16:'contracts/rest/executions.md',17:'contracts/rest/executions.md',18:'docs/use-cases/CU18.md (sin contrato completo identificado)',
19:'contracts/rest/financial-ledger.md',20:'contracts/rest/financial-ledger.md',21:'docs/use-cases/CU21.md (panel pendiente)',
22:'contracts/ai/local-inspection.md; contracts/ai/vision-model.md',23:'contracts/rest/intelligence.md; contracts/ai/cu23-acceptance-criteria.md',
24:'docs/use-cases/CU24.md (modelo y contrato completos pendientes)',25:'contracts/rest/assistant.md',26:'contracts/graphql/assistant.graphql',
27:'contracts/sync/overlay.md',28:'contracts/rest/automations.md; contracts/events/cu28.v1.md',29:'contracts/mcp/consultation.md',
30:'docs/use-cases/CU30.md (escritura MCP pendiente)',31:'docs/use-cases/CU31.md (gestión administrativa pendiente)'}

def specification(n):
    txt=(ROOT/f'docs/use-cases/CU{n:02}.md').read_text(encoding='utf-8')
    fields={}
    for line in txt.splitlines():
        if line.startswith('| ') and line.count('|') >= 3:
            bits=line.split('|'); fields[bits[1].strip()]=re.sub(r'\*\*','',bits[2].strip())
    return fields

def source_excerpt(w):
    lines=(ROOT/w['path']).read_text(encoding='utf-8').splitlines()
    a=next(i for i,s in enumerate(lines) if w['start'] in s)
    # Find a stop anchor only after the first line; special block terminator is exact.
    if w['stop'] is None:
        b=len(lines)
    else:
        anchor=w['stop'].strip('\n')
        matches=[i for i in range(a+1,len(lines)) if
                 (lines[i] == anchor if anchor.strip()=='}' else anchor in lines[i])]
        if not matches: raise ValueError((w['path'],w['stop']))
        b=matches[0]
    while b>a and not lines[b-1].strip(): b-=1
    return [(i+1,lines[i]) for i in range(a,b)]

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
parts=[]; media={}; relationships=[]
def run(text, bold=False, color=None, font=None, size=None):
    props=('<w:b/>' if bold else '')+(f'<w:color w:val="{color}"/>' if color else '')
    if font: props+=f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/>'
    if size: props+=f'<w:sz w:val="{size}"/>'
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{escape(str(text))}</w:t></w:r>'
def para(text='', style=None, bold=False, color=None, font=None, size=None, keep=False):
    pr=(f'<w:pStyle w:val="{style}"/>' if style else '')+('<w:keepNext/>' if keep else '')
    return f'<w:p><w:pPr>{pr}</w:pPr>{run(text,bold,color,font,size)}</w:p>'
def p(text='',**kw): parts.append(para(text,**kw))
def heading(text,level=1): p(text,style=f'Heading{level}')
def page(): parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
def table(headers, rows, widths=None):
    widths=widths or [int(9638/len(headers))]*len(headers)
    xml='<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>'+''.join(f'<w:{x} w:val="single" w:sz="4" w:color="CBD5E1"/>' for x in ['top','left','bottom','right','insideH','insideV'])+'</w:tblBorders><w:tblCellMar><w:top w:w="85" w:type="dxa"/><w:left w:w="95" w:type="dxa"/><w:bottom w:w="85" w:type="dxa"/><w:right w:w="95" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'+''.join(f'<w:gridCol w:w="{v}"/>' for v in widths)+'</w:tblGrid>'
    for j,row in enumerate([headers]+list(rows)):
        xml+='<w:tr><w:trPr><w:cantSplit/>'+('<w:tblHeader/>' if j==0 else '')+'</w:trPr>'
        for k,cell in enumerate(row):
            fill='17365D' if j==0 else ('F1F5F9' if j%2 else 'FFFFFF')
            xml+=f'<w:tc><w:tcPr><w:tcW w:w="{widths[k]}" w:type="dxa"/><w:shd w:fill="{fill}"/><w:vAlign w:val="top"/></w:tcPr>'
            for line in str(cell).split('\n'):
                xml+=para(line,style='TableText',bold=j==0,color='FFFFFF' if j==0 else None)
            xml+='</w:tc>'
        xml+='</w:tr>'
    parts.append(xml+'</w:tbl>'); p()

def font(size,bold=False):
    for path in ([Path('C:/Windows/Fonts/arialbd.ttf')] if bold else [Path('C:/Windows/Fonts/arial.ttf')]):
        if path.exists(): return ImageFont.truetype(str(path),size)
    return ImageFont.load_default()

def diagram(n,nodes,paths,proposed):
    # Render a readable numbered flow from the exact edges declared in the path table.
    count=len(nodes); width=1500; height=140+count*145
    im=Image.new('RGB',(width,height),'white'); d=ImageDraw.Draw(im)
    edges=set()
    for path,_,_ in paths:
        steps=path.split('→')
        for a,b in zip(steps,steps[1:]): edges.add((a,b))
    boxes={str(i+1):(220,90+i*145,1120,190+i*145) for i in range(count)}
    boxes['S']=(1240,height-125,1460,height-40)
    boxes['E']=(15,height-125,195,height-40)
    def arrow(a,b,fill):
        d.line([a,b],fill=fill,width=4)
        import math
        angle=math.atan2(b[1]-a[1],b[0]-a[0]); length=15
        d.polygon([b,(b[0]-length*math.cos(angle-.45),b[1]-length*math.sin(angle-.45)),(b[0]-length*math.cos(angle+.45),b[1]-length*math.sin(angle+.45))],fill=fill)
    for a,b in sorted(edges):
        if a not in boxes or b not in boxes: continue
        x1,y1,x2,y2=boxes[a]; u1,v1,u2,v2=boxes[b]
        if b in ('S','E'):
            lane=1190 if b=='S' else 205
            start=(x2,(y1+y2)//2) if b=='S' else (x1,(y1+y2)//2)
            target=((u1+u2)//2,v1)
            d.line([start,(lane,start[1]),(lane,v1-20),(target[0],v1-20)],fill='#64748b',width=3)
            arrow((target[0],v1-20),target,'#64748b')
        elif int(b)==int(a)+1: arrow(((x1+x2)//2,y2),((u1+u2)//2,v1),'#2563eb')
        else:
            lane=1160
            d.line([(x2,(y1+y2)//2),(lane,(y1+y2)//2),(lane,(v1+v2)//2)],fill='#2563eb',width=3)
            arrow((lane,(v1+v2)//2),(u2,(v1+v2)//2),'#2563eb')
    for k,(x1,y1,x2,y2) in boxes.items():
        d.rounded_rectangle((x1,y1,x2,y2),radius=15,fill='#eff6ff' if k.isdigit() else '#f1f5f9',outline='#17365d',width=3)
        label=(f'{k}. '+nodes[int(k)-1]) if k.isdigit() else ('S: salida' if k=='S' else 'E: error')
        wrapped=textwrap.wrap(label,width=62 if k.isdigit() else 12)
        y=(y1+y2)//2-len(wrapped)*17
        for s in wrapped:
            d.text(((x1+x2)//2,y),s,font=font(28 if k.isdigit() else 25),fill='#17365d',anchor='mt'); y+=34
    d.text((width//2,25),f'CU{n:02} · Flujo por bloques'+(' · PROPUESTO' if proposed else ''),font=font(30,True),fill='#17365d',anchor='mt')
    buf=io.BytesIO(); im.save(buf,format='PNG'); return buf.getvalue(),width,height

def add_image(data,width,height):
    number=len(media)+1; filename=f'flow{number:02}.png'; rid=f'rIdImage{number}'
    media[filename]=data; relationships.append((rid,'image','media/'+filename))
    cx=5_900_000; cy=int(cx*height/width)
    parts.append(f'''<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{number}" name="Flujo {number}" descr="Diagrama numerado de caminos del caso de uso"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="{filename}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>''')

def pseudocode(n,nodes):
    return '\n'.join(f'{i}. {s}.' for i,s in enumerate(nodes,1))+'\nS. Retornar resultado según el camino.\nE. Informar rechazo/error sin declarar éxito.'

def main():
    assert set(CASES)==set(range(1,32))
    assert set(WHITE)|set(PROPOSED)==set(range(1,32)) and not(set(WHITE)&set(PROPOSED))
    specs={n:specification(n) for n in range(1,32)}
    commit=subprocess.check_output(['git','rev-parse','--short','HEAD'],cwd=ROOT,text=True).strip()
    p('AUTONEXUS AI',style='Title')
    p('Pruebas de caja negra y caja blanca',style='Subtitle')
    p('Cobertura documental de los 31 casos de uso',style='Subtitle')
    p('Capítulo 9 · Diseño de pruebas',bold=True,color='17365D')
    p(DATE)
    p(f'Base de fuentes: {commit}. Versión del documento: 1.0.')
    p('Documento editable de diseño y procedimientos. No constituye una certificación de ejecución o aceptación del software.',bold=True)
    p('Incluye 124 escenarios de caja negra, 31 análisis/diseños de caja blanca y 31 diagramas de flujo por bloques. No contiene campos ni espacios de captura inicial o final.')
    p('Datos de prueba sintéticos; no se incluyen credenciales, información de clientes ni fotografías privadas.')
    page()
    heading('9.1. Planificación y criterio de documentación')
    p('Objetivo: verificar funcionalidad, reglas de negocio y decisiones internas de AutoNexus AI, manteniendo trazabilidad entre los 31 CU, sus contratos, el código disponible y los resultados que se obtengan al ejecutar cada prueba.')
    p('Referencia metodológica: Fase 3 / Capítulo 9: Pruebas, MSc. Ing. José Junior Villagómez Melgar, 23 páginas, especialmente páginas 7–19. Se adapta su estructura de caja negra y caja blanca; los ejemplos de otros sistemas no cambian el alcance de AutoNexus.')
    p('Alcance de negocio: un taller de servicios automotrices, sin inventario ni venta de productos. Roles humanos: administrador, recepcionista, mecánico, jefe de taller y responsable financiero. Keycloak, S3, n8n y clientes MCP participan según el CU.')
    table(['Concepto','Criterio'],[
      ('Caja negra','Se comprueban entradas y comportamientos observables sin depender del código. Cada CU tiene cuatro escenarios y un procedimiento común; cada escenario se ejecuta por separado.'),
      ('Caja blanca existente','Se transcribe una unidad real seleccionada, con números de línea originales, y se diseña su flujo y caminos. Este muestreo no demuestra cobertura completa del código del CU.'),
      ('Caja blanca propuesta','CU08, CU18, CU21, CU24, CU30 y CU31 no tienen implementación completa identificada. Se proporciona pseudocódigo funcional propuesto y caminos previstos; no se atribuye al repositorio.'),
      ('Resultado obtenido','Todos los escenarios nuevos quedan no ejecutados. Las evidencias históricas se mantienen como referencias y no se trasladan como resultados de este documento.'),
      ('Clasificación al ejecutar','Aprobado: evidencia coincide con el esperado. Fallido: difiere. Bloqueado: falta dependencia/implementación. No ejecutado: no se realizó la prueba.'),
      ('Aceptación de rechazos','Una prueba negativa aprueba cuando el sistema rechaza correctamente, conserva el estado y no revela datos fuera del alcance.'),
      ('Diagrama y caminos','Números = bloques de la unidad seleccionada; S = salida/continuación prevista; E = error o rechazo. Las flechas se derivan de la tabla de caminos. Son flujos reducidos, no grafos exhaustivos de todas las instrucciones.'),
      ('Métricas','No se declara cobertura porcentual, complejidad ciclomática medida, precisión de IA ni aprobación global de CU sin ejecutar y medir las verificaciones correspondientes.')], [2250,7388])
    heading('9.1.1. Preparación y registro de ejecución',2)
    for text in [
      'Usar un entorno aislado con datos sintéticos. Registrar commit/build, URL pública del entorno, fecha/hora, plataforma, responsable y versiones del runtime/modelo cuando correspondan.',
      'Preparar identidades de prueba por rol y los servicios requeridos. Primer login, reservas, confirmación y cobro definitivo necesitan conectividad. Para offline, preparar previamente datos y modelos.',
      'Ejecutar cada escenario con datos y operationId propios; usar el mismo operationId solamente cuando se indique replay. Reestablecer precondiciones entre pruebas negativas independientes.',
      'Contrastar respuestas de UI/API con relecturas de las APIs propietarias y comprobantes/logs saneados. No usar consultas a bases de otro microservicio desde la aplicación como parte del flujo de negocio.',
      'Completar resultado obtenido, estado, evidencia y defecto asociado después de ejecutar. El documento evita capturas inicial/final; permite identificar logs, respuestas saneadas y reportes como evidencia.',
      'En pruebas unitarias se pueden aislar dependencias para recorrer condiciones; eso no sustituye la integración real con Keycloak, bases, S3, propietarios, n8n o modelos cuando el escenario la exige.'
    ]: p(text)
    heading('9.1.2. Catálogo y disponibilidad de implementación',2)
    rows=[]
    for n,s in specs.items():
        state='Implementación completa pendiente' if n in PROPOSED else ('Parcial global' if n in (22,23,25,26) else 'Núcleo con aceptación histórica acotada')
        rows.append((f'CU{n:02}',s['Nombre de CU'].split('. ',1)[1],state))
    table(['Código','Caso de uso','Disponibilidad documental'],rows,[900,5550,3188])
    p('Clasificación orientativa tomada de docs/manual/checklist-cumplimiento.md y docs/context/STATUS.md. No equivale a salud actual ni aprobación de todas las variantes funcionales. CU06, CU10 y CU12 incluyen variantes offline todavía no entregadas; CU11, CU22, CU23, CU26 y MCP tienen límites explícitos.')
    page()
    heading('9.2. Diseño de procedimientos')
    table(['Campo','Descripción'],[
      ('Identificador','CN-CUxx-01…04 para caja negra; CB-CUxx para caja blanca y sus caminos.'),
      ('Nombre y descripción','Caso de uso vigente y propósito a comprobar.'),
      ('Actor y precondición','Identidad autorizada, estado inicial y relaciones necesarias.'),
      ('Entrada y condición de ejecución','Datos sintéticos concretos y variante elegida; sin credenciales reales.'),
      ('Pasos','Procedimiento común del CU más la acción específica de cada escenario.'),
      ('Resultado esperado','Comportamiento observable definido antes de ejecutar.'),
      ('Resultado obtenido / estado','Se registran luego de la ejecución; aquí se indica no ejecutado.'),
      ('Caja blanca','Fuente/unidad, código real o propuesta identificada, bloques, diagrama y tabla de caminos/entradas/salidas.')],[2450,7188])
    p('No se incluyen los campos «Captura de imagen inicial» ni «Captura de imagen final», conforme al pedido. Los diagramas de caja blanca son ilustraciones de flujo, no capturas de pantalla de caja negra.')
    page()
    heading('9.3.1. Pruebas de caja negra')
    p('Procedimientos diseñados para los 31 casos de uso. Los cuatro escenarios de cada CU son independientes. El resultado obtenido y el estado se completan tras su ejecución real.')
    for n,s in specs.items():
        page(); heading(f'CN-CU{n:02} · '+s['Nombre de CU'],2)
        table(['Campo','Detalle'],[
          ('Descripción / objetivo',s['Propósito']), ('Actor iniciador',s['Actor iniciador']), ('Precondición',s['Precondición']),
          ('Referencia funcional',f'docs/use-cases/CU{n:02}.md'),('Contrato / alcance',CONTRACTS[n]),
          ('Condición general','Ejecutar con un actor del rol indicado y datos sintéticos. Preparar las dependencias específicas de cada escenario; si no existen, registrar bloqueado, no aprobado.')],[2250,7388])
        heading('Procedimiento común',3)
        flow=re.split(r'(?=\b\d+\.\s)',s['Flujo principal'])
        for step in flow:
            if step.strip(): p(step.strip())
        p('Para cada escenario: preparar sus datos, aplicar la acción indicada y releer el estado por la superficie autorizada. Comparar con el criterio esperado antes de registrar el resultado.',style='Note')
        heading('Escenarios y criterios de aceptación',3)
        for k,(name,data,action,expected) in enumerate(CASES[n],1):
            table(['Campo',f'CN-CU{n:02}-{k:02} · {name}'],[
              ('Entrada / condición',data),('Pasos específicos',action),('Resultado esperado',expected),
              ('Resultado obtenido',PENDING),('Estado / evidencia','No ejecutado. Registrar al ejecutar: fecha, entorno, responsable, referencia de evidencia y defecto si corresponde.')],[2250,7388])
        if n in PROPOSED:
            p('Disponibilidad: este CU no tiene implementación completa identificada. Sus escenarios son diseño de aceptación; al intentar ejecutarlos sin el flujo necesario deben clasificarse bloqueados.',style='Note')
    page(); heading('9.3.2. Pruebas de caja blanca')
    p('Se analizan unidades seleccionadas de los 25 CU con código relacionado disponible y se proponen unidades para los seis CU pendientes. Las tablas indican resultados esperados de los caminos, no ejecuciones realizadas.')
    p('Los números que preceden al código real son líneas originales del archivo. Los números del diagrama son bloques de análisis y se describen en la tabla de bloques. Las llamadas a validadores, repositorios y adaptadores son límites de unidad; sus decisiones internas necesitan análisis adicional.')
    for n,s in specs.items():
        page(); heading(f'CB-CU{n:02} · '+s['Nombre de CU'],2)
        proposed=n in PROPOSED
        if proposed:
            nodes,paths=PROPOSED[n]
            p('DISEÑO PROPUESTO — SIN IMPLEMENTACIÓN COMPLETA IDENTIFICADA',bold=True,color='9A3412')
            p('Fuente funcional: '+f'docs/use-cases/CU{n:02}.md. El siguiente algoritmo es pseudocódigo de diseño, no código existente ni evidencia de ejecución. Debe revisarse contra el contrato y el código cuando se implemente.')
            p('Unidad propuesta: recorrido de aplicación del CU. Criterios: validación, autorización, consistencia, manejo de errores y trazabilidad según las condiciones siguientes.')
            heading('Pseudocódigo funcional propuesto',3)
            for line in pseudocode(n,nodes).splitlines(): p(line,style='Code')
        else:
            w=WHITE[n]; nodes=w['nodes']; paths=w['paths']; excerpt=source_excerpt(w)
            p('ANÁLISIS DE CÓDIGO EXISTENTE — CAMINOS PENDIENTES DE EJECUCIÓN',bold=True,color='17365D')
            table(['Campo','Detalle'],[('Unidad seleccionada',w['function']),('Archivo real',w['path']),
              ('Líneas del extracto',f'{excerpt[0][0]}–{excerpt[-1][0]} en la base {commit}'),('Contrato relacionado',CONTRACTS[n])],[2250,7388])
            heading('Código fuente seleccionado',3)
            p('Transcripción literal del extracto; números de línea agregados para referencia. Las líneas largas se ajustan visualmente sin cambiar su contenido.',style='Note')
            for line_number,line in excerpt:
                p(f'{line_number:04}  {line}',style='Code')
            if w['note']: p(w['note'],style='Note')
        heading('Bloques funcionales y condiciones',3)
        table(['Nodo','Función o condición analizada'],[(str(i),text) for i,text in enumerate(nodes,1)],[900,8738])
        heading('Diagrama de flujo por bloques',3)
        data,wi,hi=diagram(n,nodes,paths,proposed); add_image(data,wi,hi)
        p('Figura CB-CU%02d. Elaboración propia a partir de %s. Las aristas corresponden a los caminos de la tabla; E puede representar excepción, rechazo o dato inválido. S representa la salida descrita y no implica aprobación del CU.'%(n,'la propuesta funcional' if proposed else 'la unidad de código seleccionada'),style='Caption')
        heading('Caminos, entradas y salidas esperadas',3)
        table(['ID / camino','Entrada / condición','Salida esperada'],[(f'CB-CU{n:02}-{i:02}\n{path}',entry,result) for i,(path,entry,result) in enumerate(paths,1)],[2100,3700,3838])
        p(PENDING,style='Note')
        p('Criterio de verificación: instrumentar o depurar la unidad para comprobar el camino y la salida, además del efecto o ausencia de efecto. Los caminos propuestos son una selección; no se declara cobertura completa de decisiones, bucles o combinaciones del caso de uso.')
    page(); heading('9.4. Registro de resultados y cierre')
    p('Este documento entrega el diseño solicitado de caja negra y caja blanca para los 31 CU. No se ejecutaron las 124 pruebas de caja negra ni los caminos de caja blanca durante su elaboración. Las verificaciones automáticas de este archivo comprueban su estructura documental, no el comportamiento empresarial del software.')
    table(['Identificador','Entorno / versión / fecha','Resultado obtenido','Estado / evidencia / defecto'],[
      ('Indicar CN-CUxx-yy o CB-CUxx-yy','Completar al ejecutar','Transcribir respuesta observada y estado persistido','Aprobado / Fallido / Bloqueado / No ejecutado; referencia de evidencia')],[1900,2500,2600,2638])
    heading('Fuentes y límites',2)
    for text in [
      'Guía académica: Fase 3 / Capítulo 9: Pruebas, José Junior Villagómez Melgar, páginas 7–19. La guía ilustra el formato y la técnica, pero no fija una cantidad de escenarios ni una cobertura porcentual mínima.',
      'Requisitos: docs/use-cases/CU01.md a CU31.md; contexto: docs/context/PROJECT.md, STATUS.md y CONTEXT-MAP.md.',
      'Disponibilidad: docs/manual/checklist-cumplimiento.md. Se conserva la diferencia entre núcleo con evidencia histórica, cumplimiento literal y disponibilidad de esta instalación.',
      'Fuentes técnicas: archivos de código y contratos identificados dentro de cada CU. Se seleccionan unidades representativas y se explicitan responsabilidades delegadas.',
      'Las pruebas de vulnerabilidad del apartado 9.3.3 del PDF quedan fuera de este encargo de caja negra y blanca. No se presentan escaneos ni informes de seguridad inexistentes.',
      'CU08, CU18, CU21, CU24, CU30 y CU31 requieren implementación completa antes de reemplazar el diseño propuesto de caja blanca por un análisis de código real. IA y reportes conservan sus límites de alcance y evaluación.',
      'El documento no acredita precisión del modelo, entrenamiento completado, facturación fiscal, pagos parciales, entrega de mensajes externos, herramientas MCP de escritura ni sincronización offline universal.'
    ]: p(text)
    save(commit)

def save(commit):
    styles=f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="{W}">
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/><w:lang w:val="es-BO"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="260" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:before="1600" w:after="300"/></w:pPr><w:rPr><w:b/><w:color w:val="17365D"/><w:sz w:val="60"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:color w:val="475569"/><w:sz w:val="32"/></w:rPr></w:style>
    {''.join(f'<w:style w:type="paragraph" w:styleId="Heading{i}"><w:name w:val="heading {i}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="220" w:after="140"/><w:outlineLvl w:val="{i-1}"/></w:pPr><w:rPr><w:b/><w:color w:val="17365D"/><w:sz w:val="{34-i*3}"/></w:rPr></w:style>' for i in (1,2,3))}
    <w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table text"/><w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Source code"/><w:pPr><w:spacing w:after="0" w:line="205" w:lineRule="auto"/><w:shd w:fill="F1F5F9"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="15"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:rPr><w:i/><w:color w:val="475569"/><w:sz w:val="19"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="475569"/></w:rPr></w:style></w:styles>'''
    sect='<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1134" w:bottom="1000" w:left="1134" w:header="400" w:footer="400"/><w:pgNumType w:start="1"/></w:sectPr>'
    document=f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>{''.join(parts)}{sect}</w:body></w:document>'''
    types='''<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'''
    relns='http://schemas.openxmlformats.org/package/2006/relationships'
    rels=f'<Relationships xmlns="{relns}"><Relationship Id="rIdStyles" Type="{R}/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="{R}/footer" Target="footer1.xml"/>'+''.join(f'<Relationship Id="{rid}" Type="{R}/{kind}" Target="{target}"/>' for rid,kind,target in relationships)+'</Relationships>'
    rootrels=f'<Relationships xmlns="{relns}"><Relationship Id="rId1" Type="{R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'
    core=f'''<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>AutoNexus AI - Pruebas de caja negra y blanca - 31 CU</dc:title><dc:creator>AutoNexus AI</dc:creator><dc:description>Diseño de pruebas. Base {commit}. No acredita ejecución.</dc:description><dc:language>es-BO</dc:language></cp:coreProperties>'''
    footer=f'<w:ftr xmlns:w="{W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>{run("AutoNexus AI · Diseño de pruebas · Página ",size=16)}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>'
    xmlfiles={'[Content_Types].xml':types,'_rels/.rels':rootrels,'word/document.xml':document,'word/styles.xml':styles,'word/_rels/document.xml.rels':rels,'word/footer1.xml':footer,'docProps/core.xml':core}
    for name,value in xmlfiles.items(): ET.fromstring(value)
    OUT.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(OUT,'w',ZIP_DEFLATED) as z:
        for name,value in xmlfiles.items(): z.writestr(name,value.encode('utf-8'))
        for name,value in media.items(): z.writestr('word/media/'+name,value)
    # Document-level validation: IDs, headings, tables, media, relation targets, CRC and OOXML.
    with ZipFile(OUT) as z:
        assert z.testzip() is None
        root=ET.fromstring(z.read('word/document.xml'))
        plain='\n'.join(e.text or '' for e in root.iter('{'+W+'}t'))
        for n in range(1,32):
            assert f'CN-CU{n:02} ·' in plain and f'CB-CU{n:02} ·' in plain
            for k in range(1,5): assert f'CN-CU{n:02}-{k:02}' in plain
        assert len(media)==31
        assert len(list(root.iter('{'+W+'}drawing')))==31
        for rid,kind,target in relationships: assert 'word/'+target in z.namelist()
        assert len(PROPOSED)==6 and len(WHITE)==25
    print(f'Created: {OUT}')
    print(f'Validation PASS: 31 CU; 124 black-box scenarios; {sum(len(w["paths"]) for w in WHITE.values())+sum(len(v[1]) for v in PROPOSED.values())} white-box paths; 25 real excerpts; 6 proposed designs; 31 diagrams; XML/ZIP/relationships valid.')
    print(f'Size: {OUT.stat().st_size:,} bytes. Business tests were not run.')

if __name__=='__main__': main()
