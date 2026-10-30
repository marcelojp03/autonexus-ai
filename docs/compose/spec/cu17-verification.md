---
feature: cu17-verification
status: draft-for-approval
updated: 2026-10-30
source: work/marcelo
---

# CU17 — Verificar y finalizar la orden de trabajo

## [S1] Estado de partida real

CU15 deja la orden `confirmed` con Saga confirmada, asignación y empleado. CU16 añade, en la misma base de Operaciones, la ejecución `in_progress` con avances append-only y evidencias `pending|available|failed` verificadas contra S3 real. CU17 es lo que hoy **no** existe: no hay endpoint de finalización, ni transición terminal, ni estado `pending_verification`, y ningún contador o porcentaje de avances cambia el estado de la orden.

Precondición del caso de uso: existe una orden en ejecución y el mecánico registró las actividades requeridas. Eso hoy se satisface con `work_executions.status='in_progress'` y al menos un avance.

## [S2] Decisiones que requieren aprobación antes de implementar

1. **Alcance del cierre**: CU17 decide sobre ejecución y orden, pero la confirmación de CU15 no se reabre. Se propone que la orden pase de `confirmed` a un estado técnico propio (`completed` o `pending_verification` seguido de `finished`) sin tocar la Saga.
2. **Quién decide**: el jefe de taller verifica y autoriza; el mecánico sólo consulta su propio trabajo. Se reutilizan `executions:read:team` para lectura y se necesita un permiso nuevo de escritura de verificación (p. ej. `executions:verify`), porque `executions:write` está reservado al mecánico asignado y no debe permitir que jefatura escriba avances.
3. **Rechazo**: si la revisión es negativa, la ejecución vuelve a un estado corregible y la orden permanece en ejecución. Se propone `verification_rejected` con motivo obligatorio y auditoría, sin borrar avances ni evidencias.
4. **Actividades obligatorias**: el flujo pide comprobar que no existan actividades obligatorias pendientes. Falta definir si "obligatoria" es un atributo del servicio del catálogo (CU09) o una regla del cierre. **Bloquea la implementación** hasta acordarlo.
5. **Estados posteriores** (`pendiente de entrega`, `pendiente de cobro`) tocan Finanzas y entrega física; se propone que CU17 sólo marque la finalización técnica y emita el evento, dejando entrega y cobro fuera.
6. **Evidencia insuficiente**: definir mínimo exigible por cierre (¿al menos una evidencia `available`, o una por avance?). Sin esta regla no puede implementarse la validación.

## [S3] Invariantes propuestos

- Sólo el jefe de taller (permiso de verificación) finaliza; el mecánico asignado nunca se autoaprueba.
- La finalización exige ejecución `in_progress`, versión esperada y `operationId` idempotente.
- No se finaliza si hay evidencias `pending` o `failed` cuando la regla acordada las considere obligatorias.
- Rechazar exige motivo y deja auditoría; no elimina avances, evidencias ni objetos en S3.
- Un conflicto de versión responde `409`, nunca finaliza dos veces ni cambia silenciosamente el resultado.
- La orden y la ejecución se actualizan en una transacción local con auditoría; el evento posterior se publica por Outbox como en CU15.

## [S4] Fuera de alcance

Cobros y facturación, entrega física del vehículo, notificaciones al cliente, IA de inspección, offline/Flutter y cualquier finalización automática por porcentaje o contador.

## Tasks (borrador, no iniciar)

- [ ] T1: Acordar S2.1–S2.6 (estados, permiso, actividades obligatorias y mínimo de evidencia).
- [ ] T2: Contratos REST/GraphQL de verificación, rechazo y finalización, con códigos y DTO mínimos.
- [ ] T3: Empleados: permiso de verificación en el catálogo y sus roles iniciales.
- [ ] T4: Operaciones: transición, idempotencia, auditoría, Outbox y pruebas.
- [ ] T5: BFF y UI de verificación para jefatura, incluida la devolución al mecánico.
- [ ] T6: Verificación real con orden del escenario sintético y estado de S3 declarado con exactitud.

## Pendiente visual heredado

CU05 mantiene su G2 visual abierto; no se acredita conformidad visual y no debe declararse cerrado por este trabajo.
