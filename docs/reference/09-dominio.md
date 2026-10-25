# 09 — Modelo de dominio compartido y reglas para ICONIX
Fuente: https://app.notion.com/p/4042585d73c181b69788feeab972762d?pvs=204
Copia local exportada el 2026-10-25. Revisar vigencia en Notion antes de cambiar decisiones; estados/relaciones propuestos no son aprobaciones.

## Propósito y estado

Modelo conceptual compartido de AutoNexus AI para iniciar el análisis de robustez de ICONIX. Conserva el reparto acordado de los tres integrantes. Describe conceptos del taller; no es todavía un esquema de base de datos ni un diagrama de clases de implementación. **Estado:** propuesta de diseño para revisión del equipo. Los estados, cardinalidades y restricciones indicados como propuestos no se presentan como acuerdos ya aprobados.

## Entidades y responsabilidad funcional

| Concepto | Significado y responsabilidad | Bloque principal |
| --- | --- | --- |
| Cliente | Persona que solicita y autoriza servicios; no requiere cuenta de acceso en el MVP. | 2 |
| Vehículo | Vehículo registrado y su historial de atención. | 2 |
| Empleado | Personal del taller, especialidades y estado laboral. | 1 |
| Especialidad | Capacidad técnica que habilita a un mecánico para determinados servicios. | 1 |
| Jornada / disponibilidad | Intervalos de trabajo y ausencias que delimitan cuándo puede asignarse un empleado. | 1 |
| Servicio | Prestación ofrecida por el taller, con descripción y duración referencial. | 2; datos de Operaciones |
| Cita | Solicitud de atención para un vehículo y un horario. No equivale por sí sola a una reserva definitiva de mecánico. | 1 |
| Recepción | Registro de ingreso y condiciones iniciales del vehículo. | 1 |
| Orden de trabajo | Expediente operativo de los trabajos solicitados, ejecución y cierre. | 1 |
| Trabajo de la orden | Servicio concreto solicitado para esa orden, con observaciones y alcance. | 1 |
| Cotización | Oferta versionada de servicios e importes vinculada a una orden. | 2 |
| Decisión de cotización | Evidencia de aprobación o rechazo del cliente sobre una versión específica. | 2 |
| Reserva de horario | Retención provisional de un intervalo de un mecánico durante CU15. | 1 |
| Asignación | Vinculación confirmada entre una orden, un mecánico y un intervalo. | 1 |
| Avance | Registro de ejecución realizado por un mecánico autorizado. | 1 |
| Inspección | Observaciones manuales o asistidas y revisión humana del vehículo. | 2 integra local; 3 analiza remoto |
| Resultado de análisis | Predicción original, puntuaciones, versión de modelo y validación/corrección humana. | 3; integración local del bloque 2 |
| Evidencia | Fotografía o documento asociado a recepción, orden, avance o inspección. | Compartido |
| Cobro | Registro de un importe recibido por un servicio y su comprobante interno. | 2 |
| Gasto operativo | Egreso registrado del taller, independiente de un inventario. | 2 |
| **Distinción:** responsabilidad del desarrollador no equivale a propiedad técnica del dato. Por ejemplo, el bloque 2 desarrolla clientes y vehículos, pero sus datos pertenecen a MS01 Operaciones. |  |  |

## Relaciones propuestas

| Relación | Cardinalidad inicial | Regla o asunto por confirmar |
| --- | --- | --- |
| Cliente — Vehículo | Un cliente tiene varios vehículos; cada vehículo tiene un cliente responsable actual. | Cambios de propietario e historial de titularidad quedan fuera del MVP salvo acuerdo. |
| Vehículo — Cita | Un vehículo puede tener varias citas a lo largo del tiempo. | Validar citas activas incompatibles. |
| Vehículo — Orden | Un vehículo puede tener varias órdenes; cada orden corresponde a un vehículo. | El historial reúne sus atenciones. |
| Cita — Recepción | Una recepción puede provenir de una cita o de atención sin cita autorizada. | La política de inasistencia/reprogramación sigue pendiente. |
| Recepción — Orden | Una orden se abre desde una recepción válida. | Propuesta de MVP: una orden principal por recepción. |
| Orden — Trabajo | Una orden contiene uno o varios trabajos; cada trabajo referencia un servicio del catálogo. | Conservar el alcance histórico aunque cambie el catálogo. |
| Orden — Cotización | Una orden puede tener varias versiones de cotización. | Solo una versión vigente para la confirmación. |
| Cotización — Decisión | Una versión conserva evidencia de la decisión registrada por el personal. | Cambiar contenido o importe exige nueva aprobación. |
| Empleado — Reserva | Un mecánico puede tener varias reservas en el tiempo. | Sin intervalos incompatibles con reservas activas/asignaciones. |
| Orden — Asignación | Propuesta de MVP: una asignación principal activa por orden. | Múltiples mecánicos y reasignación requieren regla explícita; conservar historial. |
| Orden — Avance | Una orden tiene varios avances, con autor y fecha. | El autor debe estar autorizado. |
| Inspección — Resultado | Una inspección puede tener resultados de distintos análisis. | Conservar predicción y revisión, sin sobrescribir el resultado original. |
| Evidencia — Registro | Una evidencia referencia el registro al que pertenece. | Acceso autorizado y carga terminada antes de confirmar su referencia remota. |
| Orden — Cobro | Una orden puede tener registros de cobro asociados. | Definir si se admiten pagos parciales; no asumir crédito o reembolsos. |

## Reglas comunes ya derivadas del alcance

1. Un solo taller, servicios automotrices, sin inventario ni venta de productos.
2. El personal registra la decisión del cliente; no se necesita un portal de clientes.
3. CU15 confirma una orden con cotización aprobada vigente y disponibilidad reservada del mecánico.
4. La concurrencia no debe producir reservas o asignaciones incompatibles.
5. La compensación libera el horario y anula el vínculo financiero creado por la Saga; conserva la cotización y la auditoría.
6. La IA ofrece apoyo visual con revisión humana; no convierte una predicción en diagnóstico definitivo.
7. Una captura offline queda pendiente hasta recibir aceptación del servidor.
8. Los agentes internos y el servidor MCP externo son capacidades independientes.

## Estados propuestos para revisar

| Concepto | Estados iniciales propuestos |
| --- | --- |
| Cotización | Borrador → Pendiente de decisión → Aprobada o Rechazada; una versión sustituida queda histórica. |
| Reserva de horario | Activa → Confirmada o Liberada; vencimiento por definir. |
| Orden | Borrador → Pendiente de confirmación → Confirmada → En ejecución → Pendiente de verificación → Finalizada → Entregada. |
| Operación offline | Pendiente → Enviando → Sincronizada; alternativamente En conflicto o Rechazada. |
| Cancelación, reprogramación y reasignación necesitan transiciones autorizadas específicas. La aprobación financiera, el cierre técnico y la entrega son hechos distintos: una orden técnicamente finalizada no implica que esté cobrada. |  |

## Trazabilidad y contratos que siguen

- **CU15:** Orden, Cotización, Decisión, Empleado, Reserva y Asignación. Siguiente artefacto: robustez y secuencia de éxito, rechazo financiero, timeout y compensación.
- **CU22/CU23:** Inspección, Evidencia y Resultado. Contrato compartido de clases, preprocesamiento y versión del modelo.
- **CU27:** avances, inspecciones y evidencias pendientes; contrato operationId, versión base, dependencias y resultado idempotente.
- **CU29–CU31:** permisos del cliente externo y herramientas MCP que delegan a las APIs; no requieren ejecutar CU25.

## Trabajo siguiente por bloque

| Bloque | Siguiente trabajo verificable |
| --- | --- |
| 1 | Proponer reglas de disponibilidad y reserva; robustez de CU15 y estados de orden. |
| 2 | Proponer versionado/aprobación de cotización y condiciones de cobro/entrega; contrato de sincronización con propietarios. |
| 3 | Validar dataset y un modelo exportable; acordar resultados IA y herramientas MCP independientes. |
| Los tres revisan juntos las relaciones que cruzan sus bloques. El modelo se transformará después en diagramas de robustez y secuencia y luego en clases de diseño; no se requiere terminar los 31 diagramas antes de probar la integración principal. |  |

## Validación pendiente

- [ ] Revisar entidades y relaciones con el equipo.
- [ ] Aprobar o ajustar los estados propuestos.
- [ ] Decidir cardinalidad de asignación, pagos parciales y política de reservas.
- [ ] Diseñar CU15 y acordar sus contratos entre los tres servicios.
- [ ] Registrar implementación y pruebas cuando existan; este modelo no constituye avance de código.

