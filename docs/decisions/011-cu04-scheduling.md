# 011 — CU04: planificación en Empleados y conflicto con asignaciones

Fecha: 2026-10-27. Implementación de CU04 bajo la decisión 009.

## Decisiones

1. **Empleados es propietario de la planificación.** Turnos, ausencias, disponibilidad y la tabla de asignaciones confirmadas viven en su PostgreSQL; Operaciones no consulta esa base.
2. **Zona y representación.** `America/La_Paz`, horas locales `HH:mm` por día ISO y fechas calendario `YYYY-MM-DD`. Sin turnos que crucen medianoche ni recurrencia por rango: es un límite explícito, no una regla simulada.
3. **Conflicto real, no simulado.** La regla de asignaciones confirmadas consulta `employee_assignments`; un cambio que la afecta exige `acknowledgeConfirmedAssignments` y deja auditoría. La dependencia para CU15 se limita a la lectura; el alta de asignaciones no se implementa aquí.
4. **Permisos por operación.** El guard autentica y el BFF decide por campo raíz: `staffing*` admite administrador y jefe de taller; todo lo de CU03 sigue siendo solo administrador. La proyección de personal evita exponer datos personales al jefe.
5. **Reutilización.** Se reutilizan migraciones versionadas, idempotencia por `operationId`, control de versión, auditoría, transporte `SessionPort.requestBusiness`, componentes NG-ALAIN y la corrección de fechas locales de CU03.

## Límites

No hay alta de asignaciones, Saga CU15, agenda CU05, CU02, reasignación, feriados, nómina, offline ni despliegue. El turno de medianoche y la recurrencia avanzada quedan fuera de alcance.
