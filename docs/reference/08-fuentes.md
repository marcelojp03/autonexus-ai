# 08 — Fuentes, decisiones vigentes y pendientes
Fuente: https://app.notion.com/p/4032585d73c181d19ec1eb1b099b6f78?pvs=204
Copia local exportada el 2026-10-25. Revisar vigencia en Notion antes de cambiar decisiones; estados/relaciones propuestos no son aprobaciones.

## Orden de precedencia

1. Decisiones explícitas del chat compartido aportado por Marcelo el <date start="2026-10-24" />.
2. Requisitos del docente transcritos en esta conversación y fecha corregida al <date start="2026-11-10" />.
3. Detalles técnicos anteriores solo cuando son compatibles con el nuevo alcance.
4. Recomendaciones de implementación y estimaciones, identificadas como tales.

## Fuente de las decisiones

[Chat completo — Propuesta plataforma automotriz](https://chatgpt.com/share/6ad803e4-d0ec-83e9-a4b2-0986929663d9). Se conservaron los 31 CU detallados y el reparto de 34 puntos por integrante. El catálogo y los flujos siguen siendo una línea base para robustez, secuencias y reglas de negocio.

## Antecedente documental

[Propuesta preliminar anterior en Google Docs](https://docs.google.com/document/d/1RL-MCWPqw7WK_7P7f_UibfgyKU6Lk2WqAw9aXU1QrKk). Se restauró al estado previo a esta consolidación. Contiene decisiones superadas (inventario, multiempresa, cuatro microservicios y MCP dentro de Inteligencia); para implementación prevalece este Notion.

## Cambios que deben evitar regresiones

| Antes | Decisión vigente |
| --- | --- |
| Varios talleres / aislamiento por organización | Un solo taller; autorización por rol, asignación y registro. |
| Inventario y reserva de repuestos | Empleados y reserva de horario del mecánico. |
| DynamoDB para indicadores de Inteligencia | DynamoDB para Sincronización. |
| MongoDB de Inventario | MongoDB para resultados y metadatos de Inteligencia. |
| MCP alojado en agentes/Inteligencia | Servidor MCP independiente para clientes externos. |
| Almacenamiento genérico o MinIO | Amazon S3. |
| Seis CU prioritarios con numeración provisional | CU01–CU31 del chat final; Saga CU15 y sincronización CU27. |

## Reglas pendientes del taller

- [ ] Definir estados y transiciones de cita, orden y cotización.
- [ ] Fijar duración, vencimiento y liberación de reservas de horario.
- [ ] Definir cancelación, reprogramación y reasignación.
- [ ] Establecer evidencia de aprobación del cliente y su vinculación a versión de cotización.
- [ ] Precisar condiciones de cobro y entrega; no desarrollar crédito sin una decisión de alcance.
- [ ] Definir permisos de cada rol y vigencia del acceso local offline.
- [ ] Definir resolución de conflictos y conservación de evidencias pendientes.
- [ ] Confirmar nombres de los integrantes responsables de los tres bloques.

## Preguntas para el docente

- [ ] ¿IA local visual en web y móvil cubre el requisito o también se exige un modelo generativo local?
- [ ] ¿Se exige reentrenamiento/autoaprendizaje o basta entrenamiento, evaluación e inferencia demostrables?
- [ ] ¿Se exige aprendizaje supervisado y no supervisado por separado? El plan conserva una propuesta de agrupación exploratoria, pero debe confirmarse su obligatoriedad.
- [ ] ¿Se requiere un tercer framework frontend además de Angular y React?
- [ ] ¿Se acepta DynamoDB Local para el ensayo o se exige AWS?
- [ ] ¿GraphQL para la gestión web con REST móvil/interno cumple la interpretación del requisito?
- [ ] ¿Qué evidencia se espera de MCP: un cliente externo compatible, alcance, consulta, solicitud y revocación?

## Datos y modelos por validar

- [ ] Dataset visual: licencia, categorías, cantidad y separación por vehículo/origen.
- [ ] Datos para estimación de tiempos y evaluación contra una referencia simple.
- [ ] Medir exportación, compatibilidad, tamaño y latencia web/Android; no prometer valores aún no comprobados.
- [ ] Identificar datos sintéticos y distinguirlos de evidencia real del taller.

## Referencias técnicas de apoyo

| Fuente | Uso |
| --- | --- |
| \[1\] GraphQL Foundation. Mutations. | [Documentación](https://graphql.org/learn/mutations/) |
| \[2\] AWS. Saga orchestration pattern. | [Documentación](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html) |
| \[3\] TensorFlow. Save and load models (TensorFlow.js). | [Documentación](https://www.tensorflow.org/js/guide/save_load) |
| \[4\] Google AI Edge. LiteRT. | [Documentación](https://developers.google.com/edge/litert) |
| \[5\] Model Context Protocol. Architecture overview. | [Documentación](https://modelcontextprotocol.io/docs/learn/architecture) |
| \[6\] Sparx Systems. ICONIX. | [Documentación](https://sparxsystems.com/enterprise_architect_user_guide/17.0/modeling_domains/iconix_process.html) |
| \[7\] TensorFlow. Transfer learning and fine-tuning. | [Documentación](https://www.tensorflow.org/tutorials/images/transfer_learning) |
| \[8\] MongoDB. Transactions. | [Documentación](https://www.mongodb.com/docs/manual/core/transactions/) |
| \[9\] MDN. Making PWAs installable. | [Documentación](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) |
| \[10\] MDN. Offline and background operation. | [Documentación](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation) |
| \[11\] TensorFlow.js. Platform and environment. | [Documentación](https://www.tensorflow.org/js/guide/platform_environment) |
| \[12\] n8n. Webhook node. | [Documentación](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/) |

## Uso de este espacio

Este Notion es el contexto de trabajo para continuar análisis, planificación e implementación. Actualizar evidencia y decisiones aquí; modificar el Google Docs solo cuando Marcelo lo pida expresamente. No se ha ejecutado una implementación de la plataforma durante esta consolidación.

