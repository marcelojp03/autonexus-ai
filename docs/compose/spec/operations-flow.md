---
status: in-progress
status: designed
updated: 2026-10-28
source: work/marcelo
---

# Recepción, órdenes de trabajo y cotizaciones (CU11, CU12, CU13, CU14)

## Report

## [S1] Problem

Operaciones ya registra clientes, vehículos, catálogo y citas, pero no puede recibir físicamente un vehículo ni formalizar el trabajo a realizar. Sin recepción no hay inspección ni condiciones iniciales documentadas; sin orden de trabajo no hay nada que cotizar. Finanzas no existe: `services/finance` y `web/mf-finance` siguen reservadas, así que no hay cotizaciones versionadas ni registro de la decisión del cliente, y por tanto tampoco hay nada que confirmar en CU15 ni trabajos reales para la agenda de CU05.

Además el requisito de dos microfrontends React sigue pendiente: todo el frontend funcional es Angular.

## [S2] Design

### [S2.1] Alcance y orden de las entregas

| CU | Servicio | Operación | Permisos |
| --- | --- | --- | --- |
| CU11 | Operaciones | Recepción e inspección del vehículo | `receptions:read`, `receptions:write` |
| CU12 | Operaciones | Orden de trabajo con servicios solicitados | `orders:read`, `orders:write` |
| CU13 | Finanzas | Cotización versionada de una orden | `quotes:read`, `quotes:write` |
| CU14 | Finanzas | Registro de aprobación o rechazo | `quotes:decide` |

Entregas verificables por separado, en una sola rama: recepción/orden en Operaciones, luego Finanzas (Laravel), luego los contratos GraphQL del BFF y las pantallas. `mf-finance` se incorpora primero como **base técnica React** integrada al Shell; sus funcionalidades financieras llegan con CU13/CU14.

**Una cotización aprobada no es un servicio confirmado.** La confirmación y asignación corresponde a CU15 (Saga entre Operaciones, Empleados y Finanzas). La cotización solo registra el costo estimado y la decisión del cliente.

### [S2.2] Catálogo de permisos y actores

Se añaden siete permisos al catálogo de CU02 (21 en total) con los actores de cada CU:

| Rol | Permisos nuevos |
| --- | --- |
| `administrador` | los siete |
| `recepcionista` | `receptions:read/write`, `orders:read/write`, `quotes:read`, `quotes:decide` |
| `jefe_taller` | `receptions:read`, `orders:read/write`, `quotes:read`, `quotes:decide` |
| `mecanico` | `receptions:read/write` (CU11 lo autoriza a recepcionar) |
| `responsable_financiero` | `orders:read`, `quotes:read/write/decide` |

Finanzas resuelve los permisos igual que Operaciones: valida el token y consulta `GET /security/permissions` de Empleados con el token del usuario. No crea otra matriz.

### [S2.3] Recepción (CU11)

Tabla `operations.vehicle_receptions`: `id`, `vehicle_id`, `customer_id` (derivado del vehículo), `appointment_id` (nullable), `mileage`, `reason`, `symptoms`, `visible_conditions`, `received_at`, `received_by`, `version`, timestamps.

- Vehículo y cliente deben existir y estar activos; el cliente se deriva del vehículo, no se acepta del cuerpo.
- `mileage` entero 0–2 000 000 y **no inferior** al último kilometraje registrado del vehículo (`MILEAGE_REGRESSION`).
- `reason` 3–300; `symptoms` y `visible_conditions` opcionales ≤1000.
- Si se indica `appointmentId`, debe existir, pertenecer al vehículo y estar `scheduled` (`APPOINTMENT_NOT_SCHEDULED` / `VEHICLE_OWNERSHIP_MISMATCH`).
- Una sola recepción abierta por vehículo: si existe una recepción sin orden, `VEHICLE_ALREADY_IN_RECEPTION`.
- Recepción previamente registrada con el mismo `operationId` ⇒ replay; contenido distinto ⇒ `IDEMPOTENCY_CONFLICT`.

### [S2.4] Orden de trabajo (CU12)

Tablas `operations.work_orders` y `operations.work_order_items`: la orden guarda `id`, `number` legible y único (`WO-<año>-<secuencia>`), `reception_id` único, `vehicle_id`, `customer_id`, `description`, `priority` (`baja|normal|alta|urgente`), `notes`, `status`, `version`, timestamps; los ítems guardan `service_id`, `quantity` (1–99), `estimated_minutes` y `reference_rate` (copia del catálogo al crear, para que un cambio de tarifa no altere órdenes ya emitidas).

- La recepción debe existir y no tener orden (`RECEPTION_NOT_FOUND`, `ORDER_ALREADY_EXISTS`).
- Entre 1 y 20 ítems, sin servicios repetidos; todos activos (`SERVICE_INACTIVE`).
- `description` 3–1000; `priority` del enum; `notes` opcional ≤1000.
- Estado inicial `pending_quote`: la orden queda pendiente de cotización. No asigna mecánico ni confirma nada; eso es CU15.
- Idempotencia con `operationId`; `expectedVersion` en actualizaciones de estado posteriores.

### [S2.5] Cotización versionada (CU13) — Laravel

`services/finance` se inicializa con Laravel y PostgreSQL propio (`autonexus_finance`). Tablas `quotes`, `quote_items`, `quote_decisions`, `finance_operations` (idempotencia).

- Cadena de versiones por `order_reference` (id de la orden en Operaciones): `version_number` 1..n. Modificar una cotización `pending` genera la versión siguiente y marca la anterior `superseded`; la aprobada es inmutable (`QUOTE_APPROVED_IMMUTABLE`).
- Cálculo en servidor: `line_total = quantity × unit_price`; `subtotal`; descuento ≤ 20 % (`DISCOUNT_NOT_AUTHORIZED`); impuesto configurable (13 % por defecto); `total` redondeado a dos decimales con `HALF_UP`. Si el cliente envía totales, se validan contra el recálculo (`QUOTE_TOTAL_MISMATCH`).
- `invoiceTo` no existe: el cliente del taller **no** necesita cuenta ni acceso. La cotización se vincula a la orden y al vehículo por referencia.
- `valid_until` obligatorio, no anterior a hoy (`QUOTE_EXPIRED` al decidir sobre una vencida).

### [S2.6] Decisión del cliente (CU14)

`quote_decisions` registra `decision` (`approved|rejected`), `decided_by`, `evidence` (1–300, mecanismo autorizado: presencial, teléfono, correo), `reason` opcional y `decided_at`.

- Solo se decide una cotización `pending` y vigente; repetir la decisión ⇒ `QUOTE_ALREADY_DECIDED`.
- Aprobada ⇒ `approved`; rechazada ⇒ `rejected` y la orden no puede avanzar a ejecución (Operaciones queda `pending_quote` hasta que se decida otra cotización o se cancele; Finanzas no escribe en la base de Operaciones).
- La respuesta incluye `orderStatusHint` para que la web explique el siguiente paso, sin afirmar que el trabajo está confirmado.

### [S2.7] Contratos

`contracts/rest/operations.openapi.yaml` suma recepciones y órdenes; `contracts/rest/finance.openapi.yaml` publica cotizaciones y decisiones; `contracts/graphql/operations.graphql` y `finance.graphql` exponen las operaciones por GraphQL con permiso por campo. La referencia cruzada es **por identificador** (`order_reference`, `order_number`, `customer_reference`, `vehicle_reference`), nunca por consulta a la base ajena.

Contrato de CU15 preparado en `contracts/rest/saga.md`: pasos, idempotencia por `operationId`, compensaciones y el hecho de que un timeout no significa rechazo.

### [S2.8] Web

- `mf-operations` (Angular) suma `/receptions` y `/orders`.
- `mf-finance` (React) se integra al Shell por single-spa con la sesión existente: no hay login propio ni tokens en storage; usa el mismo `SessionPort` publicado por el Shell. Primero como base técnica (montaje, layout, navegación y health de sesión); luego `/quotes` y la decisión.
- El Shell muestra las páginas de cada módulo según el módulo activo y los permisos resueltos en servidor.

### [S2.9] Persistencia documentada

No se introduce ORM de entidades: Operaciones mantiene `JdbcClient` con SQL parametrizado y Flyway; Empleados mantiene TypeORM para conexión, transacciones y migraciones con SQL explícito y `entities: []`. Esta entrega documenta ese estado en `docs/context/PROJECT.md` y en la decisión correspondiente, sin afirmar que existen entidades ORM mapeadas.

### [S2.10] Verificación

- Unitarias Java de recepción y orden (validaciones, kilometraje, servicios inactivos, duplicados, versiones, idempotencia) y PHPUnit en Laravel (cálculo, versionado, inmutabilidad, decisión, expiración).
- API real: recepción y orden contra PostgreSQL; cotizaciones y decisiones contra PostgreSQL de Finanzas.
- BFF real por GraphQL y smoke de navegador: recepción → orden → cotización → decisión, con recepcionista, jefe, responsable financiero y un rol sin permiso.
- Regresión focalizada CU01, CU02, CU03, CU04, CU06–CU10.

## [S3] Out of Scope

- CU15 (confirmación, reserva en Empleados y asignación) no se implementa: solo se deja su contrato.
- Cobros, gastos, comprobantes e indicadores financieros; ejecución de la orden, avances y cierre.
- Inspección asistida por IA y almacenamiento de fotografías en S3: CU11 registra textos; la evidencia fotográfica y la IA quedan para CU16/CU05.
- Offline de recepción y órdenes; notificaciones al cliente.
- No se presenta una cotización aprobada como servicio confirmado.

## Tasks

- [ ] T1: Ampliar el catálogo a 21 permisos y sembrar los roles — acceptance: catálogo publicado y roles con los conjuntos del diseño (covers: S2.2)
- [ ] T2: Operaciones CU11 recepción — acceptance: alta con validaciones, kilometraje no regresivo, recepción abierta única y cita vinculada (covers: S2.3)
- [ ] T3: Operaciones CU12 orden — acceptance: número único, ítems con copia de tarifa, servicios inactivos rechazados y estado `pending_quote` (covers: S2.4)
- [ ] T4: Finanzas Laravel con cotización versionada — acceptance: cálculo en servidor, versionado, inmutabilidad de aprobada (covers: S2.5)
- [ ] T5: Finanzas CU14 decisión — acceptance: aprobación/rechazo con evidencia, expiración y decisión repetida rechazada (covers: S2.6)
- [ ] T6: BFF GraphQL de recepciones, órdenes y cotizaciones — acceptance: recorrido GraphQL real y 403 sin permiso (covers: S2.7)
- [ ] T7: Web: recepción y orden en Angular, cotización y decisión en React integrado — acceptance: smoke de navegador con sesión única (covers: S2.8)
- [ ] T8: Cierre: documentación de persistencia, contrato de Saga CU15, regresión, revisión y publicación (covers: S2.9, S2.10)

## Journey log
