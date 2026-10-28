# contracts/graphql
Esquema y operaciones de la gestión web.

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