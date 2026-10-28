# Contrato preparado — CU15: confirmar y asignar servicio (Saga)

No implementado en esta entrega. Define el acuerdo entre Operaciones (orquestador), Empleados (disponibilidad) y Finanzas (cotización) para que la agenda de CU05 muestre trabajos reales.

## Participantes y responsabilidades

| Servicio | Responsabilidad | Estado requerido |
| --- | --- | --- |
| Operaciones | Orquesta la Saga, persiste pasos y resultado; confirma la orden | `work_orders.status = pending_quote` → `confirmed` |
| Empleados | Reserva y confirma la asignación del empleado en su propia base | turno, ausencia y capacidad vigentes |
| Finanzas | Valida y vincula la cotización aprobada a la orden | `quotes.status = approved` y vigente |

## Pasos acordados

1. El jefe de taller solicita confirmar la orden (`operationId` del cliente, `expectedVersion` de la orden).
2. Operaciones verifica que la orden esté `pending_quote` y registra el paso `requested` en su tabla de pasos (idempotente por `operationId`).
3. Operaciones pide a Empleados reservar la franja (`POST /staffing/assignments` a definir): Empleados revalida turno, ausencias y asignaciones concurrentes y responde con `assignmentReference` o un conflicto tipado. Un **timeout no es rechazo**: se consulta por `operationId` antes de compensar.
4. Operaciones pide a Finanzas validar la cotización aprobada (`GET /quotes/:id`): estado `approved`, no vencida y misma orden.
5. Con ambas confirmaciones, Operaciones marca la orden `confirmed` y publica el evento `order.confirmed` (Outbox) para CU05 y CU13.
6. Si un paso falla de forma confirmada, se ejecutan compensaciones idempotentes en orden inverso (liberar asignación, revertir paso) y la orden vuelve a `pending_quote` con el motivo registrado.

## Invariantes

- Cada paso guarda `operationId`, estado, intento y resultado; repetir un paso no duplica efectos.
- La reserva de Empleados y la confirmación de Operaciones son transacciones locales por servicio; la Saga no promete atomicidad distribuida.
- Una cotización aprobada no confirma el servicio por sí sola: solo habilita el paso 5.
- Los conflictos de disponibilidad se presentan al usuario con el código del servicio que los detectó; no se reintentan silenciosamente.
- Los JWT ya emitidos conservan sus roles hasta `exp+5 s`; los permisos se resuelven contra el catálogo en cada petición.
