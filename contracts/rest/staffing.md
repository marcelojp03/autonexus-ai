# CU04 — Horarios, disponibilidad y contrato de asignaciones

Contrato del backend propietario de Empleados. La web consume estas operaciones por GraphQL (`contracts/graphql/schedules.graphql`), nunca por REST directo.

## Políticas

| Operación | Roles |
| --- | --- |
| `GET /staffing/employees` | administrador, jefe_taller |
| `GET /staffing/employees/:id/schedule` | administrador, jefe_taller |
| `GET /staffing/employees/:id/availability?date=` | administrador, jefe_taller |
| `POST /staffing/employees/:id/shifts` | administrador, jefe_taller |
| `PUT /staffing/shifts/:shiftId` | administrador, jefe_taller |
| `POST /staffing/shifts/:shiftId/deactivate` | administrador, jefe_taller |
| `POST /staffing/employees/:id/absences` | administrador, jefe_taller |
| `POST /staffing/absences/:absenceId/cancel` | administrador, jefe_taller |
| `/employees*` (CU03) | administrador únicamente |

`staffingEmployees` devuelve solo `{id, fullName, jobTitle, status}` de empleados activos: el jefe planifica sin acceder a documento, contacto, historial ni cuenta.

## Semántica

- Zona `America/La_Paz`; turnos `HH:mm` locales por día ISO 1–7; sin cruce de medianoche en esta entrega.
- `breakStart`/`breakEnd` deben quedar dentro del turno; turnos del mismo día no se superponen; ausencias no se superponen.
- `acknowledgeConfirmedAssignments: true` aplica un cambio que se superpone con asignaciones confirmadas y lo registra; sin él responde `409 AFFECTS_CONFIRMED_ASSIGNMENT`.
- Mutaciones con `operationId` idempotente; desactivar/cancelar exigen `expectedVersion`, conservan la fila y su auditoría.
- Disponibilidad diaria = turnos del día menos descansos, vacía si hay ausencia; informa asignaciones confirmadas superpuestas.

## Error codes

`VALIDATION_ERROR` (400); `EMPLOYEE_NOT_FOUND`, `SHIFT_NOT_FOUND`, `ABSENCE_NOT_FOUND` (404); `EMPLOYEE_INACTIVE`, `SHIFT_OVERLAP`, `ABSENCE_OVERLAP`, `AFFECTS_CONFIRMED_ASSIGNMENT`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT` (409); `PERSISTENCE_UNAVAILABLE` (503).

## Contrato preparado para CU15

La tabla `employees.employee_assignments` (`id`, `employee_id`, `starts_at timestamptz`, `ends_at`, `status='confirmed'`, `reference` con la orden de trabajo, `created_at`) es la fuente de conflicto de CU04 y queda como dependencia mínima real.

Al confirmar una reserva, Operaciones deberá:
1. consultar disponibilidad del empleado para el intervalo (`GET /staffing/employees/:id/availability?date=`), y
2. registrar la asignación confirmada de forma atómica en Empleados mediante una operación dedicada con `operationId` idempotente y referencia de la orden.

Esa operación de alta de asignación **no** está implementada en esta entrega: CU04 solo lee la tabla. No se acredita la integración de la Saga ni el alta desde Operaciones.
