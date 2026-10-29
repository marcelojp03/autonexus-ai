# contracts/graphql
Esquema y operaciones de la gestión web.

## CU15 — contrato ejecutable del BFF

[confirmations.graphql](confirmations.graphql) se registra junto a empleados, horarios, seguridad, operaciones y finanzas. Las cinco queries requieren confirmations:read y las dos mutaciones confirmations:write según permisos efectivos del propietario Empleados, no una inferencia de roles en el BFF. CU03 mantiene employees:write. El catálogo humano tiene 23 permisos; no incluye scopes técnicos.

startServiceConfirmation y retryServiceConfirmation devuelven ConfirmationSaga directamente. Consultar sagaId, status, phase, version, orderVersion, nextAttemptAt, errorCode y steps. Solo status=confirmed acredita éxito; HTTP 202 no lo acredita. Se conservan operationId y expectedVersion del input, sin reintentos automáticos ni coordinación de participantes en el BFF. confirmationByOperation permite recuperar una respuesta perdida con el mismo operationId.

confirmationMechanics es una proyección laboral paginada sin datos personales/contactos; confirmationAvailability devuelve Availability y reservations separadas de assignments, con status y orderConfirmedObserved explícitos. Una reserva no implica confirmación del servicio. El servidor revalida disponibilidad.

Employee.mechanicEnabled es nullable para snapshots CU03 históricos; un valor ausente no habilita al empleado. CreateEmployeeInput y UpdateEmployeeInput aceptan el boolean opcional sin default GraphQL: omitirlo al editar conserva el dato propietario; no se asignan roles ni acceso al habilitarlo. WorkOrderStatus admite confirmation_pending y confirmed; no se publican campos de asignación/cotización en WorkOrder que su DTO todavía no expone. Esos datos se consultan en ConfirmationSaga.

Queries aprobadas para el selector financiero: quotes(orderReference: orderId, status: approved); conservar id y version de la versión seleccionada. La aprobación financiera no confirma por sí sola el servicio.

Verificación BFF: pruebas unitarias y HTTP con upstreams falsos explícitos, no evidencia de integración empresarial real. El archivo HTTP conserva su nombre histórico e2e-spec; no arranca servicios propietarios ni consulta bases.

[employees.graphql](employees.graphql) define SDL **propuesto, no ejecutado** para CU03. No hay BFF/resolvers acreditados. Scalars UUID/Date/DateTime son parte del contrato y requieren implementación/validación servidor. Autorización por operación/campo/registro, mapping REST y errores: [auth/employees.md](../auth/employees.md). Todos los campos y operaciones de empleados requieren administrador; no confiar solo en UI o directivas.

Operaciones propuestas (los nombres de raíz coinciden con el mapping documentado):

```graphql
query ListEmployees($limit: Int = 20, $offset: Int = 0, $status: EmployeeStatus, $search: String) {
  employees(limit: $limit, offset: $offset, status: $status, search: $search) {
    items { id firstName lastName status version access { requested status subject attempts errorCode } }
    total limit offset
  }
}
query GetEmployee($id: UUID!) {
  employee(id: $id) {
    id firstName lastName document email phone jobTitle startDate specialties
    status version createdAt updatedAt access { requested status subject attempts errorCode }
  }
}
query EmployeeHistory($id: UUID!, $limit: Int = 20, $offset: Int = 0) {
  employeeHistory(id: $id, limit: $limit, offset: $offset) {
    items {
      id employeeId operationId action actorSubject occurredAt version
      snapshot { id firstName lastName status version access { requested status subject attempts errorCode } }
    }
    total limit offset
  }
}
mutation CreateEmployee($input: CreateEmployeeInput!) {
  createEmployee(input: $input) { employee { id version access { status errorCode } } replayed }
}
mutation UpdateEmployee($id: UUID!, $input: UpdateEmployeeInput!) {
  updateEmployee(id: $id, input: $input) { employee { id version access { status errorCode } } replayed }
}
mutation DeactivateEmployee($id: UUID!, $input: EmployeeCommandInput!) {
  deactivateEmployee(id: $id, input: $input) { employee { id status version access { status errorCode } } replayed }
}
mutation RetryEmployeeAccess($id: UUID!, $input: EmployeeCommandInput!) {
  retryEmployeeAccess(id: $id, input: $input) { employee { id version access { status errorCode } } replayed }
}
```

La selección GraphQL puede ser parcial; REST devuelve el shape completo. No se permite acceso empresarial web directo a REST como alternativa al BFF pendiente. CU02 y CU03 web no están completados por publicar este contrato.


## Implementación CU03 (2026-10-27)

`integration/bff` ejecuta este SDL con `graphql` 17.0.2 sobre la API REST de Empleados (sin ORM ni SQL). Superficie cerrada a los siete campos raíz; una operación por petición; sin introspección ni fragmentos nombrados; profundidad <=6 y <=120 selecciones.

Todas las operaciones requieren access token del usuario con audiencia `autonexus-employees-api` y rol `administrador`; el BFF reenvía ese mismo token a Empleados. Los errores de negocio se exponen en `errors[].extensions={code,statusCode}` con mensajes saneados. El BFF no crea audiencia propia ni realiza token exchange: eso sigue pendiente de acuerdo.

El microfrontend `mf-employees` consume estas operaciones a través de `SessionPort.requestBusiness` y nunca recibe el token. Contrato de transporte: `contracts/auth/README.md`; decisiones010.

## Implementación CU02 — roles y permisos (2026-10-27)

`security.graphql` extiende el mismo SDL ejecutado por `integration/bff`. Campos raíz y permiso exigido:

| Campo | Permiso |
| --- | --- |
| `securityCatalog` | ninguno (solo token con rol del catálogo) |
| `securityRoles`, `securityRole`, `employeeRoles`, `securityHistory` | `security:read` |
| `createRole`, `updateRole`, `retryRoleSync`, `assignRole`, `revokeRole` | `security:write` |

La política del BFF ya no usa nombres de rol: cada campo raíz declara un permiso y el BFF resuelve los permisos del actor con `GET /security/permissions` reenviando su token (caché 30 s). Si la resolución falla responde `SERVICE_UNAVAILABLE` y no autoriza. El CRUD de empleados sigue exigiendo `employees:write`, que solo posee el rol `administrador`: habilitar CU02 no amplía CU03. Catálogo y semántica: [auth/permissions.md](../auth/permissions.md).

## Implementación Operaciones (2026-10-28)

`operations.graphql` extiende el mismo SDL que ejecuta `integration/bff` (`BusinessGraphql`) para CU06, CU07, CU09 y CU10. Campos raíz y permiso exigido:

| Campo | Permiso |
| --- | --- |
| `customers`, `customer` | `customers:read` |
| `createCustomer`, `updateCustomer`, `deactivateCustomer` | `customers:write` |
| `vehicles`, `vehicle` | `vehicles:read` |
| `createVehicle`, `updateVehicle`, `deactivateVehicle` | `vehicles:write` |
| `services`, `service` | `catalog:read` |
| `createService`, `updateService`, `deactivateService` | `catalog:write` |
| `appointments`, `appointment` | `appointments:read` |
| `createAppointment`, `rescheduleAppointment`, `cancelAppointment` | `appointments:write` |

El BFF reenvía el token del usuario a Operaciones, que vuelve a autorizar resolviendo los permisos contra el catálogo de Empleados. Las citas exponen `customerName`, `vehiclePlate` y `serviceName` resueltos por el servicio propietario: la web no compone llamadas cruzadas.
