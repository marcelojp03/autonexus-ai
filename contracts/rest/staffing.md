# CU04 — Horarios, disponibilidad y contrato de asignaciones

Contrato del backend propietario de Empleados. La web consume estas operaciones por GraphQL (`contracts/graphql/schedules.graphql`), nunca por REST directo.

## Políticas

Desde CU02 la autorización se resuelve por **permiso** (`contracts/auth/permissions.md`): `schedules:read` para consultas y `schedules:write` para mutaciones. El rol `administrador` posee ambos y `jefe_taller` también; los demás roles iniciales no los tienen.

| Operación | Permiso |
| --- | --- |
| `GET /staffing/employees` | `schedules:read` |
| `GET /staffing/employees/:id/schedule` | `schedules:read` |
| `GET /staffing/employees/:id/availability?date=` | `schedules:read` |
| `POST /staffing/employees/:id/shifts` | `schedules:write` |
| `PUT /staffing/shifts/:shiftId` | `schedules:write` |
| `POST /staffing/shifts/:shiftId/deactivate` | `schedules:write` |
| `POST /staffing/employees/:id/absences` | `schedules:write` |
| `POST /staffing/absences/:absenceId/cancel` | `schedules:write` |
| `/employees*` (CU03) | `employees:read` / `employees:write` (solo el rol administrador los posee) |

`staffingEmployees` devuelve solo `{id, fullName, jobTitle, status}` de empleados activos: el jefe planifica sin acceder a documento, contacto, historial ni cuenta.

## Semántica

- Zona `America/La_Paz`; turnos `HH:mm` locales por día ISO 1–7; sin cruce de medianoche en esta entrega.
- `breakStart`/`breakEnd` deben quedar dentro del turno; turnos del mismo día no se superponen; ausencias no se superponen.
- `acknowledgeConfirmedAssignments: true` aplica un cambio que se superpone con asignaciones confirmadas y lo registra; sin él responde `409 AFFECTS_CONFIRMED_ASSIGNMENT`.
- Mutaciones con `operationId` idempotente; desactivar/cancelar exigen `expectedVersion`, conservan la fila y su auditoría.
- Disponibilidad diaria = turnos del día menos descansos, vacía si hay ausencia; informa asignaciones confirmadas superpuestas.

## Error codes

`VALIDATION_ERROR` (400); `EMPLOYEE_NOT_FOUND`, `SHIFT_NOT_FOUND`, `ABSENCE_NOT_FOUND` (404); `EMPLOYEE_INACTIVE`, `SHIFT_OVERLAP`, `ABSENCE_OVERLAP`, `AFFECTS_CONFIRMED_ASSIGNMENT`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT` (409); `PERSISTENCE_UNAVAILABLE` (503).

## Histórico CU04 — contrato preparado para CU15

**La consulta de disponibilidad es informativa.** Devuelve los tramos libres del día y las asignaciones confirmadas superpuestas, pero no reserva nada: entre la consulta y la confirmación la disponibilidad puede cambiar. La futura operación de reserva/confirmación de CU15 debe revalidar turno, ausencias y asignaciones dentro de la misma transacción de Empleados antes de escribir la asignación, controlando reservas concurrentes.

La tabla `employees.employee_assignments` (`id`, `employee_id`, `starts_at timestamptz`, `ends_at`, `status='confirmed'`, `reference` con la orden de trabajo, `created_at`) es la fuente de conflicto de CU04 y queda como dependencia mínima real.

Al confirmar una reserva, Operaciones deberá:
1. consultar disponibilidad del empleado para el intervalo (`GET /staffing/employees/:id/availability?date=`), y
2. registrar la asignación confirmada de forma atómica en Empleados mediante una operación dedicada con `operationId` idempotente y referencia de la orden.

Esa operación de alta de asignación **no** está implementada en esta entrega: CU04 solo lee la tabla. No se acredita la integración de la Saga ni el alta desde Operaciones.

## Ampliación CU15 implementada

El contrato de reserva/confirmación/liberación y consulta por Saga/operationId está en [saga.md](saga.md). Las APIs propietarias se implementaron con migración 1793455200000; la sección histórica anterior describe el límite de CU04, no la implementación actual. Operaciones usa estas APIs internas, nunca la base de Empleados. Evidencia de aceptación distribuida y límites en STATUS y la especificación CU15: este documento no sustituye esa verificación.

- Estados del recurso: reserved, confirmed y released terminal para la Saga. Reserved/confirmed ocupan el intervalo semiabierto; liberar conserva historial y no afecta a otra Saga.
- Reserva y confirmación revalidan en transacción local empleado activo/habilitado, especialidad declarada, jornada, descansos, ausencias y otras reservas/asignaciones. La disponibilidad previa es solo orientación, no garantía.
- Habilitación aprobada: mechanicEnabled explícito con default false, administrado mediante employees:write y sin roles automáticos; requiredSpecialty de la asignación debe pertenecer a las especialidades registradas. Cargo, cualificación, rol de acceso y permiso siguen separados.
- La proyección CU15 añade especialidades/habilitación/versión sin exponer contactos/documentos. Se distinguen reservas de las asignaciones confirmed de CU04, no se etiqueta reserved como confirmado.
- Los escritores CU03/CU04 relevantes comparten serialización/transacción por empleado con CU15. No pueden invalidar una reserva pendiente usando acknowledgeConfirmedAssignments; la política ya existente para conflictos confirmed se conserva y audita.
- Timeout o GET sin resultado no autorizan liberar una reserva desconocida. Comando, resultado e intención de compensación se reconcilian por IDs estables; released/tombstone impide una confirmación tardía.
- HTTP interno exige cliente técnico y scopes cu15.staffing.read/reserve/confirm/release, no un token del navegador. Cambio + resultado idempotente + auditoría + Outbox pertenecen al commit local.
