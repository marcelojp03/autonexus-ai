---
feature: cu05-web-agenda
status: in-progress
updated: 2026-10-29
source: work/marcelo
---

# CU05 — Agenda web online de trabajos asignados

## Report

## [S1] Problem

CU15 está publicado en df91374 y genera órdenes/asignaciones reales, pero el mecánico no dispone de agenda ni detalle propio autorizado. CU05 web online debe permitir organizar el trabajo sin conceder CRUD general de órdenes/clientes/empleados/cotizaciones. Se conserva work/marcelo y su worktree existente; no se crea otra rama. Diseño y políticas aprobados explícitamente por el usuario en esta sesión. Implementar/verificar primero CU05 con dos mecánicos y un jefe vinculados a empleados activos; después completar la entrega Docker/Compose. No pedir nuevas confirmaciones para decisiones rutinarias cubiertas.

Fuente funcional: docs/use-cases/CU05.md. Contratos relacionados: contracts/rest/saga.md, staffing.md, operations.openapi.yaml, employees.openapi.yaml, contracts/auth/permissions.md y contracts/events/cu15.v1.md. La aceptación puede aprovechar el entorno aislado diseñado en local-compose-demo.md, sin atribuir a los PASS históricos una nueva verificación.

## [S2] Design

### [S2.1] Actores, alcance y permisos

Agregar dos permisos cerrados: agenda:read:self y agenda:read:team. Mecánico: propia. Jefe: propia y equipo. Administrador: ambos por la convención de autoridad del catálogo, pero sin excepción a la vinculación laboral activa. Roles personalizados pueden recibirlos; no se decide por nombre de rol. Una migración aditiva preserva personalizaciones y registra la ampliación sin otorgar orders:read, customers:read, employees:read ni quotes:read al mecánico. La extensión de identificador con alcance explícito no introduce herencia implícita.

Toda lectura CU05 exige subject autenticado, empleado activo enlazado actualmente a ese subject y asignación de seguridad vigente bajo esa identidad. No aplicar la excepción CU02 para cuentas de infraestructura no vinculadas. Revalidar en Empleados en cada petición, aunque BFF/guard general conserven su caché de permisos. CU01–CU04 y CU11–CU15 mantienen sus políticas. Habilitación mecánica permite recibir trabajo, no sustituye autorización ni elimina por sí sola lectura histórica de un empleado activo.

Equipo significa este único taller. El jefe puede consultar trabajos del rango, incluyendo asignados históricos inactivos mediante filtros explícitos; un actor inactivo nunca consulta. Solo se exponen id/nombre laboral/estado necesarios, no documento, contacto, cuenta ni historial administrativo.

### [S2.2] Propiedad y prueba positiva de confirmación

Operaciones es propietario de la lectura de agenda: ya guarda orden, prioridad, observaciones, servicios e identificación de asignación/Saga/empleado/intervalo. Consulta solo su base. Componer con APIs autorizadas de Empleados, reenviando el bearer humano en RAM; no usar el cliente técnico CU15 para ampliar autoridad humana. BFF no tiene SQL ni coordina Saga.

Un trabajo exige orden confirmed y Saga CU15 correspondiente confirmed, con referencias completas y consistentes. Después se verifica en Empleados la asignación actual confirmed, no liberada, y sus referencias/intervalo/versiones. Excluir reservas, Sagas no terminales/rechazadas, liberaciones y filas legacy sin prueba global. No crear una proyección nueva de órdenes ni modificar el algoritmo de Saga.

La marca Inbox orderConfirmedObserved no sustituye el commit global de Operaciones: si está retrasada pero O confirma y E mantiene la asignación válida, mostrar el trabajo confirmado con aviso de observación/notificación pendiente. Esto no acredita lectura humana del aviso. No presentar esa demora como ausencia de trabajo ni como reserva provisional.

Las lecturas entre propietarios no son una transacción distribuida: informar observedAt y versiones observadas. Validar correspondencia exacta antes de devolver DTO. Si falta un propietario o las referencias son incompatibles, error explícito; no podar filas y devolver un falso vacío. El detalle repite la autorización/validación vigente, sin confiar en el listado previo.

### [S2.3] APIs propietarias y DTO mínimo

Empleados, REST humano autorizado:

| Endpoint propuesto | Regla |
| --- | --- |
| GET /agenda/context?scope=self o team | Resolver subject a empleado activo y permiso específico; no aceptar employeeId/subject del cliente como identidad |
| GET /agenda/team/employees | Selector paginado id/fullName/status, solo equipo y actor vinculado activo; filtros de búsqueda/estado explícitos |
| POST /agenda/assignments/check | Lectura acotada {scope, assignmentIds}; máximo 100, claves cerradas, sin mutaciones; revalida al actor y limita registros al alcance propio/equipo |

La resolución CU05 debe contrastar la identidad actual del empleado y de las asignaciones de seguridad pertinentes; no ampliar silenciosamente la política general de CU02. Las APIs internas del coordinador conservan sus scopes actuales y no se abren al navegador.

Operaciones:

| Endpoint propuesto | Permiso |
| --- | --- |
| GET /agenda/me | agenda:read:self |
| GET /agenda/me/:assignmentId | agenda:read:self + pertenencia actual |
| GET /agenda/team | agenda:read:team |
| GET /agenda/team/:assignmentId | agenda:read:team |

El filtro employeeId solo existe en equipo. /me resuelve identidad exclusivamente en servidor y rechaza parámetros ajenos/duplicados en lugar de utilizarlos. Detalle ajeno o inexistente: misma respuesta 404 segura. Listado y detalle no delegan en GET /orders ni en el CRUD de empleados.

DTO específico, no WorkOrder general: assignmentId, orderId/orderNumber, employee {id, fullName, status}, vehicle {id, plate, make, model}, startsAt/endsAt, priority, status, description/notes, services [{serviceId, serviceName, quantity, estimatedMinutes}], versiones, observedAt y estado de observación global. Excluir customerId/customerName/contactos/documentos, tarifas/importes, cotización/vínculo financiero, credenciales y cuerpos técnicos. Observaciones: descripción/notas de la orden, con texto escapado; no volcar recepción ni evidencias privadas.

### [S2.4] Fechas, filtros, estados y paginación

Zona fija America/La_Paz. from/to son fechas civiles ISO inclusivas; default hoy, rango máximo propuesto 31 días. Convertir en servidor a [inicio de from, inicio de to+1día) y seleccionar por solapamiento semiabierto. Orden estable startsAt, orderId, assignmentId; limit default20/máximo100, offset entero acotado. Equipo añade employeeId; prioridad opcional con valores actuales baja/normal/alta/urgente.

Solo confirmed es hoy un estado de trabajo global alcanzable y consultable. Implementar ese filtro explícito y rechazar estados desconocidos/provisionales; no inventar in_progress/completed de CU16/CU17. La UI informa que esta entrega consulta confirmados; el catálogo de estados podrá ampliarse al existir transiciones reales. Cancelaciones/liberaciones nunca se etiquetan confirmed para llenar una pantalla. Un rango autorizado realmente vacío sí devuelve una lista vacía.

### [S2.5] GraphQL y fronteras de autorización

SDL CU05 propio con myAgenda, myAgendaWork, teamAgenda, teamAgendaWork y agendaTeamEmployees; política por campo raíz. Tipos acotados anteriores, sin reutilizar DTOs que revelen información financiera o clientes. Variables propias no incluyen employeeId. Errores saneados en el catálogo público; compatibilidad con límites actuales de profundidad/tamaño.

Sin token401; sin permiso/vínculo/actividad403 seguro; detalle ajeno/inexistente404; entradas inválidas400; dependencia/estado no verificable503 con código CU05 explícito. GraphQL mantiene su envelope/HTTP vigente y no devuelve datos ante denegación. Menú/guards visuales no sustituyen autorización de los propietarios.

### [S2.6] Pantalla integrada y estados operativos

Extender mf-employees en /employees/agenda y /employees/agenda/team, con detalle propio/equipo por assignmentId y enlaces Shell dedicados. No enviar al mecánico al CRUD administrativo como página inicial de agenda. Reutilizar NG-ALAIN/NG-ZORRO y SessionPort.requestBusiness, sin getter de token ni nuevo almacenamiento persistente.

Filtros de fecha/rango/estado y, para equipo, empleado/prioridad; tabla cronológica con hora de La Paz, orden, vehículo, prioridad, estado y enlace de detalle. Detalle de servicios/observaciones relevantes en ruta autorizada, solo lectura: sin iniciar ejecución, finalizar ni modificar asignaciones.

Estados diferenciados: cargando, vacío autorizado, sin permiso/vínculo, dependencia indisponible, datos cambiados, sin conexión y observación de notificación pendiente. Ante error no mostrar un éxito vacío. Invalidar respuestas obsoletas cuando cambian filtros/subject; limpiar datos al logout/cambio de cuenta; navegación/recarga/deep-link seguros. Fechas civiles sin conversión UTC-medianoche que cambie el día mostrado.

## Direction contract

THESIS: agenda operativa verificable para organizar trabajos, heredada de las pantallas Empleados; el primer vistazo permite ubicar horario, orden y vehículo. OWN-WORLD: conservar tipografía, neutros, acento y componentes NG-ALAIN/NG-ZORRO existentes; prioridades/estados con semántica, no nueva identidad. STORY: consultar alcance autorizado → filtrar día/rango → leer trabajo → abrir detalle; cualquier falla se distingue de vacío. FIRST VIEWPORT: título y alcance, filtros alineados, zona/última comprobación y tabla cronológica; principal acción Consultar, sin botones de ejecución. FORM: extensión precisa del área Empleados, code-led Operate; no torneo de conceptos ni rediseño global. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

La extensión conserva el sistema incumbente sin reescribir DESIGN.md; inspección desktop/mobile en una ronda agrupada y como máximo una confirmación posterior, detector final y revisión visual independiente con evidencia real. No se requieren rasters nuevos ni claims ilustrativos en datos empresariales.

### [S2.7] Aceptación y cierre

Pruebas focales de dominio/repositorios/HTTP/BFF/UI y regresión de las fronteras afectadas. Integración con dos mecánicos distintos y un jefe, todos vinculados a empleados activos/roles reales, trabajos creados mediante CU15 real. No usar tokenFor(mecanico) compartido como sustituto de dos identidades.

| Escenario | Evidencia exigida |
| --- | --- |
| Propia A/B y detalle | Cada identidad ve solo su trabajo, servicios/observaciones/vehículo/horario/prioridad sin datos administrativos |
| Equipo | Jefe vinculado consulta ambos, filtros y detalle; retirar permiso impide lectura aunque posea permisos generales |
| IDOR y filtros | IDs ajenos/employeeId/scope alterados por REST/GraphQL, alias/peticiones directas/listado/detalle no revelan datos |
| Identidad | Inactivo/no vinculado/sin permiso/subject anterior no obtiene datos con JWT todavía válido según política vigente |
| Consistencia | Reserved, confirmación local sin cierre global y released por compensación no aparecen; global real sí; demora de Inbox explicitada |
| Disponibilidad | Caída real del propietario aislado muestra error, no sin trabajos; recuperar restaura lectura |
| Calendario/UI | Rango La Paz, borde UTC y timezone navegador distinto, vacíos, recarga, logout y desktop/mobile |

No repetir la matriz completa CU15 si su lógica no cambia. El cambio de transporte de la entrega Docker requiere un smoke real proporcional de recuperación/publicación, no acreditar los PASS históricos como arranque nuevo. Revisión independiente después de terminar verificaciones; resolver hallazgos, actualizar STATUS/contratos/decisión/traspaso y publicar main/work/marcelo normalmente, verificando refs.

## [S3] Out of Scope

Offline/Flutter, lectura humana de notificaciones, CU16/CU17, cancelación/reasignación de trabajos, permisos generales como atajo, nuevas proyecciones sin necesidad, acceso SQL cruzado o nuevas transiciones inventadas. Infraestructura integral se documenta por separado en local-compose-demo.md; no se declara el resto del parcial implementado.

## Tasks

- [x] T1: Contratos/permisos y decisiones — acceptance: diseño aprobado, APIs/DTO/errores/alcances publicados y catálogo aditivo (covers: S2.1–S2.5).
- [x] T2: Empleados — acceptance: contexto por subject y lecturas mínimas con vínculo/permisos actuales, pruebas de aislamiento (depends: T1; covers: S2.1–S2.3).
- [x] T3: Operaciones — acceptance: agenda propia/equipo y detalle con prueba global y validación E, sin acceso general ni falsas listas vacías (depends: T1, T2; covers: S2.2–S2.4).
- [x] T4: BFF — acceptance: SDL/política/gateways/errores y pruebas de campos/datos permitidos (depends: T1, T2, T3; covers: S2.5).
- [x] T5: UI/Shell — acceptance: consulta/detalle/estados/recarga/datos La Paz en diseño existente, sin acciones de ejecución (depends: T4; covers: S2.6).
- [x] T6: Integración real y regresión — acceptance: matriz S2.7 con A/B/jefe y CU15 real, sin repetir Saga completa injustificadamente (depends: T2, T3, T4, T5; covers: S2.7).
- [ ] T7: Revisión/cierre — acceptance: revisión resuelta, STATUS/contratos/evidencia/traspaso y refs publicadas por push normal (depends: T6; covers: S2.7).

## Journey log

- Revisión inicial no aprobatoria: F1 bloqueaba roles personalizados antes de autorización; G1 no aislaba retiro de team; G2 sin canal de píxeles. Corrección de sesión/guard y, tras fallo real, del verificador JWT del BFF; roles son metadatos, permisos siguen en propietarios. Regresiones rojo→verde, 32 sesión/rutas, 128 BFF unidades y 34 HTTP, tipos/build/lint verificados.
- Control real a03d36aa-f29c-4ece-8b54-15c5a2fed7bf (review-custom-real-04.exit=0): rol personalizado sin nombres iniciales, navegador/montaje/recarga/teclado, retiro solo de team conservando self/general, denegaciones propietarios/BFF con tokens anterior/nuevo; cero trabajos nuevos y control inactivado. Fallos01–03 conservados. Re-revisión independiente general-44 cierra F1/G1; **G2 permanece bloqueante** porque la apertura de PNG solo devuelve texto, no píxeles. No acreditar foco visible ni conformidad visual desde logs.

- Integración real confirmó los límites de privacidad con dos mecánicos y un jefe distintos/vinculados, trabajos por CU15 y pruebas REST/BFF/UI; no se ejecutó matriz completa de Saga porque su lógica no cambió.
- El harness necesitó acotar selectores al microfrontend y evitar recargas documentales entre filtros; diferencias ICU/NBSP no eran fechas erróneas. Se unificó el reloj a h23 con regresión y una confirmación visual del batch.
- Inactividad descubrió un defecto real anterior a execute GraphQL: BusinessError403 se convertía en503. Repro real rojo sin datos, nueve regresiones sintéticas, saneamiento tipado y dos controles nuevos green; sin reactivar usuarios ni persistir JWT.
- Un ejecutor se detuvo por SQLiteError interno de la herramienta; el principal completó directamente identity green y postcheck. Fallos conservados. Revisión independiente pendiente antes del cierre/publicación.
