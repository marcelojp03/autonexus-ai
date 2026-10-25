# 07 — n8n, reportes, seguridad y demostración
Fuente: https://app.notion.com/p/4032585d73c181fead4bf4582545d96d?pvs=204
Copia local exportada el 2026-10-25. Revisar vigencia en Notion antes de cambiar decisiones; estados/relaciones propuestos no son aprobaciones.

## Automatizaciones

| Flujo | Desencadenador | Resultado |
| --- | --- | --- |
| Cita o mantenimiento | Fecha programada. | Recordatorio autorizado. |
| Vehículo listo | Orden finalizada. | Aviso de entrega. |
| Trabajo asignado | Asignación confirmada. | Notificación al mecánico. |
| Cotización pendiente | Plazo sin respuesta. | Seguimiento al responsable. |
| Reporte semanal | Programación periódica. | Resumen de actividad. |

### Automatizaciones de n8n

Se implementarán cinco flujos: recordatorio de cita o mantenimiento, aviso de orden finalizada, notificación de asignación del mecánico, seguimiento de cotizaciones pendientes y resumen semanal. Los eventos provendrán de Operaciones, Empleados o Finanzas; los avisos se demostrarán en un canal de prueba.

Los eventos saldrán de los servicios a través de Outbox y RabbitMQ. Un consumidor invocará el webhook autenticado de n8n, que registrará eventId para evitar avisos duplicados. Los flujos programados consultarán APIs con una identidad técnica de permisos mínimos. Cada ejecución conservará resultado, intentos y error; un aviso fallido no revertirá una reparación ya confirmada.

El flujo semanal solicitará al agente de reportes un resumen. Este consultará APIs internas, los servicios calcularán los totales y el modelo redactará; n8n guardará o enviará el resultado al canal de prueba. El flujo funcionará sin servidor MCP. n8n no duplicará reglas financieras ni escribirá directamente en las bases.

### Reporte pedido por texto o audio

Entrada de ejemplo: «Mostrame órdenes de esta semana, importes cotizados, cobros, gastos y horas por mecánico». El audio se transcribirá online y se mostrará el texto para revisar nombres o fechas dudosos. El agente interno convertirá la solicitud en filtros y llamadas API autorizadas.

El agente convertirá la petición en un período y filtros autorizados, pedirá aclaración cuando no pueda determinar un dato necesario y ejecutará las herramientas admitidas. Los servicios harán los cálculos. El modelo redactará sobre resultados recibidos y no inventará importes ni ejecutará consultas SQL generadas libremente.

La salida combinará explicación, tabla y gráfico cuando aporte información. Mostrará período, filtros, actualización, origen y enlaces a registros autorizados. Indicadores y cálculos provendrán de los servicios; DynamoDB conservará sincronización, no indicadores empresariales. Un reporte descargado podrá releerse offline; generar uno nuevo requerirá conexión.

### Controles asociados a riesgos concretos

SQL y NoSQL: consultas parametrizadas, DTO tipados y filtros permitidos; se rechazarán operadores inesperados. Acceso indebido: verificar rol, acción y registro en APIs, MCP y archivos S3. Se probará que un mecánico no vea una orden ajena a su autorización ni datos financieros restringidos, aunque conozca el identificador.

Web y archivos: codificar salidas para evitar XSS, sanitizar el contenido generado que se visualice, restringir CORS y proteger operaciones con cookies frente a CSRF. Validar tamaño, tipo real y procesamiento de las imágenes. GraphQL tendrá paginación y límites de profundidad, complejidad y frecuencia. Los modelos y recursos de la PWA se servirán desde ubicaciones controladas.

IA y operación: tratar notas, adjuntos y resultados de herramientas como datos no confiables, nunca como instrucciones con más autoridad que la misión. Aplicar lista de herramientas y permisos en el servidor aunque el modelo solicite otra cosa. Mantener secretos fuera de repositorios y clientes y registrar actor, correlationId, operationId, eventId y modelVersion cuando corresponda, evitando exponer datos sensibles en logs.

## Pruebas de seguridad y recuperación

- [ ] Un mecánico no accede a datos financieros ni a órdenes fuera de su autorización.
- [ ] API, GraphQL, MCP y descarga S3 verifican permisos incluso con un identificador conocido.
- [ ] Entradas SQL/NoSQL y filtros inesperados no alteran consultas.
- [ ] Archivos inválidos o excesivos se rechazan antes del análisis.
- [ ] Un contenido malicioso en notas o resultados no amplía herramientas ni permisos del agente.
- [ ] Cliente MCP sin alcance, revocado o con aprobación inválida no ejecuta cambios.
- [ ] Evento repetido no duplica notificación; fallo de n8n no revierte una confirmación.
- [ ] Reporte distingue cotización, cobro y gasto y conserva filtros/origen/fecha.

## Demostración final

Recepción registrará cliente, vehículo, cita y orden. El mecánico inspeccionará desde PWA o Flutter, ejecutará IA local y guardará sin conexión. MS05 coordinará el envío de evidencias a S3 y cambios a sus propietarios sin duplicados. Finanzas elaborará la cotización y el personal registrará la decisión del cliente; el Jefe de taller solicitará confirmar y asignar. CU15 reservará el horario en Empleados, validará y vinculará la cotización en Finanzas y confirmará en Operaciones. Se registrarán avances, verificación, cobro por servicio y entrega. Los agentes internos analizarán operación y finanzas; un cliente MCP externo consultará o solicitará una cita por separado. n8n y un reporte completarán el escenario. La evidencia incluirá sesión única Angular/React; arranque offline de PWA; IA local web/Android; análisis remoto con S3/MongoDB; sincronización mediante DynamoDB; concurrencia de horarios y Saga de tres servicios; métricas ML/DL; agentes con MCP detenido; cliente MCP externo y revocación; n8n; reporte por texto/audio y pruebas de acceso restringido.

