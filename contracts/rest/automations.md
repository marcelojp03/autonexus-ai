# CU28 — activación delegada de avisos programados

Contrato técnico aditivo. n8n usa OAuth2 Code+PKCE de un empleado sintético activo con permisos
de lectura acotados; no hay excepción para service accounts ni acceso a bases ajenas.

| Propietario | Método/ruta | Permiso | Condición vigente |
| --- | --- | --- | --- |
| Operaciones | POST /automations/appointments/reminders | appointments:read | cita scheduled, mañana civil America/La_Paz dentro del horizonte configurado |
| Finanzas | POST /automations/quotes/pending | quotes:read | cotización pending, antigüedad mayor a CU28_PENDING_QUOTE_HOURS (24 por defecto) |

Los clientes envían body vacío/objeto vacío, sin parámetros para forzar fecha, identidad o estado.
Finanzas rechaza queries o cuerpos extra con 400; Operaciones los ignora y no los emplea como
reloj, identidad ni condición de selección. Respuesta 200 `{events:[{eventId,aggregateId,aggregateVersion}]}`: indica
intenciones persistidas, **no entregas confirmadas**. Repetir la activación conserva IDs por
tipo/agregado/versión, aunque cambie la ejecución de n8n.

Empleados amplía su respuesta autenticada GET /security/permissions con `employeeId` UUID|null y
`employeeStatus` active|inactive|null. Son metadatos del propio portador resueltos por Empleados
contra su identidad vigente, no identificadores aportados por el cliente. Los consumidores CU28
requieren `employeeStatus=active`, ID no nulo y permiso efectivo, sin usar la caché general como
sustituto de esa comprobación. Las identidades bootstrap conservan la política CU02 y su contexto
laboral nulo no habilita programaciones.

401: token inválido/vencido. 403: sin permiso/vínculo activo. 503: autorización propietaria no
disponible. Una falla nunca se representa como listado vacío exitoso.

Antes de enviar, cada propietario revalida su registro y versión: `suppressed_at` más código
`CU28_APPOINTMENT_REMINDER_STALE` o `CU28_QUOTE_STALE` registra la obsolescencia sin marcar
entregado. Los eventos/trabajos no guardan tokens. La sesión delegada de n8n guarda su refresh
cifrado en la credencial, tiene vencimiento/revocación y requiere restablecimiento explícito.

El resumen semanal consume POST /report/jobs y GET /report/jobs/{jobId} del agente con el mismo
empleado autorizado. `operationId` es estable por semana lunes–domingo anterior del taller;
se reutiliza el trabajo y sólo se publica el documento cuando succeeded. Conserva `period`,
`provenance`, `claims`, `limitations`, `narrative.path/model/verified/generative`. Programación
semanal es CU28; CU26 no exige ejecutar un temporizador para acreditar generación.

## Entrega semanal durable en el agente (S2.12)

POST /report/weekly/deliveries, body cerrado {from,to}: semana candidata civil lunes–domingo.
Antes de elegir esa semana recupera la entrega pending más antigua del mismo subject. Respuesta
200: {period:{from,to,timeZone},operationId,eventId,jobId,report,status,createdAt,deliveredAt}.
jobId/report pueden ser null inicialmente. status=pending|delivered. El subject interno no se
publica; los IDs UUIDv8 siguen la fórmula acordada por lunes civil. No acepta reloj, identidad,
documento ni ACK aportados en este endpoint.

El cliente crea/consulta el trabajo normal con los IDs devueltos, no con los de la semana que
propuso. Tras succeeded vuelve a adquirir: el agente copia el documento validado desde su propio
trabajo al ledger antes de devolverlo listo para envío. Si existe documento en el ledger, no
depende de la retención del trabajo original ni crea otra generación. Un jobId fijado ausente o
un trabajo failed/interrupted exige intervención, nunca sustitución automática por otro jobId.

POST /report/weekly/deliveries/{operationId}/ack, body cerrado {eventId,status}, donde status es
recorded|duplicate del recibo autenticado por el workflow. Sólo admite el ID propio y documento
listo; entonces marca delivered. Repetir ACK conserva ID y fecha. ID ajeno/inexistente=404;
evento distinto o documento no listo=409; body/período inválido=400; ledger no comprobable=503.
Los errores no borran ni reinician pending. La copia inmutable queda en agent-jobs/weekly-deliveries
sin tokens, con escritura atómica y hash de subject como nombre. Se conserva hasta ACK y como
historial posterior; no se promete retención limitada a los 50 trabajos normales.

Cada acceso, incluidos GET/replay de trabajos y adquisición/ACK semanales, exige vínculo activo,
agenda:read:team y executions:read:team vigentes en Empleados. El documento terminado reautoriza
además cada assignmentId representado en Operaciones, aunque ya no aparezca en la agenda actual.
Una agenda autorizada no concede acceso a los datos de ejecución guardados. No hay refresh en
el agente ni cambio de política de sesión; el bearer permanece sólo en memoria de la llamada.
Una asignación seleccionada puede no tener ejecución todavía: un 404 sólo se admite si sus
métricas guardadas son null, no hay referencia de ejecución y la asignación sigue presente en
la agenda autorizada del período, paginada por el propietario. No se convierte un 403 en ausencia
de datos ni se omite la comprobación del permiso de ejecución. Métricas no nulas exigen acceso
al registro de ejecución; cero y null no son intercambiables.

## Intercalado con cambios de cita

El publicador bloquea cita → Outbox hasta registrar el resultado del POST acotado. Una
cancelación/reprogramación que gana antes suprime el aviso; si el envío ya ganó, la mutación
espera a su transacción. Esas mutaciones toman cita → bloqueo global de slots, con presupuesto
de lectura JDBC temporal CU28_WEBHOOK_TIMEOUT_SECONDS + 5 s (20 s por defecto), restaurado al
salir. No se amplían los dos segundos globales de salud/lecturas. Si el cliente deja de esperar,
debe releer la cita y repetir el mismo operationId; un timeout no acredita rechazo ni permite
inventar una confirmación. Tampoco se promete que un POST externo incierto pueda deshacerse.
