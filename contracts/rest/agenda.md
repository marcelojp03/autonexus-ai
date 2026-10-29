# CU05 — Agenda web online: contrato aprobado

Diseño aprobado en docs/compose/spec/cu05-web-agenda.md. Este contrato no acredita implementación ni aceptación por sí solo. Gestión web mediante GraphQL/BFF; REST de propietarios para composición autorizada. Sin SQL cruzado, nuevas transiciones ni cambios en Saga.

## Permisos e identidad

agenda:read:self y agenda:read:team son permisos cerrados, sin herencia por prefijo. Mecánico=self, jefe=self+team, administrador=ambos según convención, pero todos requieren empleado activo vinculado a su subject actual y rol/asignación de seguridad vigente bajo ese subject. CU05 no aplica la excepción de cuenta de infraestructura sin empleado. Roles personalizados pueden obtenerlos sin guards por nombre.

Empleados resuelve subject desde el JWT verificado, comprueba columna subject y vínculo de identidad vigente y contrasta asignaciones de seguridad actuales; no confía en un employeeId del cliente. Revalidación por petición, sin caché de identidad/permiso CU05. Los guards generales/BFF pueden conservar sus caches previas, pero no sustituyen esta revalidación. No modificar la política de los CU previos ni conceder CRUD general.

Actor = {employeeId:UUID, fullName:string, status:"active", scopes:["self"|"team"]}. Solo mínimo laboral. Un actor inactivo/no vinculado/sin permiso no recibe lista ni detalle. Mecánico deshabilitado para nuevas asignaciones puede conservar consulta histórica si sigue activo/vinculado/autorizado. Equipo abarca el único taller; un jefe activo puede consultar asignaciones históricas de empleados inactivos, señalando su estado.

## Empleados — lecturas humanas mínimas

| Método/ruta | Entrada | Respuesta |
| --- | --- | --- |
| GET /agenda/context | scope=self o team obligatorio, único | {actor, observedAt:ISO UTC} |
| GET /agenda/team/employees | search opcional, status=active/inactive opcional (omitido=ambos), limit/offset | {items:[{id,fullName,status}],total,limit,offset,observedAt} |
| POST /agenda/assignments/check | {scope:"self"|"team", assignmentIds:[UUID]} | {actor, items:[AssignmentCheck], observedAt} |

POST check es lectura, no comando de negocio: sin operationId ni mutaciones. Conjunto de claves cerrado; máximo100 IDs, sin duplicados. Permiso y actor se verifican otra vez; en self solo asignaciones del empleado resuelto. Cualquier ID inexistente/legacy sin Saga o ajeno produce 404 AGENDA_WORK_NOT_FOUND indistinguible, sin respuesta parcial que filtre datos. scope=team sin permiso produce403. Los endpoints técnicos CU15 no se abren al navegador.

AssignmentCheck = {assignmentId,sagaId,orderId,employeeId,fullName,employeeStatus,startsAt,endsAt,status,version,orderConfirmedObserved}. status es estado local reserved/confirmed/released, no prueba global. Solo O lo combina con su Saga/orden y publica AgendaWork; ningún consumidor debe etiquetar reserved o confirmed local pendiente como trabajo global confirmado. No devolver contactos/documentos/cuentas ni modelos completos de empleado.

## Operaciones — agenda propietaria

| Método/ruta | Alcance | Filtros |
| --- | --- | --- |
| GET /agenda/me | agenda:read:self | from,to,status,priority,limit,offset |
| GET /agenda/me/:assignmentId | agenda:read:self + pertenencia | Sin filtros/identidad del cliente |
| GET /agenda/team | agenda:read:team | Anteriores + employeeId opcional |
| GET /agenda/team/:assignmentId | agenda:read:team | Sin sustitución de identidad del actor |

Parámetros desconocidos, duplicados o de tipo inválido se rechazan400. from/to fechas civiles YYYY-MM-DD inclusivas en America/La_Paz, ambos opcionales: omitidos=hoy; uno solo=ese día para ambos. from<=to y máximo31 días inclusivos. Comparación con [inicio de from, inicio de to+1día) por solapamiento semiabierto. status opcional=confirmed, único estado actual admitido; prioridad opcional baja/normal/alta/urgente. limit default20, 1–100; offset default0, 0–2147483647. Orden startsAt, orderId, assignmentId estable.

Resolver contexto E con bearer humano por petición, luego consultar exclusivamente SQL propio: work_orders.status=confirmed, Saga correspondiente status=confirmed, IDs/referencias/versiones/intervalos válidos. No legacy, provisional, rejected, compensación ni released. Verificar estado actual en E y correspondencia exacta de asignación/Saga/orden/empleado/intervalo/versiones antes de responder; no hacer pruning silencioso ni recalcular total excluyendo conflictos. Si falla dependencia/integridad, responder error explícito. Detalle ajeno/inexistente/movido fuera del alcance=404 antes de exponer datos; se revalida en cada lectura.

GET listado = {actor,items:[AgendaWork],total,limit,offset,from,to,timeZone:"America/La_Paz",observedAt}. GET detalle = AgendaWork. Actor usa la forma anterior; no se fabrica identidad desde el filtro.

AgendaWork = {assignmentId,orderId,orderNumber,employee:{id,fullName,status},vehicle:{id,plate,make,model},startsAt,endsAt,priority,status:"confirmed",description,notes:null|string,services:[{serviceId,serviceName,quantity,estimatedMinutes}],orderVersion,assignmentVersion,observedAt,confirmationObservation:"observed"|"pending"}.

DTO distinto de WorkOrder/Employee generales: sin customerId/customerName, documentos/contactos, precios/tarifas/totales, cotización/vínculo, credenciales o cuerpos técnicos. Descripción/notas de orden y snapshots de servicios, no recepción/evidencias privadas. Modelo/marca de vehículo desde persistencia propia O; matrícula asociada a la orden. No HTML de observaciones.

## Consistencia y fallos

El commit O es prueba global; E debe conservar su asignación confirmed actual correspondiente. orderConfirmedObserved=false con prueba global válida significa observación de evento/notificación pendiente: mostrar aviso explícito, no borrar el trabajo ni llamarlo reserva. No acredita lectura humana. observedAt/versiones indican lectura comprobada; no existe transacción distribuida ni promesa de snapshot atómico entre propietarios. No hay proyección de agenda nueva ni watermark inventado.

| Condición | HTTP/código |
| --- | --- |
| Sin token/firma/issuer/audiencia válidos | 401 según contrato propietario |
| Sin permiso/vínculo actual/actividad | 403 AGENDA_ACCESS_DENIED (seguro) |
| ID inexistente/ajeno/no consultable | 404 AGENDA_WORK_NOT_FOUND |
| Entrada desconocida/duplicada/rango inválido | 400 VALIDATION_ERROR |
| No se puede consultar E | 503 AGENDA_DEPENDENCY_UNAVAILABLE |
| Referencias/estado actual no verificables | 503 AGENDA_STATE_UNAVAILABLE |
| Fallo SQL propietario | 503 PERSISTENCE_UNAVAILABLE según contrato existente |
| Consulta válida realmente vacía | 200, items=[] y total=0 |

Nunca convertir503/error/proyección pendiente en una lista vacía exitosa. GraphQL conserva HTTP/envelope actuales: FORBIDDEN/403 en extensions sin datos cuando corresponda. Sin tokens, hosts privados, SQL o excepción upstream en mensajes.

## Consumidores y comprobación

BFF expone myAgenda/myAgendaWork/teamAgenda/teamAgendaWork/agendaTeamEmployees y autoriza por campo; mf-employees consulta solo mediante SessionPort.requestBusiness. Shell comparte sesión, no hace composición empresarial. La pantalla es de lectura, sin acciones de ejecución/fin ni almacenamiento offline.

Aceptación: dos mecánicos con subjects distintos y jefe vinculados activos, CU15 real, aislamiento en lista/detalle y alteración de IDs/filtros por REST/GraphQL, permisos revocados/inactividad/no vínculo, fechas La Paz, recarga/vacío/error/dependencia caída. Contratos CU03/CU04/CU15 no se relajan. No acreditar offline/Flutter ni lectura humana de notificaciones.
