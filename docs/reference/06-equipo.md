# 06 — Equipo, dificultad, ICONIX y plan de entrega
Fuente: https://app.notion.com/p/4032585d73c1813ebbeaf61189894334?pvs=204
Copia local exportada el 2026-10-25. Revisar vigencia en Notion antes de cambiar decisiones; estados/relaciones propuestos no son aprobaciones.

## Distribución acordada

Los códigos se conservan exactamente como en el chat final. Los 34 puntos por bloque representan dificultad estimada, no horas equivalentes. No hay nombres confirmados para los tres bloques.

## Bloque 1: operaciones y empleados

Integrante 1: 11 casos y 34 puntos estimados. Responsable del núcleo operativo, Empleados y coordinación de Saga. Establecerá los contratos iniciales del Shell, autenticación y base móvil con colaboración del equipo.

| Código | Caso de uso | Iniciador | Dificultad / puntos |
| --- | --- | --- | --- |
| CU01 | Iniciar sesión | Empleado | Media / 3 |
| CU02 | Administrar roles y permisos | Administrador | Media / 3 |
| CU03 | Gestionar empleados | Administrador | Baja / 2 |
| CU04 | Gestionar horarios y disponibilidad | Administrador / Jefe | Media / 3 |
| CU05 | Consultar agenda de trabajos asignados | Mecánico | Baja / 2 |
| CU10 | Gestionar citas de servicio | Recepcionista | Alta / 4 |
| CU11 | Recepcionar e inspeccionar vehículo | Recepcionista | Media / 3 |
| CU12 | Crear orden de trabajo | Recepcionista | Media / 3 |
| CU15 | Confirmar servicio y asignar mecánico | Jefe de taller | Muy alta / 5 |
| CU16 | Registrar ejecución, avances y evidencias | Mecánico | Alta / 4 |
| CU17 | Verificar y finalizar orden de trabajo | Jefe de taller | Baja / 2 |
|  | TOTAL | Integrante 1 | 34 puntos |

## Bloque 2: clientes, finanzas y offline

Integrante 2: 12 casos y 34 puntos estimados. Responsable de clientes/vehículos, Finanzas, integración de IA local y Sincronización. Consumirá los modelos exportados por el integrante 3 y coordinará contratos GraphQL/REST.

| Código | Caso de uso | Iniciador | Dificultad / puntos |
| --- | --- | --- | --- |
| CU06 | Gestionar clientes | Recepcionista | Baja / 2 |
| CU07 | Gestionar vehículos | Recepcionista | Baja / 2 |
| CU08 | Consultar historial de servicios de un vehículo | Personal autorizado | Baja / 2 |
| CU09 | Gestionar catálogo de servicios automotrices | Administrador | Baja / 2 |
| CU13 | Elaborar cotización de servicio | Responsable financiero | Media / 3 |
| CU14 | Registrar aprobación o rechazo de cotización | Recepcionista | Baja / 2 |
| CU18 | Registrar entrega de vehículo | Recepcionista | Baja / 2 |
| CU19 | Registrar cobro de servicio | Responsable financiero | Media / 3 |
| CU20 | Registrar gastos operativos | Responsable financiero | Baja / 2 |
| CU21 | Consultar indicadores empresariales | Administrador | Alta / 4 |
| CU22 | Realizar inspección visual mediante IA local | Mecánico | Muy alta / 5 |
| CU27 | Sincronizar operaciones realizadas offline | Empleado / reconexión | Muy alta / 5 |
|  | TOTAL | Integrante 2 | 34 puntos |

## Bloque 3: IA, MCP y automatización

Integrante 3: 8 casos y 34 puntos estimados. Responsable de Inteligencia, modelos, agentes internos, MCP independiente, n8n y reportes. Preparará modelos web/móvil y contratos de integración externa.

| Código | Caso de uso | Iniciador | Dificultad / puntos |
| --- | --- | --- | --- |
| CU23 | Analizar imágenes mediante IA del servidor | Mecánico | Muy alta / 5 |
| CU24 | Estimar duración de servicios mediante ML | Jefe de taller | Muy alta / 5 |
| CU25 | Consultar asistente empresarial inteligente | Empleado autorizado | Muy alta / 5 |
| CU26 | Generar reportes inteligentes | Administrador | Alta / 4 |
| CU28 | Ejecutar automatizaciones empresariales | Administrador / n8n | Media / 3 |
| CU29 | Consultar información mediante MCP | Cliente MCP externo | Alta / 4 |
| CU30 | Solicitar operaciones empresariales mediante MCP | Cliente MCP externo | Muy alta / 5 |
| CU31 | Administrar acceso de clientes MCP externos | Administrador | Media / 3 |
|  | TOTAL | Integrante 3 | 34 puntos |

## Tareas compartidas y dependencias

Los 102 puntos expresan dificultad funcional inicial, no horas equivalentes ni carga total. Infraestructura, integración y entrenamiento deberán estimarse aparte. No se esperará a que un bloque esté terminado: los contratos y ejemplos permitirán avanzar en paralelo y luego reemplazar adaptadores simulados por servicios reales.

| Componente | Responsable inicial | Colaboración |
| --- | --- | --- |
| Shell y autenticación | Integrante 1 | Los tres integran rutas, permisos y sesión. |
| REST y GraphQL | Integrante 2 | Los tres acuerdan DTO, errores y versiones. |
| Saga y RabbitMQ | Integrante 1 | Integrante 2 implementa Finanzas; ambos prueban fallos. |
| Amazon S3 | Integrante 1 | Integrante 3 integra análisis; integrante 2, cargas pendientes. |
| Flutter y navegación | Integrante 1 | Integrante 2 integra persistencia e IA local. |
| Entrenamiento y exportación | Integrante 3 | Integrante 2 verifica ejecución web/Android. |
| Sincronización | Integrante 2 | Los tres adaptan reglas, versiones e idempotencia. |
| Docker y despliegue | Equipo | Variables, bases y dependencias reproducibles. |
| ICONIX y pruebas | Equipo | Cada autor modela y verifica sus CU; revisión conjunta. |

Dependencias críticas: CU15 necesita reserva de horario y validación de la cotización; CU22 necesita modelo, clases y preprocesamiento versionados; CU27 necesita contratos idempotentes y carga S3; CU29–CU31 necesitan las APIs propietarias, no CU25. El equipo revisará conjuntamente el dominio Empleado, Cliente, Vehiculo, Cita, Servicio, OrdenTrabajo, Cotizacion, Cobro, Inspeccion y Evidencia.

## ICONIX

El desarrollo seguirá ICONIX con trazabilidad entre requisitos, casos de uso, robustez, secuencias, clases y pruebas. El análisis de robustez identificará boundary, control y entity; componentes y despliegue describirán la arquitectura distribuida. Se planifican cuatro semanas desde el 13 de octubre, con entrega el 10 de noviembre de 2026. Los artefactos se completarán junto con cada caso de uso. Cada requisito se vinculará con CU01–CU31, entidades del dominio, robustez, secuencias y clases. CU15 modelará éxito, rechazo financiero, timeout y compensación; CU27 cubrirá captura offline, reintentos y conflictos. CU29–CU31 se documentarán separados de CU25. Componentes y despliegue complementarán ICONIX. Requisitos → casos de uso → modelo de dominio → robustez (boundary, control, entity) → secuencias → clases → implementación y pruebas. No se crearán relaciones include/extend solo porque un CU ocurra antes que otro. CU22/CU23 pueden extender opcionalmente la recepción; consultar disponibilidad no equivale a CU04 Administrar horarios.

## Calendario de referencia

| Periodo | Trabajo principal | Entregable verificable |
| --- | --- | --- |
| 13-19 octubre | Requisitos y viabilidad. | Dominio, casos de uso, contratos, Shell y servicios base; prueba del dataset y exportación del modelo local. |
| 20-26 octubre | Proceso distribuido. | Órdenes, empleados y cotizaciones; Saga, Outbox y captura offline. |
| 27 oct.-2 nov. | IA e integración. | ML evaluado, IA local y remota, sincronización, agentes internos, MCP externo y n8n. |
| 3-9 noviembre | Pruebas y cierre. | Fallos, reintentos, concurrencia, permisos, reportes y ensayo; documentación final. |
| 10 noviembre | Entrega. | Presentación de la plataforma y documentación del segundo parcial. |

Los períodos son la planificación original, no avances verificados. Fecha de corte: <date start="2026-10-24" />. Entrega: <date start="2026-11-10" />.

## Criterios de aceptación

La evidencia incluirá sesión única Angular/React; arranque offline de PWA; IA local web/Android; análisis remoto con S3/MongoDB; sincronización mediante DynamoDB; concurrencia de horarios y Saga de tres servicios; métricas ML/DL; agentes con MCP detenido; cliente MCP externo y revocación; n8n; reporte por texto/audio y pruebas de acceso restringido.

## Secuencia de integración

1. Acordar estados, DTO, permisos, idempotencia y contratos REST/GraphQL.
2. Completar catálogo, cliente/vehículo, orden, disponibilidad y cotización.
3. Integrar CU15 y probar rechazo, timeout, concurrencia y reinicio.
4. Integrar modelo local, S3, MS05 y conflictos offline.
5. Completar análisis remoto, agentes internos, MCP externo, n8n y reportes.
6. Ensayar la demostración y vincular cada evidencia a requisito y CU.

## Control de avance

No se marcarán CU como terminados hasta disponer de implementación y prueba. Infraestructura y modelos se estimarán aparte de los 102 puntos. Cada responsable mantendrá diagramas y pruebas de sus CU y revisará los contratos compartidos con el equipo.

