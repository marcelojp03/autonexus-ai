# 016 — CU15: confirmación durable mediante Saga

Fecha: 2026-10-28. Estado: **Aceptada** por el usuario. Rama reutilizada: work/marcelo. Base: 0fc8f7f.

La aceptación corresponde al diseño y a las políticas aprobadas. La matriz real6 posterior está acreditada; regresión proporcional, revisión y cierre siguen pendientes, sin declarar CU15 terminado.

## Contexto y alcance

T21 permite recepción, orden y cotización aprobada, pero aprobar no reserva disponibilidad ni confirma un servicio. Leer GET /quotes/:id tampoco produce una autorización financiera durable que pueda consultarse y compensarse. CU15 necesita coordinar tres propietarios con bases separadas, red falible, reintentos y mensajes duplicados, sin transacción ACID distribuida ni escrituras cruzadas.

Fuente funcional: [CU15 local](../use-cases/CU15.md) y su [fuente Notion](https://app.notion.com/p/4032585d73c1816083b9f38524ab3291?pvs=204). La aprobación del diseño y de las cuatro políticas de usuario está registrada en [la especificación CU15, S2.1](../compose/spec/cu15-confirmation-saga.md). Esta decisión consolida lo aprobado, no abre nuevas políticas.

## Decisión

Operaciones orquesta y persiste la Saga. BFF delega mediante GraphQL; n8n no decide pasos ni compensaciones. La integración interna usa REST autorizado y eventos versionados. Cada servicio controla su dominio, SQL explícito, migraciones y ledger; no se comparten entidades ORM ni se consultan bases ajenas desde las aplicaciones.

Secuencia forward: registrar intención y confirmation_pending en O → reservar E → autorizar/vincular versión aprobada en F → confirmar la misma asignación E → confirmar orden y Saga en O. HTTP202 solo acredita aceptación de la intención. El éxito CU15 existe únicamente cuando el commit local final de Operaciones guarda juntos orden confirmed, Saga confirmed, referencias definitivas, auditoría y Outbox. Una aprobación de cotización, disponibilidad mostrada o confirmed del participante E no sustituyen ese cierre.

### Políticas funcionales aprobadas por el usuario

1. **Habilitación laboral explícita.** mechanicEnabled es independiente de cargo, rol y cuenta Keycloak. Default false para altas sin valor y empleados existentes; una edición que lo omite conserva el valor. Se administra desde la ficha con employees:write; habilitar exige al menos una especialidad, sin asignar identidad ni roles automáticamente. Jefatura selecciona requiredSpecialty y Empleados verifica que esté registrada; no se inventa una correspondencia automática entre servicio/categoría y especialidad. La pantalla explica inelegibilidad.
2. **Día civil de La Paz y reserva sin TTL.** Los intervalos pertenecen a un mismo día America/La_Paz, sin cruzar medianoche ni descansos. Inicio futuro al reservar; no confirmar un intervalo ya terminado. Ocupación semiabierta [startsAt, endsAt): reserved y confirmed bloquean; franjas contiguas no se solapan. La reserva no expira silenciosamente por caída del coordinador: el lease del worker no es un TTL de negocio.
3. **Vigencia inclusiva al autorizar vínculo.** validUntil es fecha civil inclusiva America/La_Paz para CU13/CU14/CU15. Finanzas evalúa vigencia dentro de su transacción de autorización, después de adquirir los locks, junto con aprobación registrada, versión exacta y referencia de orden. El vínculo fija esa versión/autorización para la Saga; el vencimiento posterior no lo cancela ni impide compensarlo. Recuperar no autoriza otra versión.
4. **Exclusión y conservación.** La orden no se edita ni confirma otra vez mientras tenga Saga no terminal, incluso en recuperación/compensación. No se introduce cancelación manual o reasignación de servicios ya confirmados. Los escritores CU03/CU04 no pueden invalidar reservas ni asignaciones de participante cuyo cierre global aún no se haya observado. Tras consumir order.confirmed se conserva la política CU04 de reconocimiento explícito de conflictos con asignaciones globalmente confirmadas; desactivar/deshabilitar o retirar la especialidad requerida de una asignación CU15 no liberada y aún no terminada sigue protegido.

### Atomicidad local, concurrencia e idempotencia

Cada propietario confirma cambio, resultado idempotente aplicado/rechazado de comando válido, auditoría y Outbox en una transacción local. Comandos guardan operationId estable y huella canónica de cliente, acción, Saga y cuerpo completo normalizado; otro contenido con el mismo ID produce IDEMPOTENCY_CONFLICT. El replay devuelve el snapshot histórico del comando; GET del recurso devuelve su estado actual. No se modifica expectedVersion o cuerpo de un comando ya enviado para sortear un conflicto o una respuesta perdida.

Empleados serializa reserva/confirmación y escritores CU03/CU04 por empleado, revalida versión laboral al reservar, actividad, habilitación, especialidad, jornada, ausencias, descansos y solapamiento. Finanzas protege vínculo/cotización/aprobación mediante locks y unicidad de vínculo activo por orden/versión; CU13/CU14 revisan/deciden bajo el mismo límite transaccional necesario. released y cancelled, incluidos tombstones por Saga cuando falta recurso, son terminales y evitan efectos tardíos. Compensar no borra cotización, ítems, aprobación, asignación ni historia.

Operaciones persiste pasos forward/compensation, cuerpos congelados, intentos, resultados y nextAttemptAt. Claims con lease/fencing y transacciones cortas permiten recuperar trabajo; HTTP/AMQP se ejecutan fuera de transacciones SQL. Una orden tiene como máximo una Saga no terminal.

### Identidad técnica sin tokens persistidos

El inicio humano exige confirmations:write y las lecturas confirmations:read, inicialmente administrador/jefe_taller según catálogo propietario. El servidor deriva initiatedBy y authorizedAt de la autenticación/reloj, no del cuerpo del navegador.

La continuación usa el cliente confidencial separado autonexus-cu15-coordinator, solo client_credentials, con audiencias E/F y scopes cerrados cu15.staffing.read/reserve/confirm/release y cu15.finance.read/authorize/cancel. Cada API interna valida firma, issuer, expiración, audiencia propia, cliente y scope exacto. Un JWT humano no autoriza estas mutaciones; el token técnico no permite CRUD humano, revisión/aprobación financiera ni administración de Keycloak.

Credenciales en archivos privados ignorados y tokens renovables solo en RAM. Saga, pasos, ledger, auditoría, Outbox y logs no guardan JWT ni Authorization. initiatedBy/authorizedAt conservan la autorización de la intención original; executedBy identifica al cliente técnico. Recuperar no depende de la sesión humana posterior ni convierte el subject auditado en credencial. Solicitar retry requiere autorización y auditoría propias.

### Incertidumbre y compensaciones

Timeout, respuesta perdida, 5xx, fallo de token, contención o GET OPERATION_NOT_FOUND no equivalen a rechazo confirmado. Un dispatched recuperado puede haberse aplicado: consultar ledger, validar IDs/huella y reintentar exactamente el mismo comando. No hay máximo de intentos ni vencimiento del lease que transforme incertidumbre en rechazo o libere la orden. La UI muestra recovery_pending/compensation_pending y progreso recuperable por Saga, nunca éxito offline.

Solo rechazo de negocio durable y correspondiente al comando permite compensar efectos propios conocidos, después de resolver pasos inciertos:

| Situación conocida | Compensación |
| --- | --- |
| E reservó y F rechazó sin vínculo | release E |
| F vinculó, E todavía no confirmó | cancel F → release E |
| E confirmó y el commit O fue definitivamente rechazado | release E → cancel F |
| Commit local O incierto | consultar Saga/orden propias; no compensar si ya confirmed |

Cada compensación conserva ID, comando, versión, intentos y resultado durables. Una compensación fallida/incierta mantiene exclusión y compensation_pending. Solo al terminar sin efectos pendientes la Saga queda rejected y la orden vuelve a pending_quote con nueva versión. No se deshace un recurso ajeno, trabajo físico o cobros.

### Outbox e Inbox

Cada propietario publica su Outbox en RabbitMQ con eventId estable, mensajes persistentes, topología durable provisionada, publisher confirms y mandatory/return. Solo ACK sin devolución permite marcar publicado; perder la confirmación SQL posterior admite retransmisión del mismo evento. Se promete entrega al menos una vez, no exactamente una.

Los consumidores de Operaciones y Empleados guardan Inbox único por eventId, huella y efecto/proyección en una transacción, con ACK después del commit. Duplicado idéntico no repite efectos; conflicto/entrada inválida se aísla en DLQ. Finanzas no añade Inbox sin consumo. Eventos de participantes despiertan conciliación, no sustituyen validaciones. order.confirmed deja notificación durable y marca de cierre en E sin crear otra asignación; no acredita CU05 ni lectura humana.

## Consecuencias

- Se conserva consistencia local y aislamiento de propietarios a costa de consistencia eventual, estados pendientes visibles y almacenamiento durable adicional. Una caída puede conservar ocupación hasta reconciliar: no se libera capacidad suponiendo que el timeout anuló el efecto.
- Se requieren migraciones propias E1793455200000, F2026_10_28_000002 y O V7, identidad técnica, broker/topología y adaptadores habilitados explícitamente. Aprobar esta decisión no sustituye su despliegue ni su verificación.
- CU03 y CU04 comparten serialización con asignaciones; CU13/CU14 protegen revisión/aprobación/vínculo y calendario. Estos cambios son dependencias de CU15, no nuevas capacidades de nómina, CU05, cobros o cancelación de servicio.
- La web usa BFF GraphQL para iniciar/consultar/reintentar; no coordina participantes. Solo metadata acotada de operación puede conservarse para conciliar, nunca tokens ni confirmaciones offline.
- La aceptación exige los escenarios reales de la especificación S2.10: navegador, carreras, rechazo, respuesta perdida, reinicio, compensación inicialmente fallida y Outbox/duplicados. Las pruebas con dobles no sustituyen esa matriz.

## CU, contratos y evidencia

- [CU15](../use-cases/CU15.md), con dependencias CU02/CU03/CU04 y CU11–CU14. CU05, CU16/CU17, Flutter, offline, cobros/entrega, IA, MCP y n8n como coordinador quedan fuera.
- [REST Saga](../../contracts/rest/saga.md), [Empleados](../../contracts/rest/employees.openapi.yaml), [planificación CU04](../../contracts/rest/staffing.md), [Operaciones](../../contracts/rest/operations.openapi.yaml) y [Finanzas](../../contracts/rest/finance.openapi.yaml).
- [GraphQL CU15](../../contracts/graphql/confirmations.graphql), [eventos CU15 v1](../../contracts/events/cu15.v1.md) y [permisos](../../contracts/auth/permissions.md).
- [STATUS](../context/STATUS.md) y [especificación CU15](../compose/spec/cu15-confirmation-saga.md) son los puntos de evidencia final, revisión y cierre. Los README de los tres servicios y [scripts/cu15](../../scripts/cu15/README.md) separan pruebas iniciales delegadas de verificación principal posterior.

Al consolidar esta decisión existen seis etapas reales de navegador (output/cu15/browser-real.json, browser-real3.exit=0), seis financieras (finance-real.json, finance-real2.exit=0), migraciones aplicadas y corrección JDBC lockOperation con regresión red/green y package posterior. Las corridas parciales matrix1/matrix3 acreditan sus primeras tres etapas, no el cierre de matriz; matrix3 también sufrió caída espontánea RabbitMQ exit137, OOMKilled=false, no inyectada, recuperada por el principal. La matriz posterior real6 quedó acreditada: output/cu15/distributed-real6.exit=0 y distributed-2026-10-29T00-21-30-311Z-0749409d.json PASS7/7. Cubre carreras por orden/franja, rechazo F con release E, respuesta perdida tras commit F sin compensar el éxito, reinicio del coordinador con IDs/cuerpos durables e identidad técnica, compensación inicialmente pendiente que termina cancel F→release E y retransmisión del mismo eventId con un Inbox/notificación. Ambos browser-proof (recovery_pending y compensation_pending) terminaron PASS con issues=[] y failed=[]. final-check6.json registra restauración DIRECT, readiness200 y flag sintético restaurado. La última corrida no tuvo caídas inesperadas. Esto no convierte las corridas fallidas anteriores en PASS. Regresión proporcional, revisión y cierre permanecen pendientes; no se declara CU15 completo ni revisión independiente.
