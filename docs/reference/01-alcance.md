# 01 — Alcance, actores y matriz de requisitos
Fuente: https://app.notion.com/p/4032585d73c1814cb817f1aa7645c0de?pvs=204
Copia local exportada el 2026-10-25. Revisar vigencia en Notion antes de cambiar decisiones; estados/relaciones propuestos no son aprobaciones.

## Alcance vigente

AutoNexus AI será una plataforma inteligente para un único taller dedicado a servicios automotrices. Integrará empleados, clientes, vehículos, citas, órdenes, finanzas e inteligencia artificial mediante aplicaciones web y móvil. Las inspecciones podrán continuar sin conexión y sincronizarse posteriormente. El proyecto corresponde al segundo parcial de Ingeniería de Software II y será desarrollado por tres integrantes. El taller necesita relacionar el historial del vehículo, las observaciones del mecánico, la disponibilidad del personal y las cotizaciones de servicios. La información fragmentada dificulta planificar citas, distribuir trabajos y controlar ingresos y gastos. La plataforma abordará también los cortes de conexión y las operaciones duplicadas. No administrará inventario ni venta de productos.

## Objetivo

Desarrollar una plataforma distribuida para gestionar los servicios de un taller automotriz, coordinando citas, empleados, órdenes y cotizaciones, con inspección mediante IA local sin conexión, sincronización posterior, agentes empresariales, automatización, reportes e integración externa mediante MCP.

## Límites y usuarios

El alcance se limita a un taller, sin sucursales, administración multiempresa, inventario ni venta de productos. Los actores humanos serán Administrador, Recepcionista, Mecánico, Jefe de taller y Responsable financiero. Una persona podrá asumir varios roles autorizados. Los clientes se registrarán como destinatarios del servicio, sin una cuenta propia en el MVP; el personal registrará sus citas y decisiones sobre cotizaciones. Los cobros serán por servicios y se demostrarán mediante registros y comprobantes internos. Proceso principal: cliente y vehículo → cita y recepción → inspección → orden → cotización y decisión del cliente → confirmación y asignación del mecánico → ejecución y verificación → cobro y entrega.

## Módulos

| Módulo | Operaciones incluidas en el alcance | Responsable |
| --- | --- | --- |
| Acceso y seguridad | Sesión única, roles y permisos del personal. | Keycloak y APIs |
| Empleados | Personal, especialidades, turnos, disponibilidad y asignaciones. | Empleados |
| Clientes y vehículos | Clientes, vehículos e historial de atención. | Operaciones |
| Servicios automotrices | Catálogo de servicios, citas, recepción, órdenes, avances y entrega. | Operaciones |
| Finanzas | Cotizaciones, decisiones, cobros por servicios, gastos e indicadores. | Finanzas |
| Inteligencia | Inspección local y remota, estimación ML, agentes y reportes. | Clientes e Inteligencia |
| Integración transversal | Sincronización, n8n e interoperabilidad MCP externa. | Sincronización, n8n y MCP |

## Actores humanos

| Actor | Responsabilidad | Acceso previsto |
| --- | --- | --- |
| Administrador | Personal, permisos, servicios e integraciones. | Administración autorizada; puede acumular otros roles. |
| Recepcionista | Clientes, vehículos, citas, recepción y entrega. | Atención y registro de la decisión del cliente. |
| Mecánico | Agenda, inspecciones, avances y evidencias. | Órdenes asignadas y funciones técnicas permitidas. |
| Jefe de taller | Planificación, asignación, supervisión y cierre. | Disponibilidad, control técnico y confirmación CU15. |
| Responsable financiero | Cotizaciones, cobros, gastos e indicadores. | Información y operaciones financieras autorizadas. |

Un empleado puede acumular roles autorizados. El cliente no tiene login propio en el MVP. Keycloak, S3, n8n y el cliente MCP externo se modelarán según el límite del diagrama; los servicios internos y las bases no son actores externos.

## Reglas base

Cada API verificará identidad, rol, acción y acceso al registro. El mecánico consultará sus trabajos autorizados; los permisos financieros y de administración de integraciones estarán restringidos a sus responsables. Un mecánico no podrá tener reservas de horario incompatibles. La concurrencia y los reintentos no generarán asignaciones duplicadas ni superpuestas para el mismo intervalo. La orden se confirmará con cotización aprobada vigente y disponibilidad del mecánico reservada. Una modificación del contenido o importe de la cotización exigirá una nueva aprobación. Las inspecciones conservarán autor, fecha, versión del modelo y revisión humana. Los resultados de IA serán orientativos y auditables.

## Matriz de requisitos y aplicación

| Requisito | Ubicación y evidencia prevista |
| --- | --- |
| Plataforma integrada | Shell web, aplicaciones independientes, móvil e integraciones sobre un proceso común. |
| Microservicios: mínimo tres | Cinco microservicios: Operaciones, Empleados, Finanzas, Inteligencia y Sincronización. |
| Spring Boot / NestJS / PHP | Operaciones / Empleados y Sincronización / Finanzas. FastAPI para Inteligencia. |
| Angular y React | Dos microfrontends Angular y dos React, montados por single-spa. |
| Shell | single-spa: navegación y montaje de los microfrontends. |
| PostgreSQL | Bases independientes de Operaciones, Empleados y Finanzas. |
| MongoDB | Inspecciones inteligentes, predicciones y metadatos de Inteligencia; imágenes en S3. |
| DynamoDB | Operaciones, versiones, estados y cursores del servicio de Sincronización. |
| GraphQL empresarial | Consultas y mutations de la gestión web a través del componente de integración. |
| APIs REST | Móvil, servicios internos y adaptadores MCP; carga autorizada de archivos en S3. |
| Acceso único / SSO | Keycloak y roles comunes; navegación web sin nuevos inicios de sesión. |
| DDD | Contextos de negocio, agregados y reglas documentadas y codificadas. |
| Arquitectura hexagonal | Puertos y adaptadores de persistencia, APIs y mensajería. |
| Clean Architecture / Code | Casos de uso independientes y responsabilidades delimitadas. |
| Transacción transversal | CU15: confirmar servicio con reserva de mecánico y cotización vinculada. |
| Saga y recuperación | Compensar una falla, recuperar un timeout y reintentar compensaciones. |
| IA local web y móvil | Modelo visual ejecutado con TensorFlow.js y LiteRT. |
| Operación offline | Inspección y consulta de datos descargados en web y móvil. |
| Sincronización | CU27: MS05 coordina colas, versiones y conflictos; el propietario aplica reglas e idempotencia. |
| Idempotencia | Reenviar sin duplicar orden, cotización, asignación ni inspección. |
| ML supervisado | Estimación de duración de servicios y evaluación del error. |
| ML no supervisado | Agrupación de vehículos e interpretación de patrones. |
| Deep learning / TensorFlow | Clasificación de imágenes con dataset y evaluación documentados. |
| Agentes inteligentes | CU25: planificación, operación, finanzas y reportes por APIs internas; independientes de MCP. |
| Protocolo MCP | CU29–CU31: servidor separado, clientes externos compatibles, alcances y revocación. |
| Automatización n8n | Citas/mantenimiento, entrega, asignación, cotizaciones y reporte semanal. |
| Reportes generativos | Solicitud por texto/audio y salida con datos y explicación. |
| Seguridad | Autorización por rol y registro, archivos privados S3 y límites de acceso MCP. |
| Metodología ICONIX | Requisitos, dominio, casos de uso, robustez, secuencia y pruebas. |
| Amazon S3 | Objetos privados, referencias en bases y carga autorizada para fotos/evidencias. |
| PWA instalable | Manifiesto, service worker, caché de Shell/microfrontends/modelo e IndexedDB. |
| IA remota | CU23: TensorFlow en FastAPI, imágenes S3 y predicciones/metadatos MongoDB. |

## MVP demostrable

Recepción registrará cliente, vehículo, cita y orden. El mecánico inspeccionará desde PWA o Flutter, ejecutará IA local y guardará sin conexión. MS05 coordinará el envío de evidencias a S3 y cambios a sus propietarios sin duplicados. Finanzas elaborará la cotización y el personal registrará la decisión del cliente; el Jefe de taller solicitará confirmar y asignar. CU15 reservará el horario en Empleados, validará y vinculará la cotización en Finanzas y confirmará en Operaciones. Se registrarán avances, verificación, cobro por servicio y entrega. Los agentes internos analizarán operación y finanzas; un cliente MCP externo consultará o solicitará una cita por separado. n8n y un reporte completarán el escenario. El alcance consolidado comprende 31 casos de uso, cinco microservicios, BFF, Shell con cuatro microfrontends, PWA, Flutter Android, PostgreSQL/MongoDB/DynamoDB, S3, SSO, Saga, IA local y remota, ML, agentes, MCP independiente, n8n y reportes. Se acotará profundidad de pantallas y modelos, manteniendo evidencia de cada requisito. La sección 19 distribuye los casos entre tres integrantes. Quedan fuera inventario, repuestos, venta de productos, múltiples talleres, facturación fiscal, pagos reales y contabilidad completa. El aprendizaje visual cubrirá clases delimitadas y revisión humana, no diagnóstico universal. El reentrenamiento controlado y el modelo generativo local seguirán como ampliaciones o asuntos por confirmar con el docente. **Estado:** diseño acordado o propuesto, según su fuente; implementación pendiente de comprobar con repositorio y evidencias.

