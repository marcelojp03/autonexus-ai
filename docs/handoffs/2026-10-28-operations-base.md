# Traspaso 2026-10-28 — bloque operativo entregado; siguiente dependencia de CU15

Traspaso anterior: [CU02](2026-10-27-cu02-security.md).

- **Fecha y responsable/bloque:** 2026-10-28. Marcelo (bloque 1), con alcance autorizado sobre dependencias de otros participantes.
- **Rama y commit:** `work/marcelo`, commit del bloque operativo; integrado en `main` por fast-forward y publicado junto con `work/marcelo`.
- **CU y objetivo:** CU06 clientes, CU07 vehículos, CU09 catálogo de servicios y CU10 citas, de punta a punta en Operaciones → BFF GraphQL → `mf-operations`, con PostgreSQL y autenticación reales.
- **Archivos cambiados:**
  - `services/employees`: catálogo de catorce permisos (`domain/permissions.ts`) y migración `1793282400000-extend-permissions-catalog`.
  - `services/operations`: migraciones Flyway `V2`–`V4`, dominio (`customer`, `vehicle`, `service-offering`, `appointment`, `validation`, `operations-error`), casos de uso, repositorios JDBC, controladores REST, `EmployeePermissionsClient`, `PermissionAuthorities`, `SecurityConfiguration`, `application.properties`.
  - `integration/bff`: `operations-gateway.ts`, `contracts/graphql/operations.graphql`, `business-graphql.ts` (antes `employees-graphql.ts`), configuración de `OPERATIONS_API_URL`.
  - `web/mf-operations/src/app/features/operations/*`, `integration/routes.ts`, `web/shell/index.html` y `web/shell/src/main.ts`.
  - `scripts/operations/{verify-customers-vehicles-real,verify-catalog-appointments-real,verify-bff-real,verify-operations-web}.mjs`.
  - Contratos: `contracts/rest/operations.openapi.yaml`, `contracts/graphql/operations.graphql`, `contracts/auth/permissions.md`, decisión 013.
- **Comportamiento implementado:** alta y edición de clientes con documento único; vehículos con placa única, relación cliente-vehículo e historial de propietario append-only; catálogo con nombre único sin distinguir mayúsculas, duración y tarifa validadas; citas con duración derivada del servicio, duplicado, solapamiento por vehículo y capacidad del taller bajo lock transaccional, reprogramación que revalida y cancelación con motivo que libera la franja. Todo con `operationId`, `expectedVersion` y auditoría.
- **Comandos ejecutados y resultados:** `mvnw test` 30 PASS y `mvnw package` exit0; `mvnw` migraciones V2–V4 aplicadas; `node scripts/operations/verify-customers-vehicles-real.mjs` 9 etapas; `verify-catalog-appointments-real.mjs` 11 etapas; BFF `pnpm test` 20, `test:e2e` 13 y build exit0; `verify-bff-real.mjs` 9 etapas; `verify-operations-web.mjs` 9 etapas; Empleados `pnpm test` 90 PASS; regresión CU01 API 10, CU02 API 14, CU02 web 9, CU03 11 y CU04 8, todas exit0.
- **Contratos/decisiones modificados:** catálogo de permisos a catorce, `operations.openapi.yaml` y `operations.graphql` nuevos, `staffing.md` sin cambios en esta entrega, decisión 013.
- **Pendientes y bloqueos:** CU05 no está completo; requiere órdenes y asignaciones reales de CU11/CU12/CU15. La reserva de CU15 debe revalidar y escribir atómicamente en Empleados (CU04) y crear la asignación en Operaciones. Sin permisos por registro y sin offline de clientes/citas.
- **Próximo paso concreto:** iniciar CU11/CU12 (recepción y órdenes) con `/compose-next`, declarando sus permisos en el catálogo antes de tocar guards; la orden debe referenciar cita, cliente, vehículo y servicios cotizados sin duplicar datos.
- **Datos que la siguiente sesión debe leer:** `docs/context/STATUS.md` (sección del bloque operativo), `docs/decisions/013-operations-base.md`, `docs/compose/spec/operations-base.md`, `contracts/auth/permissions.md`, `contracts/rest/operations.openapi.yaml` y `docs/ai/START-HERE.md`.
