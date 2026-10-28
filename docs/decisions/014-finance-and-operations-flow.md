# 014 — Finanzas (Laravel), recepción/órdenes y base React

Fecha: 2026-10-28. Diseño en `docs/compose/spec/operations-flow.md`, implementado y verificado en `work/marcelo`.

## Recepción y orden en Operaciones

CU11 registra la llegada del vehículo con kilometraje, motivo, síntomas y condiciones visibles. El cliente se deriva del vehículo (no se acepta en el cuerpo), el kilometraje no puede retroceder y un vehículo admite **una sola recepción sin orden** (índice único parcial). CU12 convierte la recepción en orden con número legible (`WO-AAAA-NNNNNN`), prioridad, servicios solicitados y estado inicial `pending_quote`; cada ítem **copia la tarifa del catálogo** al crearse, de modo que un cambio posterior de precio no altera órdenes ya emitidas. Una orden no asigna mecánico: eso corresponde a CU15.

## Finanzas con Laravel y PostgreSQL propio

`services/finance` es Laravel 12.70.2 con `autonexus_finance` propietaria (rol y base aprovisionados por `infra/compose/scripts/provision-finance-db.mjs`; el `initdb` y el compose incorporan las variables `FINANCE_*` para volúmenes nuevos). La persistencia usa el Query Builder con SQL explícito y transacciones; **no hay modelos Eloquent mapeados**, igual que Operaciones (JDBC) y Empleados (TypeORM con SQL explícito y `entities: []`).

CU13 calcula en servidor: subtotal por líneas, descuento máximo 20 %, impuesto configurable (13 % por defecto), redondeo a dos decimales y validación opcional del total declarado. Modificar una cotización `pending` genera la versión siguiente y marca la anterior `superseded`; una `approved` es inmutable. CU14 registra la decisión con evidencia y motivo, rechaza cotizaciones vencidas o ya decididas y devuelve `orderStatusHint`. **Aprobar no confirma el servicio**: no se escribe en la base de Operaciones.

## Autorización y sesión

El catálogo de CU02 pasó a **21 permisos** con `receptions:*`, `orders:*`, `quotes:read/write/decide` sembrados por actor: recepción recepciona, ordena y decide; jefatura ordena y decide; el mecánico solo recepciona; el responsable financiero elabora y decide. Finanzas valida el token con OpenSSL y el JWKS del realm (sin dependencias y sin advisories), exige la audiencia `autonexus-finance-api` y resuelve permisos contra Empleados con caché de 30 s; sin resolución, deniega. Se provisió el cliente bearer `autonexus-finance-api`, el cliente público `autonexus-mf-finance` y el mapper de audiencia en los clientes públicos existentes.

## Base React

El template del usuario (`C:\Programacion\templates\react\vitedash-vite-antd-dashboard-template`, React 19 + Vite 8 + Ant Design 6) quedó **localizado para `web/mf-finance`**. La integración por single-spa con la sesión del Shell y las pantallas de cotizaciones **no se completaron en esta entrega**: se registran como pendientes explícitas, sin declararlas funcionales.

## Verificación observada

Operaciones: 82 pruebas Java y 7 etapas reales de recepción/orden. Finanzas: migraciones aplicadas, 6 pruebas PHPUnit y 8 etapas reales de cotización/decisión. BFF: 22 unitarias + 13 HTTP y 6 etapas del recorrido GraphQL completo (recepción → orden → cotización → decisión) con denegaciones por permiso.

## Límites

Sin pantallas Angular de recepción/orden ni React de cotizaciones; sin inspección asistida por IA ni fotografías; CU15 no implementado (solo su contrato en `contracts/rest/saga.md`); sin cobros, gastos ni indicadores.
