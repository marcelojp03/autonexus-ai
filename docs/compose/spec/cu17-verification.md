---
feature: cu17-verification
status: delivered
updated: 2026-10-31
source: work/marcelo
---

# CU17 — Verificar y finalizar la orden de trabajo

## Report

**What was built** — Verificación técnica de CU17: el mecánico asignado marca el checklist derivado de los ítems de la orden y solicita revisión; la jefatura aprueba o devuelve con motivo. La ejecución recorre `in_progress → pending_verification → completed` y vuelve a `in_progress` al devolverse, con bitácora append-only. La orden permanece `confirmed` durante ejecución y revisión y pasa a `completed` solo al aprobar; la Saga de CU15 no se reabre. Permiso propio `executions:verify`, autoaprobación denegada por identidad y escrituras de CU16 bloqueadas al cerrar. La agenda separa activos (incluye en revisión) de historial (completados), conservando la autorización por registro y el detalle autorizado.

**Verification** — Operaciones 44/44 (incluye regresión de estado en revisión y de historial cerrado); BFF 144/144 y build; build integrado Angular; builds Compose de operations, bff y web con `exit=0` y hash del artefacto servido igual al de la imagen; auditoría real 8/8 (historial expone el trabajo, agenda activa lo excluye, ejecución y orden completadas, checklist completo, una sola aprobación, rastro de revisión); smoke de navegador 7/7 (historial propio del mecánico, cola e historial de jefatura, enlace oculto para el mecánico y sonda cruzada). Regresión focalizada posterior: dos escenarios sintéticos nuevos sembrados con las APIs reales (sin SQL) y recorrido de 19 comprobaciones PASS, incluidas cola de jefatura y detalle mientras el trabajo está en revisión, detalle de trabajo completado y ciclo completo con devolución, corrección, reenvío y aprobación.
## [S1] Problem

CU15 confirma el servicio y CU16 registra ejecución, avances y evidencias, pero nada cierra el trabajo: la ejecución queda `in_progress` indefinidamente y la orden permanece `confirmed` sin un resultado técnico verificable. El jefe de taller no puede revisar lo actuado ni autorizar la finalización, y el mecánico no tiene forma de pedir revisión.

## [S2] Design

### [S2.1] Flujo y estados

El mecánico asignado **solicita revisión** cuando terminó su trabajo; el jefe de taller **aprueba** o **devuelve**.

```
in_progress --(request review, mecánico)--> pending_verification
pending_verification --(approve, jefe)--> completed
pending_verification --(return + motivo, jefe)--> in_progress
```

- La solicitud exige ejecución en `in_progress`, versión esperada e `operationId` idempotente.
- La aprobación exige `pending_verification`; la devolución exige `pending_verification` y motivo obligatorio (3–500 caracteres).
- Una devolución conserva avances, evidencias y checklist; no borra nada y queda en historial.
- Estados no alcanzables en CU17 → `409 EXECUTION_STATE_CONFLICT`.

### [S2.2] Orden, Saga y separación de responsabilidades

- `work_orders.status` permanece `confirmed` durante ejecución y revisión.
- Al aprobar, la orden pasa a `completed` (finalización técnica) en la misma transacción local de la ejecución.
- La Saga de CU15 conserva su resultado histórico: no se reabre ni se reescribe.
- Entrega física y cobro son hechos separados, con su propio registro y estado; no se derivan de la finalización técnica.

### [S2.3] Checklist de actividades obligatorias

- El checklist se deriva de los ítems de servicio ya copiados a la orden (`order_items`), uno por ítem, con su cantidad y descripción.
- Cada ítem tiene realización explícita y trazable: `done` con actor y momento, o `pending`.
- Un avance textual, un porcentaje o una evidencia **no** marcan un ítem como realizado.
- Para solicitar revisión, todos los ítems deben estar `done`.
- El checklist se materializa al iniciar la ejecución (o al migrar) y no se recrea en cada solicitud.

### [S2.4] Requisito mínimo de evidencia

- Al menos **un avance** y **una evidencia `available`** por ejecución para solicitar revisión.
- No se exige una evidencia por avance.
- Evidencias `pending` o `failed` no cuentan como disponibles: la solicitud se rechaza con `409 EVIDENCE_REQUIRED`, sin borrar esos registros ni presentarlos como disponibles.
- Los adjuntos pendientes/fallidos se informan al usuario y permanecen consultables; el reintento sigue el flujo de CU16.

### [S2.5] Autorización

- Permiso nuevo `executions:verify` en el catálogo cerrado, compatible con roles personalizados.
- Roles iniciales: `administrador` y `jefe_taller` lo reciben; `mecanico` no.
- **Autoaprobación prohibida**: un actor no puede aprobar ni devolver una ejecución cuyo empleado asignado sea él mismo, aunque acumule roles o permisos (`403 SELF_VERIFICATION_FORBIDDEN`).
- Jefatura no registra avances ni evidencias en nombre del mecánico; `executions:write` sigue reservado al asignado.
- Lectura de revisión usa `executions:read:team`; el mecánico sigue viendo sólo su trabajo.

### [S2.6] Agenda activa e historial

- La agenda activa incluye ejecuciones `in_progress` y `pending_verification`.
- Los trabajos `completed` dejan de aparecer en la vista activa y pasan a **historial**, con acceso autorizado al detalle.
- El filtro no puede seguir dependiendo sólo de `work_orders.status='confirmed'`: debe considerar el estado de la ejecución para no perder los completados ni duplicar los activos.
- La autorización por registro se mantiene: propio para el mecánico, equipo para jefatura.

### [S2.7] Contratos y errores

- REST del propietario (Operaciones): `POST /executions/:assignmentId/request-review`, `POST /executions/:assignmentId/approve`, `POST /executions/:assignmentId/return`, `GET /executions/history/{me|team}`.
- GraphQL por BFF con permisos por campo raíz.
- Códigos nuevos: `EXECUTION_STATE_CONFLICT`, `SELF_VERIFICATION_FORBIDDEN`, `CHECKLIST_INCOMPLETE`, `EVIDENCE_REQUIRED`, `RETURN_REASON_REQUIRED`.
- Auditoría append-only por solicitud, aprobación y devolución, con actor y motivo.

## [S3] Out of Scope

CU18 entrega física, CU19 cobro, CU20 gastos y CU21 indicadores (bloques posteriores); notificaciones al cliente; IA de inspección; offline; Flutter; finalización automática por porcentaje o contador.

## Tasks

- [x] T1: Operaciones — migración de estados `pending_verification`/`completed`, checklist y orden a `completed` — acceptance: migración aplicada sobre base real y estados persistidos (covers: S2.1, S2.2, S2.3).
- [x] T2: Operaciones — casos de uso y REST de solicitud, aprobación y devolución con idempotencia, versión y auditoría — acceptance: pruebas verdes y API real sobre trabajo ejecutado (depends: T1; covers: S2.1, S2.2, S2.3, S2.4).
- [x] T3: Empleados — permiso `executions:verify`, migración aditiva y roles iniciales; prohibición de autoaprobación resuelta en servidor (depends: T2; covers: S2.5).
- [x] T4: Operaciones — agenda activa e historial separados por estado de ejecución (depends: T2; covers: S2.6).
- [x] T5: BFF GraphQL — SDL, permisos por campo y gateways de verificación (depends: T2, T3; covers: S2.7).
- [x] T6: Web — acciones de solicitud/aprobación/devolución y vista de historial (depends: T5; covers: S2.6, S2.7).
- [x] T7: Verificación real y revisión — recorrido completo con mecánico y jefe, incluida devolución con motivo y autoaprobación denegada (depends: T4, T6).

## Journey log

- Decisiones aprobadas por el usuario el 2026-10-30: flujo mecánico solicita → jefatura aprueba/devuelve; estados exactos; orden a `completed` sólo al aprobar; Saga intacta; checklist por ítems de servicio con realización explícita; una evidencia `available` por ejecución; permiso específico y autoaprobación prohibida; alcance técnico con entrega y cobro separados; agenda con activos e historial.
