# 013 — Operaciones base: clientes, vehículos, catálogo y citas

Fecha: 2026-10-28. Diseño en `docs/compose/spec/operations-base.md`, implementado y verificado en `work/marcelo`. No implica despliegue productivo.

## Alcance y por qué este orden

CU05 (agenda) necesita órdenes y asignaciones reales que todavía no existen. La base útil es CU06 clientes, CU07 vehículos, CU09 catálogo y CU10 citas: sin cliente y vehículo no hay recepción, y sin catálogo no hay servicio que agendar. Los cuatro se entregan en una sola rama con entregas verificables por separado. **Una cita no es una orden de trabajo**: no tiene mecánico asignado, ni número de orden, ni estado de ejecución; CU05 se completará cuando CU11/CU12 produzcan órdenes.

## Autorización sin duplicar la matriz

Operaciones valida el token y resuelve los permisos del portador llamando a `GET /security/permissions` de Empleados con el token del usuario (caché de 30 s, timeout de 2 s, fallo cerrado). Cada endpoint exige su permiso: `customers:*`, `vehicles:*`, `catalog:*`, `appointments:*`. No se construyó una segunda matriz ni se cambió la política de `/technical/*`, que conserva el contrato de CU01. El resultado es el mismo catálogo de CU02 en los tres servicios.

## Catálogo ampliado a catorce permisos

Se añadieron ocho permisos y se resembraron los roles iniciales respetando los actores de cada CU: `administrador` recibe los catorce; `jefe_taller` suma lectura de clientes y vehículos, catálogo completo y agenda; `recepcionista` recibe clientes, vehículos y citas; `mecanico` y `responsable_financiero` siguen sin permisos. La migración `1793282400000` actualiza solo los roles `system` y deja intactos los roles personalizados y las asignaciones.

## Persistencia propietaria

Flyway V2–V4 sobre el esquema `operations`: `customers`, `vehicles`, `vehicle_owners` (historial de propietario append-only con una fila vigente por vehículo), `service_catalog`, `appointments`, `operations_operations` (idempotencia) y `operations_history` (auditoría). Nada se borra: clientes, vehículos y servicios se desactivan. Un cambio de propietario cierra la fila vigente de `vehicle_owners` y abre otra, de modo que el historial sobrevive.

## Reglas de cita

- Cliente, vehículo y servicio deben existir y estar activos; el vehículo debe pertenecer al cliente declarado (`VEHICLE_OWNERSHIP_MISMATCH`).
- `endsAt` se calcula con la duración del servicio; `startsAt` exige ISO-8601 **con offset** (`2026-12-01T09:00:00-04:00`), nunca una hora local sin zona.
- Duplicado exacto (vehículo + servicio + inicio) ⇒ `APPOINTMENT_DUPLICATE`; solapamiento del mismo vehículo ⇒ `APPOINTMENT_OVERLAP`; superar la capacidad del taller ⇒ `WORKSHOP_CAPACITY_EXCEEDED` (propiedad `operations.appointments.capacity`, por defecto 2).
- Capacidad y solapamiento se evalúan bajo `pg_advisory_xact_lock` dentro de la transacción, así que dos recepcionistas concurrentes no pueden sobrevender la misma franja.
- Reprogramar repite todas las validaciones y exige `expectedVersion`; cancelar exige motivo, libera la franja y conserva la cita con `status=cancelled`. No existe `confirmed`: ese estado pertenece a la orden de trabajo.

## Frontera BFF y web

`integration/bff` añade `HttpOperationsGateway` y `contracts/graphql/operations.graphql`; el ejecutor pasó a llamarse `BusinessGraphql` porque ahora compone dos servicios. Cada campo raíz declara su permiso con la misma resolución de CU02. `mf-operations` incorpora `/customers`, `/vehicles`, `/catalog` y `/appointments` con NG-ALAIN, single-spa y su arranque independiente; el Shell muestra esas páginas solo en el módulo Operaciones. La UI usa `SessionPort.requestBusiness`, nunca REST ni tokens.

## Verificación

API real: clientes y vehículos 9 etapas, catálogo y citas 11 etapas (incluye capacidad, duplicado, solapamiento, propiedad, servicio inactivo, reprogramación, cancelación y auditoría). BFF real 9 etapas por GraphQL. Navegador 9 etapas con recepcionista, jefe de taller y mecánico denegado por el servidor. Regresión CU01 API, CU02 API y web, CU03 y CU04. Pruebas Java: 30 (validaciones, casos de uso, resolución de permisos con caché y fallo cerrado).

## Límites

- Sin permisos por registro: se autoriza por operación y módulo.
- CU05 no se declara completo: su agenda requiere órdenes reales; su consulta deberá identificar al empleado por el subject autenticado y proteger el acceso por registro, con un permiso de agenda que se añadirá entonces.
- Sin sincronización offline de clientes o citas, sin notificaciones y sin cotización ni cobro.
