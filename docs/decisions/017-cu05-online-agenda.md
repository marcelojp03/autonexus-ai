# 017 — CU05 web online con identidad laboral vigente

Fecha: 2026-10-28. Estado: aceptada explícitamente por el usuario en esta sesión; implementación/verificación se acreditan separadamente en STATUS. Base df91374, rama personal work/marcelo conservada.

## Contexto

CU15 ya produce órdenes y asignaciones reales, pero confirmed local en Empleados no prueba cierre global. El catálogo anterior no tiene agenda y permite deliberadamente roles iniciales a cuentas de infraestructura sin empleado: esa excepción no sirve para CU05. La agenda no debe conceder el CRUD general de órdenes/empleados/clientes/cotizaciones ni consultar bases ajenas.

## Decisión

Operaciones es dueño de la lectura de agenda, comprobando su orden/Saga confirmed y referencias. Resuelve por API humana autorizada en Empleados al subject autenticado y valida la asignación actual en cada lectura. Empleados exige vínculo/identidad actual, empleado activo y asignaciones de seguridad actuales para permisos agenda:read:self/team; no usa la excepción no vinculada CU02 y no modifica esa política para otros CU. BFF compone transporte GraphQL sin SQL ni orquestación.

Propia no acepta employeeId del cliente. Equipo se limita al taller único y requiere permiso específico; sus filtros no sustituyen al actor. Listado/detalle se autorizan independientemente; ID ajeno/inexistente404 seguro. Mecánico obtiene self; jefe self/team; administrador ambos por convención, también con vínculo obligatorio. Migración aditiva preserva personalizaciones, sin permisos generales de negocio extra.

Solo confirmed es un estado de trabajo global alcanzable hoy: no inventar estados CU16/CU17. Rango civil inclusivo máximo31 días en America/La_Paz, comparación de intervalos semiabiertos y paginación/orden estables. Prioridades y datos de vehículo/servicios/observaciones ya existentes; DTO mínimo sin clientes, precios, documentos, cotizaciones o cuerpos técnicos.

No crear una proyección nueva de agenda. Si la observación de order.confirmed en E demora pero O y asignación actual prueban confirmación global, mostrar aviso explícito; no convertirla en reserva o sin trabajos. Falla de propietario/integridad es error visible, no lista vacía. Lecturas tienen versiones/observedAt, no una transacción distribuida.

UI integrada en mf-employees/Shell con sesión compartida, estados claros, recarga/detalle y aislamiento al cambiar de cuenta. Solo consulta online: sin iniciar/finalizar/reescribir asignaciones y sin cache persistente/offline ni token expuesto. Se hereda el diseño existente.

## Consecuencias y aceptación

Dos mecánicos de subjects distintos y jefe realmente vinculados, trabajos por Saga real, pruebas REST/GraphQL/UI contra manipulación de IDs/filtros y vínculo/permisos/actividad. Fechas La Paz bajo timezone distinto, vacíos, desconexión, propietario indisponible y notificación pendiente explícitos. No mocks como integración ni matriz completa de Saga sin cambios de lógica. Verificar CU05 primero, después implementar el Compose reproducible aprobado por separado.

Revisión independiente después de verificaciones, STATUS/contratos/traspaso y publicación normal de main/work/marcelo; conservar entornos, credenciales y volúmenes. La aprobación del diseño no equivale a despliegue ni entrega terminada.

## Referencias

- [CU05](../use-cases/CU05.md) y su fuente Notion citada allí.
- [Especificación](../compose/spec/cu05-web-agenda.md).
- [REST](../../contracts/rest/agenda.md), [GraphQL](../../contracts/graphql/agenda.graphql), [permisos](../../contracts/auth/permissions.md).
