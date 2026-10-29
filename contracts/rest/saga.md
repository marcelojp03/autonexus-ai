# CU15 — Contrato de confirmación por Saga, revisión 1

Estado: contrato aprobado por el usuario el 2026-10-28 para implementación. Base 0fc8f7f. Requisitos y propuestas completos: docs/compose/spec/cu15-confirmation-saga.md. La corrección del paso financiero durable fue solicitada explícitamente por el usuario: GET /quotes/:id es consulta, nunca autorización/vínculo ni compensación.

## Propiedad y secuencia

| Servicio | Cambio local propio | Confirmación |
| --- | --- | --- |
| Operaciones | Saga, pasos, orden, historial, ledger e Outbox | Orquestador; nunca escribe bases ajenas |
| Empleados | Reserva/asignación versionada, ledger, auditoría e Outbox | Revalida habilitación y disponibilidad en transacción |
| Finanzas | Vínculo versionado de una cotización, ledger, auditoría e Outbox | Valida y registra autorización durable; conserva cotización/aprobación |

Secuencia forward:

1. Inicio autorizado: operación/versión esperada de orden, Saga/comandos estables y confirmation_pending se guardan juntos.
2. Empleados reserva el intervalo y responde con el recurso reserved/versionado.
3. Finanzas autoriza y registra quote_confirmation_link active para quoteId/quoteVersion/orderId/sagaId, en transacción. No basta leer approved.
4. Empleados confirma la misma reserva tras revalidar; responde confirmed/versionado.
5. Operaciones verifica referencias/propiedad/versión y confirma orden + Saga + auditoría + Outbox en una transacción local. Solo aquí hay éxito CU15.

La disponibilidad de pantalla y una cotización aprobada no reservan ni confirman. BFF delega a Operaciones; n8n no decide pasos, commit o compensación.

## Estados

- Orden: pending_quote → confirmation_pending → confirmed. Tras rechazo y compensación completa: pending_quote, nueva versión e historial. Se conservan los estados previos del contrato por compatibilidad, sin atribuirles confirmación CU15.
- Saga: running, recovery_pending, compensating, compensation_pending, confirmed, rejected. Los dos últimos son terminales. No se llega a rejected con comandos inciertos o compensaciones incompletas.
- Paso: pending, dispatched, applied, rejected, uncertain, con dirección forward/compensation e intentos/resultados separados.
- Empleados: reserved y confirmed bloquean [startsAt, endsAt); released es terminal para esa Saga. No se borra la fila.
- Finanzas: active o cancelled. Cancelar no cambia quotes, quote_items ni quote_decisions.

No hay TTL de negocio que libere reservas por falta de respuesta. El lease de ejecución del worker solo permite recuperar trabajo, no prueba que un efecto remoto no exista.

## Entrada pública en Operaciones

| Método/ruta propuesta | Permiso humano | Resultado |
| --- | --- | --- |
| POST /orders/:orderId/confirmations | confirmations:write | 202 con sagaId/estado; replay conserva el mismo sagaId |
| GET /confirmations/:sagaId | confirmations:read | Estado, fases, pasos/resultados saneados, versiones y próxima recuperación |
| GET /confirmations/operations/:operationId | confirmations:read | Saga del inicio para conciliar una respuesta perdida |
| GET /orders/:orderId/confirmations | confirmations:read | Saga actual/historial autorizado de esa orden |
| POST /confirmations/:sagaId/retry | confirmations:write | operationId + expectedVersion de Saga; solicita recuperar la misma intención, no otra confirmación |

Entrada de inicio, conjunto cerrado:

    {
      "operationId": "UUID del cliente",
      "expectedVersion": "entero: versión de la orden",
      "quoteId": "UUID de la versión cotizada",
      "quoteVersion": "entero positivo",
      "employeeId": "UUID del empleado",
      "employeeVersion": "entero positivo",
      "requiredSpecialty": "especialidad registrada elegida por jefatura",
      "startsAt": "ISO-8601 con offset",
      "endsAt": "ISO-8601 con offset"
    }

Los textos entre comillas del ejemplo indican tipos/semántica, no valores válidos de prueba. expectedVersion, quoteVersion y employeeVersion se envían como números. initiatedBy y authorizedAt se obtienen del token/reloj del servidor: el navegador no puede suministrar autoridad ni cambiar el actor persistido.

Mismo operationId con el mismo comando normalizado/actor → mismo resultado/Saga. Contenido, destino o versión distintos → IDEMPOTENCY_CONFLICT. Una exclusión local e índice por orden no terminal evitan dos Sagas activas, incluyendo recuperación/compensación. Otra operación contra orden ocupada → ORDER_CONFIRMATION_IN_PROGRESS; contra confirmed → ORDER_ALREADY_CONFIRMED. Un replay de inicio no convierte 202 en un éxito anticipado: se consulta el estado vigente.

## APIs internas de Empleados

Solo identidad técnica autorizada; no se exponen como mutations directas del navegador.

| Método/ruta propuesta | Scope técnico | Semántica |
| --- | --- | --- |
| POST /internal/cu15/assignments/:sagaId/reserve | cu15.staffing.reserve | expectedVersion=0; crear reserved e idempotencia local |
| POST /internal/cu15/assignments/:sagaId/confirm | cu15.staffing.confirm | expectedVersion de reserva; revalidar y pasar a confirmed |
| POST /internal/cu15/assignments/:sagaId/release | cu15.staffing.release | expectedVersion del recurso; reserved/confirmed→released, solo de esa Saga |
| GET /internal/cu15/assignments/:sagaId | cu15.staffing.read | Estado actual, ID y versión del recurso, incluso released |
| GET /internal/cu15/operations/:operationId | cu15.staffing.read | Resultado durable e inmutable de ese comando |

Reserva: operationId, expectedVersion=0, orderId, employeeId, employeeVersion, requiredSpecialty, startsAt, endsAt e iniciador autorizado transportado por el coordinador. Confirmar/liberar: operationId, expectedVersion del agregado y metadata de auditoría; liberar incluye motivo tipado.

Dentro de una transacción, con exclusión compartida por empleado con CU03/CU04: empleado activo, habilitación mecánica explícita, especialidad registrada, versión laboral al reservar, turno del día que cubra el intervalo, sin descanso/ausencia/superposición con reserved o confirmed. No cruzar medianoche de La Paz. Confirmar vuelve a validar negocio; un contacto actualizado no se confunde con la versión de la reserva.

Modificar jornada/ausencias no puede invalidar una Saga pendiente, incluso si Empleados ya confirmó su paso pero aún no observó order.confirmed. El Inbox deja una marca de cierre junto a la notificación; hasta recibirlo se conserva el bloqueo. Después se mantiene el reconocimiento explícito CU04 para conflictos con jornadas de asignaciones confirmadas. Deshabilitar/desactivar/retirar especialidad no puede invalidar una reserva/asignación CU15 no liberada cuyo intervalo aún no terminó. Las reglas se aplican en todos los escritores relevantes, no solo en el endpoint de reserva.

Un released o su marca terminal por sagaId nunca se reactiva con una creación/confirmación tardía. La liberación puede usar una marca terminal de ausencia con expectedVersion=0 como defensa de protocolo, pero el coordinador no usa un GET404 para justificar compensar un paso incierto.

## APIs internas de Finanzas: vínculo obligatorio

| Método/ruta propuesta | Scope técnico | Semántica |
| --- | --- | --- |
| POST /internal/cu15/quote-links/:sagaId/authorize | cu15.finance.authorize | Crear vínculo durable active; expectedVersion=0 |
| POST /internal/cu15/quote-links/:sagaId/cancel | cu15.finance.cancel | Cancelar solo el vínculo, expectedVersion del recurso |
| GET /internal/cu15/quote-links/:sagaId | cu15.finance.read | Estado actual y versión, incluso cancelled |
| GET /internal/cu15/operations/:operationId | cu15.finance.read | Resultado durable de autorización/cancelación |

Autorizar recibe operationId, expectedVersion=0, quoteId, quoteVersion, orderId y metadata inmutable del iniciador. No recibe precios nuevos ni una decisión de aprobación. En una transacción de Finanzas bloquea/relee cotización y vínculo: approved con aprobación registrada, versión exacta, referencia de la misma orden y vigente. Guarda vínculo + resultado idempotente + auditoría + Outbox. Unicidad active por orden/versión y sagaId único.

Vínculo: id, sagaId, orderId, quoteId, quoteVersion, status, version, authorizedAt, validUntil evaluado y referencia/snapshot de aprobación. No se usan nombre/placa como identidad ni consultas a bases ajenas.

Política temporal aprobada: validUntil es fecha civil inclusiva America/La_Paz en CU13/CU14/CU15; autorizar evalúa esa vigencia al commit financiero. La autorización válida fija la versión para esa Saga, no expira por un timeout ni cambia de cotización al recuperar. Cancelar sigue permitido si luego venció la oferta. No se convierte en cobro, confirmación del servicio o aprobación nueva.

La carrera actual revisión/aprobación debe cerrarse con lecturas/validaciones/escrituras protegidas dentro de transacción, antes de confiar en este vínculo. Una revisión no puede pasar una versión approved a superseded ni cambiar una versión vinculada. Cotización, ítems y aprobación no se borran al compensar.

Cancelar guarda cancelled y evento en transacción. Misma operación/contenido devuelve el mismo resultado; otro contenido/versión con ese operationId se rechaza. Una marca terminal/tombstone por Saga impide que una autorización tardía reactive un vínculo cancelado. Una Saga nueva usa IDs nuevos y conserva la historia anterior.

## Resultados de comandos y rechazo confirmado

Cada propietario guarda operationId, sagaId, acción, huella canónica, outcome=applied|rejected, resultado/snapshot o errorCode público, committedAt y versión correspondiente. Cambio, ledger, auditoría y Outbox pertenecen a la misma transacción local. Un rechazo de negocio de un comando válido también se registra; un error SQL/transporte no se convierte en rechazo de negocio.

- 200/201 con resultado durable applied: efecto confirmado por el propietario.
- Rechazo de negocio con envelope durable rejected e identificadores/huella coincidentes: habilita compensación. No se decide solo por el número HTTP.
- 400 inválido, 401/403 técnico, 5xx, timeout, respuesta sin contrato o conflicto de huella: no acreditan que otro intento no se haya aplicado; recuperación/error visible según el caso.
- GET de operación sin registro: OPERATION_NOT_FOUND/404 significa desconocido en ese instante, no ausencia definitiva de un envío en vuelo. Reintentar exactamente el mismo comando.
- GET de recurso actual y resultado histórico del comando son conceptos distintos. Un replay de autorización antigua puede describir active al commit original aunque el recurso actual ya sea cancelled; nunca debe reactivarlo.

No se cambian el payload, expectedVersion, operationId o Saga para superar a ciegas una respuesta perdida. El coordinador conserva el cuerpo preparado antes del envío y registra toda operación nueva explícita que resulte necesaria tras resolver un conflicto.

Normalización interoperable de requiredSpecialty: antes de congelar cuerpo y huella, Operaciones colapsa exactamente WhiteSpace y LineTerminator de ECMAScript a un espacio ASCII y retira bordes; Empleados aplica la misma normalización. Incluye NBSP U+00A0, FEFF y los separadores de espacio Unicode de ese conjunto; U+0085, U+180E y U+200B no se colapsan. Texto resultante de 1–80 unidades UTF-16, sin C0/DEL. No se aplica case folding ni se cambia la especialidad por otra. Ordenar claves JSON por sí solo no garantiza interoperabilidad entre lenguajes.

Diagnóstico de conciliación: el paso conserva PARTICIPANT_RESULT_UNKNOWN para transporte/resultado no observado, PARTICIPANT_FINGERPRINT_MISMATCH si la huella durable difiere y PARTICIPANT_PROTOCOL_INVALID para un envelope inválido. Los dos últimos requieren intervención visible y siguen siendo inciertos: no son rejected, no autorizan compensación y no cambian el comando congelado. La proyección global muestra el motivo de negocio original si existe; en otro caso muestra el motivo saneado del paso actual. No publica respuesta remota, huella interna, tokens ni excepciones.

## Compensaciones inversas

Primero resolver cualquier paso dispatched/uncertain. Después de rechazo durable:

| Efectos propios conocidos | Compensación |
| --- | --- |
| Reserva E; F rechazó sin vínculo | release E |
| Reserva E y vínculo F; E aún no confirmó | cancel F → release E |
| Asignación E confirmed y vínculo F; commit O rechazado definitivamente | release E (cubre reserva/confirmación) → cancel F |
| Commit local O incierto | consultar Saga/orden propias; si confirmed, no compensar |

Cada compensación tiene ID, comando congelado, expectedVersion, intentos, resultado y próximo intento persistidos. Pendiente/incierta → compensation_pending, no rejected ni orden liberada para otra Saga. Solo al completar vuelve la orden a pending_quote con nueva versión. Nunca cancelar un recurso de otra Saga, borrar cotizaciones/aprobaciones o deshacer trabajo físico/cobros.

## Worker, identidad y eventos

Claims con lease/fencing y transacciones cortas; red fuera de SQL. Tras reinicio se retoman pasos por ID consultable. Continuación con cliente client_credentials autonexus-cu15-coordinator y scopes anteriores; sin JWT navegador persistido. Audiencias propias de Empleados/Finanzas, azp/cliente y scopes verificados en cada API interna, sin roles administrativos de Keycloak. Iniciador humano queda como auditoría de la autorización de inicio, no credencial del worker.

Permisos humanos propuestos confirmations:read/write, inicialmente jefe_taller y administrador. Técnico y humano son rutas/políticas distintas; ni los permisos humanos de cotización ni un rol con nombre parecido amplían los scopes internos.

Outbox local por propietario, publisher confirms y tratamiento mandatory/return antes de marcar publicado; consumidores con Inbox/huella/efecto local atómico y ACK posterior. EventId estable, entrega al menos una vez, duplicados tolerados. Contrato versionado: contracts/events/cu15.v1.md. order.confirmed deja notificación durable en Empleados; no acredita CU05, offline o lectura humana del aviso.

## Aprobación y aceptación

### Formas concretas de intercambio v1

Comandos del envelope: reserve_assignment, confirm_assignment, release_assignment, authorize_quote y cancel_quote_link. Body interno común: operationId, expectedVersion, initiatedBy y authorizedAt. La reserva añade orderId/employeeId/employeeVersion/requiredSpecialty/startsAt/endsAt; autorizar añade orderId/quoteId/quoteVersion; liberar/cancelar añaden reasonCode. sagaId proviene del path. UUIDs normalizados y horas UTC ISO con milisegundos; expectedVersion=0 únicamente para creación/marca terminal sin recurso.

Respuesta de comando/consulta de ledger:

    {
      "operationId": "UUID",
      "sagaId": "UUID",
      "command": "reserve_assignment",
      "fingerprint": "SHA-256 canónico",
      "outcome": "applied o rejected",
      "resource": "snapshot del recurso aplicado o null",
      "errorCode": "null o código de negocio",
      "committedAt": "ISO UTC",
      "replayed": false
    }

resource es un objeto, no el texto del ejemplo. GET de recurso devuelve directamente ese DTO actual. Asignación normal: id/sagaId/orderId/employeeId/requiredSpecialty/startsAt/endsAt/status/version/orderConfirmedObserved. Vínculo normal: id/sagaId/orderId/quoteId/quoteVersion/status/version/authorizedAt/validUntil. Una marca terminal sin recurso incluye sagaId/status/version/tombstone=true y no inventa una asignación/vínculo de negocio. GET de ledger no transforma el snapshot en estado actual. POST replay añade replayed=true sin otro efecto.

Huella: SHA-256 del JSON canónico (objetos con claves ordenadas recursivamente, UTF-8, arrays conservan orden) de clientId, command, sagaId y body validado completo. Ningún token participa. Comandos válidos rejected devuelven HTTP409 con el envelope durable; IDEMPOTENCY_CONFLICT y errores técnicos/validación fuera de ledger usan error estándar, no un envelope rejected ficticio. OPERATION_NOT_FOUND en GET es desconocido, no rechazo.

Proyección humana de mecánicos: GET /staffing/mechanics?search=&limit=&offset= y GET /staffing/mechanics/:id/availability?date=, ambos confirmations:read. Lista paginada con id/fullName/jobTitle/status/version/mechanicEnabled/specialties/eligible/eligibilityReasons; también explica inactivo/no habilitado/sin especialidades sin exponer contactos/documentos. Availability mantiene assignments confirmadas globalmente/legacy y añade reservations para ocupaciones CU15 aún pendientes, con estado de participante y cierre global explícitos.

Outbox SQL propietario: cu15_outbox con id UUID=eventId, event_type, aggregate_type, aggregate_id, aggregate_version, saga_id, causation_id, payload JSON/JSONB (envelope completo), occurred_at, attempts, next_attempt_at, lease_owner, lease_until, published_at y last_error_code. Cada dueño crea su tabla en su propia base/schema; no se comparte modelo ORM. Inbox cuando consume: cu15_inbox con event_id único, fingerprint, received_at y efecto/proyección atómicos.

Configuración de mensajería backend: CU15_BROKER_CLIENT_FILE apunta a JSON privado con host/port/vhost/username/password, nunca URI con credenciales en logs. Coordinador: CU15_IDP_CLIENT_FILE privado. CU15_ENABLED habilita la ejecución CU15 en Operaciones; CU15_MESSAGING_ENABLED los adaptadores de mensajería. Defaults deshabilitados protegen runtime/tests anteriores; la aceptación real exige habilitarlos y comprobar efectos, no acreditar los modos apagados.

Aprobadas explícitamente por el usuario la habilitación laboral, especialidad declarada, calendario/corte de autorización y reserva sin TTL. Los endpoints se acreditarán al implementar y verificar, no por publicar este contrato.

Aceptación real: éxito desde navegador; carrera por orden y franja; rechazo financiero tras reserva con liberación; pérdida de respuesta sin duplicado; reinicio recuperable sin JWT browser; compensación inicialmente fallida que luego completa; Outbox/RabbitMQ y entrega duplicada sin repetir efectos. Fallos inyectados identificados y regresiones proporcionales. Cada servicio mantiene su base: no hay commit distribuido atómico.
