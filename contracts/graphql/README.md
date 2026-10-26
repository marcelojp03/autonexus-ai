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

