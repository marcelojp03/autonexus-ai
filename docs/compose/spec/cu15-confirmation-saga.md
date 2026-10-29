---
feature: cu15-confirmation-saga
status: in-progress
updated: 2026-10-28
source: work/marcelo
---

# CU15 — Confirmar servicio y asignar mecánico mediante Saga

## Report

## [S1] Problem

T21, publicado en 0fc8f7fc3bb8c4ff74f95755e62f87d0db248c5d, permite recepcionar, crear una orden y aprobar su cotización. No reserva ni asigna mecánico ni confirma el servicio. El contrato preparado usa GET de cotización donde se necesita un vínculo financiero durable: no satisface CU15 ni permite compensarlo.

Diseño aprobado por el usuario el 2026-10-28 mediante la consulta de compose-next; implementación en curso, sin verificaciones distribuidas acreditadas todavía. Se reutiliza el worktree existente work/marcelo por instrucción del usuario; no se crea otra rama, worktree o aplicación.

## [S2] Design

### [S2.1] Requisitos y políticas aprobados

Son requisitos del usuario: Operaciones orquesta y persiste; Empleados reserva/revalida atómicamente; Finanzas valida y vincula una versión aprobada; timeouts inciertos no son rechazos; compensaciones inversas durables; identidad técnica acotada sin guardar JWT; Outbox/RabbitMQ e idempotencia; pantallas y verificación real de los fallos enumerados. BFF y n8n no coordinan.

El usuario aprobó explícitamente estas cuatro políticas para cubrir vacíos del modelo actual:

1. Habilitación laboral explícita mechanicEnabled, administrada con employees:write e independiente del rol de seguridad/cargo. Default false para empleados existentes; habilitar requiere al menos una especialidad. CU15 pide una requiredSpecialty seleccionada por jefatura y Empleados comprueba que está registrada. No se inventa una correspondencia automática servicio/categoría→especialidad que hoy no existe.
2. Intervalos de un mismo día civil America/La_Paz, sin cruzar medianoche ni descansos, con inicio futuro al reservar y sin finalizar una asignación cuyo intervalo ya terminó. Se mantienen las reglas temporales de CU04; reservas sin TTL de negocio, no expiran silenciosamente por caída del coordinador. Un lease del worker no es el plazo de una reserva.
3. validUntil es fecha civil inclusiva de La Paz, coherente para CU13/CU14/CU15. Finanzas comprueba vigencia en su transacción de autorización; el vínculo conserva la versión/autorización obtenida entonces para esa Saga. No se reinterpreta el vencimiento posterior de la oferta como cancelación automática del vínculo ni se autoriza una versión distinta al recuperar.
4. Orden no editable/confirmable de nuevo mientras su Saga no sea terminal. No se introduce cancelación manual de servicios ya confirmados. Cambios de empleado/horario no pueden invalidar una reserva CU15 pendiente; se conserva la política CU04 de reconocimiento explícito de conflictos con asignaciones ya confirmadas.

Aprobación registrada: habilitación desde la ficha existente, sin habilitación automática ni roles; explicar inelegibilidad en CU15; recuperar y reintentar pendientes con autorización, sin falso rechazo/confirmación. Continuar T1–T8 sin consultas rutinarias; CU05/offline/Flutter fuera. Cambios sustantivos ajenos al diseño requieren registrar un bloqueo real, avanzando en lo independiente.

### [S2.2] Estados y punto de confirmación

| Propietario/recurso | Estados | Regla |
| --- | --- | --- |
| Operaciones, orden | pending_quote → confirmation_pending → confirmed; rechazo compensado vuelve a pending_quote | Solo el commit local final de CU15 escribe confirmed y referencias de asignación/vínculo |
| Operaciones, Saga | running, recovery_pending, compensating, compensation_pending, confirmed, rejected | rejected exige que no quede efecto propio por compensar ni paso incierto; confirmed exige los dos participantes persistidos |
| Paso durable | pending, dispatched, applied, rejected, uncertain | Dirección forward/compensation separada; comando, huella, intentos, respuesta y próximo intento persistidos |
| Empleados, asignación | reserved → confirmed → released; reserved → released | reserved y confirmed ocupan el intervalo; released es terminal para esa Saga |
| Finanzas, vínculo | active → cancelled | Fija quoteId, quoteVersion y orderId; cancelled es terminal para esa Saga y no modifica cotización/aprobación |

Fases forward: reserve_assignment → authorize_quote → confirm_assignment → confirm_order. La aceptación HTTP202 solo acredita Saga registrada. La orden y la Saga pasan a confirmed juntas, con auditoría y order.confirmed en Outbox, dentro de una única transacción de Operaciones. Un fallo del broker posterior no deshace ese commit: la publicación queda pendiente, sin afirmar que el mecánico ya leyó un aviso.

### [S2.3] Inicio, referencias e idempotencia

POST /orders/:orderId/confirmations requiere operationId y expectedVersion de la orden, quoteId/quoteVersion, employeeId/employeeVersion, requiredSpecialty, startsAt/endsAt con offset. Operaciones deriva el iniciador del token verificado, no del body. Referencias por UUID, no nombre, placa ni descripciones.

Una transacción local bloquea la orden, valida estado/versión, verifica exclusión, crea Saga y comandos de paso con UUID estables y marca confirmation_pending con nueva versión. Misma operación/actor/acción/contenido/versiones produce el mismo sagaId; contenido diferente produce IDEMPOTENCY_CONFLICT. Un índice único por orden incluye todos los estados no terminales, también recuperación y compensación pendiente. Una orden confirmed no admite otra confirmación.

Cada participante tiene un ledger CU15 con operationId único y huella canónica de cliente técnico, iniciador, acción, Saga, destino, versiones y contenido normalizado. El cambio local, resultado idempotente y Outbox se confirman en la misma transacción. También se persisten rechazos de negocio de comandos válidos. Una respuesta de replay describe el resultado histórico del comando; la consulta del recurso describe su estado actual.

Los cuerpos se congelan antes del primer envío. No se cambia expectedVersion reutilizando el mismo identificador. Un conflicto confirmado que requiera un comando nuevo genera y persiste otro ID explícito; nunca se altera el comando anterior ni se pierde su historial.

### [S2.4] Empleados: reserva segura y dependencia de habilitación

Nuevo caso de uso/puerto de asignaciones; transporte, SQL y AMQP permanecen en infraestructura. Se extiende la tabla propietaria employee_assignments o su agregado compatible para incluir sagaId, orderId, versión, estado, operaciones y auditoría, conservando filas CU04 anteriores.

Reserva en transacción local: serialización por empleado compartida con CU03/CU04, versión laboral esperada, activo, mechanicEnabled, especialidad declarada, jornada del día, descanso, ausencias y ausencia de solapamiento con reserved/confirmed. Intervalos semiabiertos [startsAt, endsAt): franjas contiguas no se solapan. Una Saga no puede crear dos asignaciones. Confirmar usa expectedVersion de la reserva y revalida las condiciones vigentes; liberar afecta solo al recurso de esa Saga y conserva su fila/historial.

Se corrige la coordinación local necesaria: hoy CU04 utiliza locks distintos para staffing, shift y absence y sus mutaciones no son una transacción completa. Creación/edición/desactivación de turnos, ausencias y cambios laborales relevantes compartirán el límite de serialización por empleado y transacción con reserva/confirmación. No se puede introducir una ausencia o invalidar la jornada de una Saga pendiente usando acknowledgeConfirmedAssignments: esto incluye una asignación ya confirmed en Empleados cuyo cierre global aún no se haya observado. El Inbox de order.confirmed deja esa marca de cierre junto a la notificación; si el broker demora, se conserva el bloqueo conservador. Tras observar el cierre se mantiene la política de reconocimiento CU04 para cambios de jornada. Desactivar/deshabilitar o retirar la especialidad de un empleado con reserva o asignación CU15 no liberada y aún no terminada se rechaza, sin derivar permisos del puesto laboral.

CU03 conserva contratos anteriores: mechanicEnabled omitido vale false al crear y conserva su valor al editar; se expone/controla de manera explícita en la ficha existente. No se asigna rol Keycloak por habilitarlo. Las proyecciones de CU15 incluyen solo identificador, nombre laboral, especialidades, habilitación y versión, no contactos ni documentos.

Disponibilidad sigue siendo informativa. Mantener la lista confirmed de CU04 y añadir reservas con su estado explícito, sin etiquetar una reserva como asignación confirmada. El backend revalida aunque la pantalla mostrara libre.

### [S2.5] Finanzas: autorización/vínculo durable

Nuevo agregado/tabla propietaria quote_confirmation_links: id, sagaId, orderId, quoteId, quoteVersion, estado, versión, authorizedAt, vigencia evaluada, snapshot de aprobación, iniciador y datos de cancelación. Un único vínculo activo por orden y por versión cotizada; sagaId único. No se añaden escrituras a bases de Operaciones/Empleados.

Autorizar bloquea la cotización y la clave de vínculo dentro de la misma transacción: approved con aprobación registrada, versión exacta, order_reference igual a orderId y vigencia civil. Inserta vínculo active + resultado + auditoría + Outbox. GET /quotes/:id no sustituye este cambio.

Cancelar active→cancelled no borra ni modifica quotes, quote_items o quote_decisions y no exige que siga vigente la oferta. Repetir devuelve el resultado idempotente. Se conserva una marca terminal por Saga que impide reactivar un vínculo cancelado, incluso ante una creación tardía; el mismo principio se aplica a released en Empleados.

Dependencia necesaria CU13/CU14: trasladar validación/relectura y cambios de revisión/aprobación a una transacción con bloqueo/CAS, evitando que una revisión que leyó pending sobrescriba después una aprobación o el estado de una versión vinculada. Alinear calendario La Paz y huellas completas/canónicas, incluido reason en decisiones; regresiones focalizadas, sin reescribir el cálculo financiero ni introducir entidades ORM.

### [S2.6] Incertidumbre, recuperación y compensación

Operaciones tiene worker con claim FOR UPDATE SKIP LOCKED, lease corto, propietario/fencing y nextAttemptAt persistidos. Nunca mantiene una transacción o conexión SQL durante HTTP. Un proceso recuperado observa dispatched como potencialmente aplicado: consulta el ledger por operationId, valida la huella y reintenta exactamente el mismo comando si aún no hay resultado.

Defaults propuestos y configurables: sondeo del worker 1 s, lease 30 s renovado al preparar cada paso, HTTP connect 2 s/read 5 s y reintento exponencial desde 1 s hasta 30 s con jitter de hasta 10 %. El presupuesto de red queda por debajo del lease; el fencing sigue siendo obligatorio aunque el proceso tarde más. La pantalla consulta progreso cada 2 s, sin iniciar otra Saga. No hay máximo de intentos que convierta una incertidumbre en rechazo. La duración de referencia de servicios se presenta como orientación: el intervalo lo autoriza jefatura, sin inventar una estimación ML ni reglas de planificación multijornada.

Timeout, respuesta perdida, 5xx, fallo de token técnico, contención transitoria o GET de operación no encontrada no son un rechazo confirmado. No se compensa por agotar tiempo/intentos ni por vencer el lease. Backoff acotado con jitter y recuperación persistente; la UI muestra recovery_pending o compensation_pending y permite solicitar reintento con versionado sin cambiar el comando. Un error de protocolo/huella queda visible para intervención, sin inventar resolución.

Solo un resultado de negocio rechazado, durable y correspondiente al comando, inicia compensaciones. Orden inverso de los efectos propios efectivamente aplicados:

- Rechazo financiero después de reservar: liberar Empleados.
- Vínculo activo pero asignación aún no confirmada: cancelar vínculo, luego liberar reserva.
- Asignación ya confirmada pero commit local definitivamente rechazado: liberar esa asignación (cubre reserva+confirmación del mismo agregado), luego cancelar vínculo.
- Si el commit local es incierto, consultar primero la base/Saga propia: no compensar una orden que ya quedó confirmed.

Se persisten intención, comando, resultado, próximo intento y estado incierto de cada compensación. Si una falla, la orden conserva exclusión y no se anuncia rejected/limpia hasta completarla. Marcas terminales/tombstones por Saga impiden efectos tardíos, aunque no se usa esa defensa como permiso para compensar resultados desconocidos.

### [S2.7] Identidad técnica y autorización

Permisos humanos propuestos: confirmations:read y confirmations:write, inicialmente administrador y jefe_taller; catálogo propietario Empleados y políticas REST/BFF, sin ampliar CU03 ni permitir a recepción/Finanzas confirmar por aprobar una cotización.

Cliente confidencial separado autonexus-cu15-coordinator, solo client_credentials, sin login interactivo, sin roles realm-management ni permisos humanos de cotizaciones/empleados. Scopes técnicos cerrados cu15.staffing.read/reserve/confirm/release y cu15.finance.read/authorize/cancel. Cada endpoint interno verifica firma/issuer/exp/audiencia propia, cliente autorizado y scope preciso; un JWT del navegador no puede llamar estas mutaciones. El token técnico tampoco puede aprobar/revisar cotizaciones ni modificar CU03.

Credencial en archivo privado backend ignorado, token técnico renovable solo en RAM. Saga/ledger/Outbox/logs no guardan Authorization ni JWT. initiatedBy/authorizedAt se obtienen al aceptar el inicio y se conservan; executedBy registra el cliente técnico. Recuperar continúa una intención ya autorizada, no depende de la sesión posterior ni utiliza al iniciador como una credencial. Reintentar se audita por separado.

### [S2.8] Eventos, Outbox e Inbox

Cada propietario inserta Outbox junto a su cambio local y ledger. Publicación real a RabbitMQ con exchange/colas durables, mensajes persistentes, eventId estable, publisher confirms y mandatory/returned-message handling. Solo ACK del broker sin devolución permite marcar published. Pérdida entre ACK y marcado produce duplicado esperado, no exactamente una entrega.

Consumidores hacen Inbox UNIQUE(eventId) + huella + efecto/proyección local en una transacción y ACK después de commit. Duplicado idéntico se reconoce sin repetir efectos; mismo eventId con cuerpo diferente se aísla como conflicto. Mensajes inválidos se envían a cuarentena/DLQ, sin ejecutar instrucciones provenientes de su texto.

Operaciones consume resultados/notificaciones de participantes para despertar conciliación, nunca para saltar validaciones; Empleados consume order.confirmed para dejar notificación durable de asignación, sin crear otra asignación. No se acredita aún CU05 ni lectura del aviso por un humano. Envelopes y routing keys en contracts/events/cu15.v1.md. RabbitMQ nuevo conserva volúmenes/privados existentes, puertos loopback y credenciales por productor con permisos acotados; versiones compatibles se comprueban/fijan al implementar, no se adivinan en este diseño.

### [S2.9] REST, GraphQL y pantallas

Contratos normativos propuestos en contracts/rest/saga.md; completar OpenAPI financiero ausente y superficie de órdenes/recepciones que falta en el OpenAPI actual. GraphQL amplía órdenes con confirmation_pending/confirmed, referencias y consultas de Saga, sin romper CU11–CU14. El BFF solo valida/delega a Operaciones y compone lecturas autorizadas; no llama participantes para coordinar.

En mf-operations se selecciona orden, cotización aprobada/versionada, mecánico habilitado/especialidad e intervalo; se muestra disponibilidad orientativa. start retorna sagaId/estado consultable. Vista por URL conserva progreso tras recarga; polling se detiene al desmontar/perder sesión/terminar. operationId y comando inmutable temporal pueden conservarse como metadata acotada por usuario en sessionStorage para conciliar una respuesta perdida, nunca tokens, contactos o pruebas de confirmación offline. Se retiran al cerrar sesión o concluir.

No se repite start al hacer polling, doble clic o reload. Estados en curso/recuperación/compensación/rechazo/confirmed explícitos, con pasos y códigos saneados. Solo confirmed devuelve éxito de negocio y referencias definitivas. La aprobación de cotización sigue siendo una decisión financiera, no una confirmación de servicio.

### [S2.10] Verificación y revisión

Primero pruebas focalizadas de dominio, repositorios y HTTP con fallos controlados; después SQL/RabbitMQ/Keycloak reales. Nunca mocks como evidencia final. Matriz obligatoria:

| Escenario | Evidencia requerida |
| --- | --- |
| Éxito desde navegador | orden confirmed, una asignación confirmed, un vínculo active, versiones/Saga y eventos correspondientes |
| Dos solicitudes por misma orden | una Saga activa; replay idéntico o conflicto tipado, sin doble confirmación |
| Dos órdenes por misma franja | como máximo una reserva/asignación ocupante; las otras rechazan de forma durable |
| Rechazo financiero tras reserva | rechazo durable de Finanzas, liberación E comprobada y orden sin confirmar; cotización/aprobación no borradas |
| Respuesta perdida/timeout | proxy de fallo identificado tras commit remoto; consulta/replay mismo ID, un efecto y un evento por cambio |
| Reinicio coordinador | proceso propio detenido/reiniciado con Saga pendiente; mismo paso/IDs, token técnico nuevo sin JWT browser persistido |
| Compensación inicialmente fallida | fallo de red dirigido identificado, compensation_pending persistido, posterior recuperación/release/cancel sin duplicación |
| Outbox y duplicado | publisher confirm/RabbitMQ real, recuperación tras publicación sin marcado, Inbox/efecto único aunque se publique dos veces |

Adicionales: límites de jornada/descanso/ausencia, empleado inactivo/no habilitado/especialidad ajena, vigencia La Paz, carreras revisión/aprobación/vínculo, IDs con otro contenido, versiones obsoletas, JWT humano contra API interna y token técnico contra CRUD. Regresión proporcional de CU02/CU03/CU04, CU11–CU14 y navegación, únicamente por fronteras modificadas. Se identifica qué fallos son inyectados.

Revisión fresca tras terminar verificación; si la infraestructura del revisor falla, aplicar la regla del proyecto: cancelar, revisión directa focalizada y declararla como tal. No atribuir independencia ni marcar completo sin evidencia. Documentar resultados/límites, FF a main y push normal de main/work/marcelo ya autorizados por el usuario, comprobando refs remotas y conservando ambas ramas.

## [S3] Out of Scope

- CU05, Flutter, alcance offline, ejecución física CU16/CU17, cobros/entrega/cancelación o reasignación de un servicio ya confirmado.
- IA visual, fotografías/S3, n8n como coordinador, MCP y rediseño general de interfaces.
- Una transacción ACID distribuida, exactamente-una-entrega de RabbitMQ o un éxito basado solo en HTTP202/availability/quote approved.
- Migrar JDBC/SQL explícito a ORM o consultar una base de otro propietario.

## Tasks

- [x] T1: Aprobar y alinear contratos/decisiones/permisos — acceptance: paso financiero durable, estados, vigencia y habilitación explícitos; aprobación del diseño registrada (covers: S2.1–S2.3, S2.7).
- [x] T2: Participante Empleados y habilitación — acceptance: reserva/confirmación/liberación idempotentes en transacción, concurrencia y jornada/ausencias/estado revalidados, locks compartidos con CU03/CU04 (depends: T1; covers: S2.4).
- [x] T3: Participante Finanzas y dependencias de cotización — acceptance: vínculo durable/versionado, cancelación conservadora, resultados consultables, carreras de aprobación/revisión protegidas y calendario coherente (depends: T1; covers: S2.5).
- [x] T4: Orquestador durable en Operaciones — acceptance: pasos/claims/fencing/recuperación/compensación persistidos; exclusión de orden y commit final atómico; ningún JWT guardado (depends: T1, T2, T3; covers: S2.2, S2.3, S2.6, S2.7).
- [x] T5: Outbox, RabbitMQ e Inbox — acceptance: publicación confirmada y deduplicación real; aviso durable de asignación y recuperación de publicación pendiente (depends: T1; covers: S2.8).
- [x] T6: BFF y pantallas CU15 — acceptance: seleccionar/iniciar/seguir/recargar sin repetir efectos, permisos servidor y no éxito prematuro (depends: T4; covers: S2.9).
- [x] T7: Matriz distribuida real — acceptance: todos los escenarios S2.10 observados con tres bases/servicios y RabbitMQ; inyección y regresiones declaradas (depends: T2, T3, T4, T5, T6; covers: S2.10).
- [ ] T8: Revisión y cierre — acceptance: revisión/documentación/evidencia, STATUS y traspaso; código verificado integrado y refs main/work/marcelo publicadas normalmente (depends: T7; covers: S2.10).

## Journey log

- El primer recorrido real detectó el mapeo incorrecto JDBC del advisory lock. Se reprodujo con regresión rojo/verde y se corrigió a SELECT true AS locked; se reconstruyó/desplegó antes de acreditar navegador.
- La prueba de recuperación debe consultar el motivo del paso incierto, no exigir un rechazo global inexistente. Autenticar en Shell antes del deep-link evitó cancelar assets Angular durante OIDC sin relajar aserciones.
- La ausencia de readiness no prueba que el puerto esté libre: el harness espera TCP ECONNREFUSED antes de relanzar. La corrida final bajo supervisor e hijo detached/windowsHide completó finally/exit0, sin inferir por ello la causa del cierre Windows previo.
- RabbitMQ sufrió una caída no inyectada exit137/OOMKilled=false en una corrida fallida; se recuperó el contenedor propio conservando volumen/privados. distributed-real6 completó 7/7 más ambos estados de navegador sin caída inesperada, y final-check6 verificó restauración directa y flag sintético.
