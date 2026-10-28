---
status: delivered
updated: 2026-10-28
source: work/marcelo
---
## Report

**What was built** — CU06 clientes, CU07 vehículos con historial de propietario, CU09 catálogo de servicios y CU10 citas de punta a punta: persistencia PostgreSQL propia de Operaciones (Flyway V2–V4), REST con autorización por permiso, BFF GraphQL con política por campo y pantallas en `mf-operations` con navegación del Shell. El catálogo de CU02 se amplió a catorce permisos y los roles iniciales se resembraron según los actores de cada CU. Una cita reserva una franja para un vehículo y un servicio: no es una orden de trabajo ni asigna mecánico.

**Verification** — Operaciones 30 pruebas Java y jar exit0; API real CU06/CU07 9 etapas y CU09/CU10 11 etapas; BFF 20 unitarias + 13 HTTP y BFF real 9 etapas; navegador 9 etapas con recepcionista, jefatura y mecánico denegado; Empleados 90 pruebas; regresión CU01 API, CU02 API y web, CU03 y CU04 en verde.

**Review** — Registro en `docs/context/STATUS.md` (revisión independiente del rango completo).

# Bloque operativo base — clientes, vehículos, catálogo y citas

## Report

## [S1] Problem

Operaciones (MS01) solo expone salud y diagnósticos técnicos: no existen clientes, vehículos, catálogo de servicios ni citas. Sin esa base no se puede recibir un vehículo, cotizar ni construir la agenda de CU05 con datos reales. CU06, CU07, CU09 y CU10 están definidos en `docs/use-cases/` y sus actores son recepcionista, administrador y jefe de taller, pero la autorización del servicio todavía se basa en nombres de rol fijos y no existe ninguna pantalla empresarial en `mf-operations`.

## [S2] Design

### [S2.1] Alcance y límites de esta entrega

Cuatro casos de uso, una sola rama y entregas verificables por separado:

| CU | Operación | Actores del CU | Permisos |
| --- | --- | --- | --- |
| CU06 | Registrar, consultar y actualizar clientes | Recepcionista, Administrador | `customers:read`, `customers:write` |
| CU07 | Registrar, consultar y actualizar vehículos asociados a un cliente | Recepcionista, Administrador | `vehicles:read`, `vehicles:write` |
| CU09 | Catálogo de servicios con duración y tarifa referencial | Administrador, Jefe de taller | `catalog:read`, `catalog:write` |
| CU10 | Registrar, reprogramar, cancelar y consultar citas | Recepcionista, Jefe de taller | `appointments:read`, `appointments:write` |

**Una cita no es una orden de trabajo ni una asignación de mecánico.** No tiene mecánico asignado, ni número de orden, ni estado de ejecución, ni consume disponibilidad de Empleados. Es la reserva de una franja para un vehículo y un servicio. CU05 mostrará la agenda con órdenes reales cuando CU11/CU12 las produzcan; aquí solo se entrega la cita.

### [S2.2] Catálogo de permisos ampliado

Se añaden ocho permisos al catálogo cerrado de CU02 (`services/employees/src/domain/permissions.ts`) y se siembran en los roles iniciales respetando los actores de cada CU:

| Rol | Permisos tras el bloque |
| --- | --- |
| `administrador` | los catorce |
| `jefe_taller` | `schedules:read/write`, `customers:read`, `vehicles:read`, `catalog:read/write`, `appointments:read/write` |
| `recepcionista` | `customers:read/write`, `vehicles:read/write`, `catalog:read`, `appointments:read/write` |
| `mecanico` | — |
| `responsable_financiero` | — |

Migración `1793282400000-extend-permissions-catalog` sobre Empleados: actualiza `security_roles.permissions` de los roles `system` y sube su `version`, sin tocar asignaciones ni roles personalizados. `mecanico` y `responsable_financiero` siguen sin permisos: no se inventan operaciones para llenar el catálogo.

CU05 añadirá `agenda:read` cuando existan órdenes reales; esta entrega **no** crea ese permiso.

### [S2.3] Autorización por operación en Operaciones

El servicio no consulta bases ajenas. Valida el token (RS256, issuer, audiencia `autonexus-operations-api`, `exp`, `typ=Bearer`) y luego resuelve los permisos del portador llamando a `GET /security/permissions` de Empleados con **el token del usuario**, con caché de 30 s por `subject`+roles y timeout de 2 s.

- Cada endpoint de negocio exige su permiso (`hasAuthority('customers:write')`, …). Sin token válido: 401. Sin permiso o sin poder resolver: 403 (falla cerrado).
- `/technical/session` conserva la política y el cuerpo de CU01; `/technical/admin` sigue exigiendo el rol `administrador`. Las operaciones nuevas no amplían esos diagnósticos.
- Los permisos se materializan como `GrantedAuthority` con el mismo identificador del catálogo, de modo que Operaciones y el BFF comparten una única matriz (la de CU02) y no una copia.

### [S2.4] Persistencia propietaria

PostgreSQL propio (`autonexus_operations`), migraciones Flyway versionadas, `synchronize` inexistente. Esquema `operations`:

- `customers(id uuid pk, first_name, last_name, document unique, phone, email null, address null, status active|inactive, version, created_at, updated_at, created_by, updated_by)`.
- `vehicles(id uuid pk, customer_id fk, plate unique, make, model, year, fuel_type, color null, status active|inactive, version, created_at, updated_at, created_by, updated_by)`.
- `vehicle_owners(id uuid pk, vehicle_id fk, customer_id fk, from_at timestamptz, to_at timestamptz null, changed_by)` — trazabilidad de cambios de propietario, append-only.
- `service_catalog(id uuid pk, name unique lower(name), description, category, estimated_minutes, reference_rate numeric(10,2), active, version, timestamps, actor)`.
- `appointments(id uuid pk, customer_id fk, vehicle_id fk, service_id fk, starts_at timestamptz, ends_at timestamptz, status scheduled|cancelled, notes null, cancel_reason null, version, timestamps, actor)`.
- `appointment_events(id uuid pk, appointment_id fk, action scheduled|rescheduled|cancelled, actor_subject, occurred_at, version, snapshot jsonb)` — auditoría append-only.
- `operations_operations(operation_id uuid pk, fingerprint text, result jsonb)` — idempotencia.
- `operations_history(id uuid pk, entity, entity_id, action, actor_subject, occurred_at, version, snapshot jsonb)` — auditoría de clientes y vehículos.

Reglas: `unique` sobre documento normalizado y placa normalizada; claves foráneas con `ON DELETE RESTRICT`; ninguna entidad se borra físicamente (clientes, vehículos y servicios se desactivan).

### [S2.5] Validaciones por CU

**Cliente (CU06).** Obligatorios: nombres, apellidos, documento y teléfono. Textos recortados y con espacios colapsados; 1–100 caracteres para nombres/apellidos; documento `^[0-9A-Z]{4,20}$` tras normalizar (mayúsculas, sin espacios ni guiones); teléfono 7–25 del conjunto `0-9 + ( ) . -` con al menos un dígito; correo opcional válido (dot-atom ASCII, ≤254); dirección opcional ≤200. Documento duplicado ⇒ `409 DUPLICATE_DOCUMENT`. Búsqueda literal por nombre, apellido o documento (sin regex). Listado paginado `limit 1..100`, `offset ≥0`, orden `createdAt ASC, id ASC`. Desactivar conserva historial; un cliente inactivo no admite vehículos ni citas nuevas.

**Vehículo (CU07).** Obligatorios: cliente, placa, marca, modelo, año, combustible. Placa normalizada a mayúsculas sin espacios/guiones, `^[0-9A-Z]{5,10}$`; duplicada ⇒ `409 DUPLICATE_PLATE`. Marca/modelo 1–60; año entre 1950 y el año actual + 1; combustible `gasolina|diesel|gas|electrico|hibrido`; color opcional ≤40. El cliente debe existir (`404 CUSTOMER_NOT_FOUND`) y estar activo (`409 CUSTOMER_INACTIVE`). Cambiar de cliente actualiza `vehicles.customer_id`, cierra la fila vigente de `vehicle_owners` y abre otra, conservando el historial. Un vehículo inactivo no admite citas nuevas.

**Servicio (CU09).** Nombre único sin distinguir mayúsculas, 3–80; descripción 1–300; categoría `mantenimiento|reparacion|diagnostico|otros`; `estimatedMinutes` entero 15–480; `referenceRate` decimal ≥0 ≤9 999 999,99 con dos decimales; duplicado ⇒ `409 DUPLICATE_SERVICE`; duración o tarifa inválida ⇒ `400 VALIDATION_ERROR`. Desactivar lo retira de citas nuevas conservando las existentes y el historial; no hay borrado.

**Cita (CU10).** Obligatorios: cliente, vehículo, servicio, `startsAt` ISO-8601 con offset explícito. El vehículo debe pertenecer al cliente (`409 VEHICLE_OWNERSHIP_MISMATCH`), estar activo y su cliente activo; el servicio debe estar activo (`409 SERVICE_INACTIVE`). `endsAt` se calcula con la duración del servicio. No se admiten solapamientos del **mismo vehículo** (`409 APPOINTMENT_OVERLAP`) ni superar la capacidad del taller en la franja (`409 WORKSHOP_CAPACITY_EXCEEDED`); la capacidad es configurable (`operations.appointments.capacity`, por defecto 2) y se evalúa con un lock de transacción sobre la franja. Una cita duplicada —mismo vehículo, servicio y `startsAt` con estado `scheduled`— ⇒ `409 APPOINTMENT_DUPLICATE`.

Reprogramar exige `expectedVersion` y repite todas las validaciones de disponibilidad; cancelar exige `expectedVersion` y motivo (1–200), libera la franja y conserva la fila con `status=cancelled`. Toda cita queda en `scheduled` o `cancelled`: no existe `confirmed`, que se reserva a la orden de trabajo.

### [S2.6] Contrato REST

`contracts/rest/operations.openapi.yaml`:

| Método y ruta | Permiso | Entrada | Salida |
| --- | --- | --- | --- |
| `GET /customers` | `customers:read` | `limit,offset,status,search` | `{items,total,limit,offset}` |
| `GET /customers/:id` | `customers:read` | — | `Customer` |
| `POST /customers` | `customers:write` | `{operationId,firstName,lastName,document,phone,email?,address?}` | 201 `{customer,replayed}` |
| `PUT /customers/:id` | `customers:write` | `{operationId,expectedVersion,...}` | 200 `{customer,replayed}` |
| `POST /customers/:id/deactivate` | `customers:write` | `{operationId,expectedVersion}` | 200 `{customer,replayed}` |
| `GET /vehicles` | `vehicles:read` | `limit,offset,status,customerId,search` | página de `Vehicle` |
| `GET /vehicles/:id` | `vehicles:read` | — | `Vehicle` |
| `POST /vehicles` | `vehicles:write` | `{operationId,customerId,plate,make,model,year,fuelType,color?}` | 201 `{vehicle,replayed}` |
| `PUT /vehicles/:id` | `vehicles:write` | `{operationId,expectedVersion,...}` | 200 `{vehicle,ownerChanged,replayed}` |
| `POST /vehicles/:id/deactivate` | `vehicles:write` | `{operationId,expectedVersion}` | 200 `{vehicle,replayed}` |
| `GET /services` | `catalog:read` | `limit,offset,active,search` | página de `Service` |
| `GET /services/:id` | `catalog:read` | — | `Service` |
| `POST /services` | `catalog:write` | `{operationId,name,description,category,estimatedMinutes,referenceRate}` | 201 `{service,replayed}` |
| `PUT /services/:id` | `catalog:write` | `{operationId,expectedVersion,...}` | 200 `{service,replayed}` |
| `POST /services/:id/deactivate` | `catalog:write` | `{operationId,expectedVersion}` | 200 `{service,replayed}` |
| `GET /appointments` | `appointments:read` | `from,to,status,customerId,vehicleId,limit,offset` | página de `Appointment` |
| `GET /appointments/:id` | `appointments:read` | — | `Appointment` |
| `POST /appointments` | `appointments:write` | `{operationId,customerId,vehicleId,serviceId,startsAt,notes?}` | 201 `{appointment,replayed}` |
| `PUT /appointments/:id` | `appointments:write` | `{operationId,expectedVersion,startsAt,notes?}` | 200 `{appointment,replayed}` |
| `POST /appointments/:id/cancel` | `appointments:write` | `{operationId,expectedVersion,reason}` | 200 `{appointment,replayed}` |

`Appointment` incluye `customerName`, `vehiclePlate` y `serviceName` resueltos en la base propietaria para que la web no componga llamadas cruzadas. Idempotencia por `operationId` con huella actor+acción+destino+contenido+versión; replay devuelve el resultado guardado. Errores de negocio `{statusCode,message,code}` saneados; 401 y 403 genéricos.

### [S2.7] Frontera BFF y web

- `integration/bff` suma `HttpOperationsGateway` (REST de Operaciones, `OPERATIONS_API_URL`, por defecto `http://127.0.0.1:8081`) y `contracts/graphql/operations.graphql` con campos raíz `customers`, `customer`, `vehicles`, `vehicle`, `services`, `service`, `appointments`, `appointment`, `createCustomer`, `updateCustomer`, `deactivateCustomer`, `createVehicle`, `updateVehicle`, `deactivateVehicle`, `createService`, `updateService`, `deactivateService`, `createAppointment`, `rescheduleAppointment`, `cancelAppointment`.
- Cada campo raíz declara el permiso que exige, con la misma resolución de CU02 (caché 30 s, fallo cerrado). El BFF reenvía el token del usuario a Operaciones, que vuelve a autorizar.
- `mf-operations` incorpora `/customers`, `/vehicles`, `/catalog` y `/appointments`, conservando NG-ALAIN, single-spa y su arranque independiente. El Shell añade la navegación de esas páginas cuando el módulo activo es `operations`. La UI nunca llama a REST ni recibe tokens: usa `SessionPort.requestBusiness`.

### [S2.8] Fechas y zona horaria

Zona del taller `America/La_Paz` (UTC-4, sin horario de verano). `startsAt` se envía como ISO-8601 **con offset explícito** (`2026-11-10T09:00:00-04:00`), validado en el dominio; se persiste como `timestamptz` y se devuelve en UTC ISO. La UI construye el offset fijo del taller y muestra la hora local; nunca usa la medianoche UTC como fecha calendario, conservando la corrección de CU03.

### [S2.9] Verificación

- Unitarias Java de dominio y casos de uso (validaciones, duplicados, propiedad vehículo-cliente, capacidad, solapamiento, versiones, idempotencia) y de la resolución de permisos (caché y fallo cerrado).
- Verificación real de API por CU con PostgreSQL real: `scripts/operations/verify-customers-real.mjs`, `verify-vehicles-real.mjs`, `verify-catalog-real.mjs`, `verify-appointments-real.mjs` (o un verificador único por etapas), cubriendo 401/403, duplicados, relaciones inválidas, inactivos, versiones, idempotencia, reprogramación, cancelación y auditoría.
- Verificación real del BFF por GraphQL y smoke de navegador en `mf-operations` con recepcionista y jefe de taller.
- Regresión focalizada: CU01 API (Operaciones y Empleados), CU02 (catálogo de 14 permisos y roles), CU03 y CU04 (navegador).

## [S3] Out of Scope

- Órdenes de trabajo, asignación de mecánicos, cotizaciones, cobros y Saga de CU15: no se implementan ni se simulan.
- CU05 no se declara completo: su agenda necesita órdenes y asignaciones reales; esta entrega solo deja la base de citas.
- Sincronización offline de clientes/citas, notificaciones y facturación.
- Permisos por registro en Operaciones: se autoriza por operación y módulo; el filtrado por registro (p. ej. cada recepcionista solo sus citas) queda declarado como límite.
- Migración de Operaciones a permisos para `/technical/*`: CU01 conserva su contrato.

## Tasks

- [x] T1: Extender el catálogo a catorce permisos y sembrar los roles iniciales — acceptance: `GET /security/permissions` devuelve 14 y cada rol su conjunto, con la migración aplicada (covers: S2.2)
- [x] T2: Operaciones CU06 con persistencia, REST y permisos — acceptance: alta, búsqueda, duplicado, versión e inactivo verificados por API real (covers: S2.4, S2.5, S2.6)
- [x] T3: Operaciones CU07 con relación cliente-vehículo e historial de propietario — acceptance: placa duplicada, cliente inexistente/inactivo y cambio de propietario trazado (covers: S2.5)
- [x] T4: Operaciones CU09 catálogo de servicios — acceptance: duplicado por nombre, duración y tarifa inválidas, desactivación con historial (covers: S2.5)
- [x] T5: Operaciones CU10 citas — acceptance: solapamiento, capacidad, propiedad, servicio inactivo, reprogramación y cancelación con versión (covers: S2.5)
- [x] T6: BFF GraphQL de Operaciones con política por permiso — acceptance: recorrido GraphQL real por los cuatro CU y 403 con rol sin permiso (covers: S2.7)
- [x] T7: Pantallas en `mf-operations` y navegación del Shell — acceptance: recorrido de navegador real (covers: S2.7)
- [x] T8: Cierre documental, regresión y publicación — acceptance: STATUS, contratos y revisión registrados; `main` y `work/marcelo` publicados con SHA verificados (covers: S2.9)

## Journey log
