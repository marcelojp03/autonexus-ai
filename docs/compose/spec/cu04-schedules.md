---
feature: cu04-schedules
status: delivered
updated: 2026-10-27
source: work/marcelo
---

# CU04 — Horarios y disponibilidad

## Report

## Report

**What was built** — CU04 de punta a punta sobre Empleados: turnos semanales con descanso, ausencias, disponibilidad por día y política por operación para administrador y jefe de taller. Persistencia PostgreSQL propia con migración versionada `1793109000000` (turnos, ausencias, asignaciones confirmadas de solo lectura y auditoría), idempotencia por `operationId`, control de versión, desactivación conservando historial y bloqueo por asignaciones confirmadas con reconocimiento explícito. BFF con extensión del SDL (operaciones `staffingEmployees`, `employeeSchedule`, `employeeAvailability`, `createShift`, `updateShift`, `deactivateShift`, `createAbsence`, `cancelAbsence`) y política por campo raíz: el CRUD de empleados sigue siendo solo administrador. Pantalla NG-ALAIN en `/employees/schedules` con selector de empleado, turnos, ausencias y disponibilidad del día.

**Verification** — API real (11 etapas/exit0): 401/403 por rol, proyección mínima sin datos personales, turno con descanso, solapamiento, validaciones, planificación por jefe, disponibilidad sin descanso, ausencia que bloquea el día, conflicto con asignación confirmada y reconocimiento, desactivación con versión e idempotencia, lectura del horario, auditoría e inactividad rechazada. BFF: 11 unitarias + 11 HTTP PASS con políticas por operación y build exit0. Navegador real (8 etapas/exit0) con jefe de taller: login, selección, alta de turno desde la interfaz, disponibilidad sin el descanso, ausencia que bloquea el día, CU03 aún restringido y consola limpia. Regresión CU03 y smoke CU01 API ejecutados; ver `docs/context/STATUS.md`.

**Review** — Ver registro en `docs/context/STATUS.md` (revisión independiente o, si el servicio de agentes vuelve a fallar, revisión directa focalizada declarada como tal).
## [S1] Problem

El taller no puede planificar el personal: no existen jornadas, turnos, descansos, ausencias ni disponibilidad, y CU15 necesitará reservar disponibilidad real. Sin esta base no se pueden evitar turnos superpuestos ni detectar cambios que afecten asignaciones ya confirmadas.

## [S2] Design

### [S2.1] Modelo y fechas

- Zona horaria del taller: `America/La_Paz` (UTC-4, sin horario de verano). Horas de turno se guardan como `HH:mm` local; fechas como fecha calendario `YYYY-MM-DD`; asignaciones como `timestamptz`.
- Un turno pertenece a un empleado y a un día ISO de semana (1=lunes … 7=domingo), con `startsAt < endsAt` y descanso opcional `breakStart < breakEnd` dentro del turno. No se admiten turnos que crucen medianoche en esta entrega (documentado).
- Ausencia: rango inclusivo `startsOn`–`endsOn` con motivo opcional.
- Disponibilidad de un día: turnos de ese día menos descansos, menos ausencias que lo cubran; se informa también si hay asignación confirmada superpuesta.

### [S2.2] Reglas y conflictos

- Empleado debe existir y estar activo: `EMPLOYEE_INACTIVE` (409) en otro caso.
- Turnos del mismo empleado y día no pueden superponerse: `SHIFT_OVERLAP` (409).
- Descanso fuera del turno, horas inválidas o rangos invertidos: `VALIDATION_ERROR` (400).
- Ausencias del mismo empleado no pueden superponerse: `ABSENCE_OVERLAP` (409).
- Si la operación (turno o ausencia) se superpone con una asignación confirmada, responde `AFFECTS_CONFIRMED_ASSIGNMENT` (409) salvo que la petición incluya `acknowledgeConfirmedAssignments: true`, en cuyo caso aplica el cambio y registra el reconocimiento en auditoría.
- Desactivar un turno exige `expectedVersion`; la fila se conserva con `active=false` (no se borra). Cancelar una ausencia conserva historial.
- Idempotencia por `operationId` con el mismo patrón que CU03: replay devuelve el resultado guardado sin duplicar efectos; otro contenido produce `IDEMPOTENCY_CONFLICT`.

### [S2.3] Dependencia mínima de asignaciones (contrato CU15)

- Tabla propia `employees.employee_assignments` con `id`, `employee_id`, `starts_at`, `ends_at`, `status` (`confirmed`), `reference` (orden de trabajo de Operaciones) y `created_at`. CU04 solo la lee para detectar conflictos; no crea asignaciones.
- Contrato publicado para CU15: al confirmar una reserva, Operaciones pedirá a Empleados verificar disponibilidad y registrar la asignación; esta entrega deja la tabla y la regla de conflicto, no la integración de la Saga.
- La comprobación de conflicto usa la tabla real; no hay simulación ni `[]` como sustituto.

### [S2.4] Políticas y transporte

- API REST: lectura y operaciones de planificación permitidas a `administrador` y `jefe_taller` con políticas explícitas por endpoint en el guard existente. El CRUD de empleados de CU03 sigue siendo solo `administrador`.
- Proyección mínima `GET /staffing/employees` (id, nombre completo, cargo, estado) para que el jefe seleccione personal sin acceder a ficha, documento, contacto ni historial.
- BFF: nuevas operaciones GraphQL con la misma política por campo raíz; no se relajan las operaciones de empleados. El BFF reenvía el token del usuario.
- UI: página de planificación en `mf-employees` bajo `/employees/schedules`, con selector de empleado, turnos por día, alta/edición/desactivación, ausencias, disponibilidad del día y avisos de conflicto con asignaciones confirmadas.

### [S2.5] Errores

`VALIDATION_ERROR` (400), `EMPLOYEE_NOT_FOUND`/`SHIFT_NOT_FOUND`/`ABSENCE_NOT_FOUND` (404), `EMPLOYEE_INACTIVE`, `SHIFT_OVERLAP`, `ABSENCE_OVERLAP`, `AFFECTS_CONFIRMED_ASSIGNMENT`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT` (409), `PERSISTENCE_UNAVAILABLE` (503); 401/403 del guard sin código de negocio.

## [S3] Out of Scope

CU15/Saga y creación de asignaciones desde Empleados, agenda de trabajos (CU05), CU02, reasignación automática, recurrencia avanzada o turnos que cruzan medianoche, feriados, nómina, Flutter/offline y despliegue.

## Tasks

- [x] T1: Migración y dominio de turnos/ausencias — acceptance: PostgreSQL real acepta y rechaza según reglas (covers: S2.1, S2.2)
- [x] T2: REST con políticas administrador/jefe y proyección mínima — acceptance: 401/403/200 reales por rol (covers: S2.4)
- [x] T3: Dependencia de asignaciones y conflicto real — acceptance: una asignación confirmada bloquea o exige reconocimiento (covers: S2.3)
- [x] T4: BFF GraphQL y transporte — acceptance: operaciones CU04 disponibles sin relajar empleados (depends: T2; covers: S2.4)
- [x] T5: Pantalla de planificación y disponibilidad — acceptance: alta/edición/desactivación y ausencias visibles, con conflictos (depends: T4; covers: S2.4)
- [x] T6: Verificación real, revisión y cierre — acceptance: recorrido Angular→GraphQL→REST→PostgreSQL y smoke CU01/CU03 (depends: T5; covers: S2.5)

## Journey log

- Regla mínima de fechas: zona fija `America/La_Paz`, horas locales y sin cruce de medianoche; se documenta como límite en lugar de improvisar recurrencia.
