# Checklist de cumplimiento de AutoNexus AI

Fecha: 2026-11-10. Base inspeccionada: commit `93129e1`, fuentes actuales y evidencia versionada.

Referencia de comparación: documento preliminar de actores, 31 CU y reestructuración del alcance adjuntado por el usuario. No se copia aquí el contenido HTML/CSS incidental del adjunto. Guía de uso: [manual E2E](usuario-e2e.md).

## 1. Dictamen y cómo leer esta revisión

**No está acreditado el cumplimiento íntegro de todo el documento adjunto.** Existe un recorrido operativo online amplio, pero faltan entrega, historial de servicios, indicadores completos, ML de duración y escritura/administración MCP. IA y reportes siguen parciales. La instalación local preparada en esta conversación tiene además dependencias pendientes.

Se separan tres cosas:

1. **Aceptación registrada del núcleo:** clasificación de PLAN/STATUS y evidencias del equipo; no es una prueba nueva hecha al redactar este checklist.
2. **Comparación literal con el adjunto:** flujos, excepciones y ejemplos que pueden exceder ese núcleo aceptado. «Verificado» en el plan no implica conformidad con todas las variantes del texto preliminar.
3. **Disponibilidad local:** lo que se preparó en esta computadora. Una prueba real en otra instalación no habilita aquí S3, modelos, Sync, n8n ni MCP.

| Clasificación registrada | CU | Cantidad |
| --- | --- | ---: |
| Núcleo con aceptación funcional registrada | CU01–CU07, CU09–CU17, CU19, CU20, CU27, CU28 en alcance local configurado, CU29 | 21 |
| Parcial global | CU22, CU23, CU25, CU26 | 4 |
| Sin implementación completa identificada | CU08, CU18, CU21, CU24, CU30, CU31 | 6 |

El total interno es **62/102 puntos**, aproximadamente 60,8 %. No es nota oficial, porcentaje de calidad ni porcentaje de requisitos literales cumplidos. Los parciales no suman puntos. Se toma la consolidación más reciente de PLAN/STATUS: aún sobreviven párrafos históricos con 57 puntos y notas de publicación/visual superadas.

En las tablas siguientes, «no acreditado» significa que falta evidencia suficiente para afirmarlo; no necesariamente que todo ese código esté ausente. Las pruebas sugeridas están **pendientes de ejecutar en esta sesión**. No se crearon clientes, órdenes ni cobros nuevos para redactar los documentos.

## 2. Checklist por caso de uso

| CU | Núcleo registrado | Comparación con el adjunto y límites | Comprobación de aceptación sugerida |
| --- | --- | --- | --- |
| **CU01 — Iniciar sesión** | Verificado | SSO Keycloak/PKCE y autorización de APIs. La copia offline preparada no es un login nuevo con credenciales guardadas ni autoriza indefinidamente. No afirmar que se almacenen contraseñas o JWT offline. | [ ] Ingreso, cambio de módulo, cierre/cambio de cuenta, token inválido, cuenta deshabilitada y operación sin permiso; probar aparte apertura de copia previamente preparada. |
| **CU02 — Roles y permisos** | Verificado | Catálogo, roles/asignaciones, auditoría, prevención de escalamiento y último administrador. Permisos de APIs y vínculo activo son autoridad; el nombre del cargo no lo es. | [ ] Crear rol limitado, asignar/retirar, verificar efecto y denegación; rechazo de escalamiento y protección del último administrador. |
| **CU03 — Empleados** | Verificado | CRUD laboral e identidad vinculada, reintentos, historial y desactivación. Alta de cuenta no entrega automáticamente contraseña ni rol. No hay registro público. | [ ] Alta/edición, duplicado, desactivación conservando historia y cuenta pendiente/fallida; completar credencial por procedimiento separado del IdP. |
| **CU04 — Horarios** | Verificado | Turnos, descansos, ausencias, disponibilidad y reconocimiento de asignaciones existentes. Pantalla por empleado; no acreditar edición masiva por grupo ni reasignación automática por ese reconocimiento. | [ ] Disponibilidad con turno y descanso; ausencia, superposición y cambio que afecte trabajo confirmado. |
| **CU05 — Agenda** | Verificado online | Agenda propia/equipo y detalle autorizado. Offline está acotado a trabajos preparados por la superficie CU27, no a navegar toda la agenda sin red. Revisión visual general pendiente. | [ ] Día con/sin trabajos, cambio de fecha, aislamiento entre mecánicos y agenda de equipo; fecha/actualización de copia offline aparte. |
| **CU06 — Clientes** | Verificado online | Registro/edición/búsqueda y validación. El alta de clientes offline descrita en una excepción del adjunto **no está implementada en la superficie offline vigente**. Cumplimiento literal ampliado: parcial. | [ ] Alta y edición online, duplicados/formatos, denegación; no aprobar alta offline por un test de avances offline. |
| **CU07 — Vehículos** | Verificado | Registro/edición, asociación y trazabilidad de propietarios. «Habilitar historial de servicios» no entrega CU08. No asumir alta móvil/offline general. | [ ] Placa duplicada, cliente inexistente, edición y cambio de propietario con trazabilidad. |
| **CU08 — Historial de servicios** | Pendiente | No hay endpoint e interfaz completos de intervenciones previas, diagnósticos/evidencias por vehículo. Historial de propietarios no satisface este CU. | [ ] Pendiente implementar ficha, consulta de intervenciones y acceso autorizado a evidencias; vacíos y denegaciones. |
| **CU09 — Catálogo** | Verificado | Servicios activos, categorías, duración/tarifa referenciales y desactivación. No inventario. Una duración configurada no acredita CU24. | [ ] Crear/editar/desactivar servicio, tarifas/duraciones inválidas y conservación de referencias históricas. |
| **CU10 — Citas** | Verificado online | Programar/reprogramar/cancelar. La cita no es reserva definitiva de mecánico. El adjunto describe cita provisional offline: no está cubierta por el overlay actual de avances. Cumplimiento literal ampliado: parcial. | [ ] Alta/reprogramación/cancelación, conflictos y motivo; comprobar reglas de capacidad del contrato vigente, sin equipararlas con disponibilidad mecánica de CU15. |
| **CU11 — Recepción** | Verificado en alcance textual | Registro de recepción con vehículo/cliente, cita opcional y condiciones. El flujo opcional de fotos/IA integrado durante recepción y su variante offline **no están acreditados como recorrido completo**; la evidencia actual de IA se basa en ejecución. | [ ] Recepción con/sin cita, datos obligatorios y duplicado; fotos/IA durante recepción requieren aceptación específica. |
| **CU12 — Orden** | Verificado online | Orden desde recepción, servicios, cantidades y prioridad. La creación provisional offline del adjunto no está implementada en la cola vigente. Cumplimiento literal ampliado: parcial. | [ ] Orden única por recepción, servicios activos, cantidades y replay; no marcar aprobada/confirmada por crearla. |
| **CU13 — Cotización** | Verificado | Importes calculados por Finanzas, vigencia, versiones y aprobación inmutable. La tarifa de catálogo es solo referencia. | [ ] Revisiones/versiones, total/descuento y validaciones; rechazar modificación silenciosa de una versión aprobada. |
| **CU14 — Decisión del cliente** | Verificado | Decisión sobre cotización exacta y evidencia. No confirma servicio por sí sola. | [ ] Aprobar/rechazar, evidencia obligatoria, versión/vigencia y repetición; verificar que no inicie ejecución sin CU15. |
| **CU15 — Confirmar servicio** | Verificado | Saga persistida en Operaciones, reserva/confirmación laboral, vínculo de cotización aprobada, compensación y conciliación. El resumen final del adjunto habla de crear cotización preliminar: está superado por el contrato vigente, no debe implementarse ese resumen encima de la Saga actual. Notificación técnica no acredita lectura humana. | [ ] Confirmación global, carrera por orden/franja, fallo participante, respuesta perdida, recuperación y duplicado; solo `confirmed` da éxito. |
| **CU16 — Ejecución y evidencia** | Verificado en alcance contratado | Avances, tiempos y evidencias privadas S3; variante offline específica. No se acredita soporte general de videos por la frase «fotografías o videos permitidos»; el flujo visual vigente usa JPEG/PNG. Localmente faltó configurar S3. | [ ] Propiedad del trabajo, inicio, avance, carga/confirmación/descarga real de evidencia y recuperación sin duplicar; no confundir pendiente con disponible. |
| **CU17 — Verificación** | Verificado | Actividades obligatorias, evidencia disponible, solicitud de revisión, devolución y aprobación. Finaliza técnicamente; no registra entrega física. | [ ] Rechazar actividad/evidencia incompleta, devolver y corregir, aprobar una vez; identidad y versión vigentes. |
| **CU18 — Entrega física** | Pendiente | Falta registrar receptor autorizado, fecha/hora, evidencia, condiciones administrativas y transición de entrega. Ni aprobación técnica ni cobro lo reemplazan. | [ ] Pendiente implementar entrega única, autorización, validación administrativa e historial. |
| **CU19 — Cobros** | Verificado en alcance declarado | Cobro íntegro tras finalización, saldo/recibo, referencias humanas, idempotencia y conciliación. Sin abonos, pasarela ni factura fiscal por decisión vigente. Devoluciones/anulaciones auditadas mencionadas en el adjunto **no están implementadas**; tratar ese requisito como fuera del alcance aceptado o brecha a resolver, nunca como cumplido. | [ ] Saldo, cobro completo y recibo releído; rechazo de parcial, duplicado/referencia no verificada y pérdida de respuesta. Sin confirmación offline. |
| **CU20 — Gastos** | Verificado | Categoría/fecha/medio/importe/responsable, respaldo opcional privado y prevención de duplicados. Proveedor documental local de Finanzas no equivale a S3 productivo. | [ ] Gasto con/sin documento, validación, posible duplicado con intención nueva explícita, filtros y responsable; archivo realmente disponible. |
| **CU21 — Indicadores** | Pendiente | Falta panel consolidado con productividad, tiempos y filtros sobre fuentes propietarias. Resumen financiero y reportes existentes no cierran el CU. Widgets del template no cuentan. | [ ] Pendiente implementar contratos propietarios, agregación GraphQL, filtros, gráficos, vacíos reales y falla parcial explícita. |
| **CU22 — IA local** | Parcial | TFJS web/LiteRT Android, revisión manual independiente y evidencia funcional registradas. Falta cierre global, calidad del modelo y autorización de distribución; no hay garantía diagnóstica. Nueva UX/borradores tiene pendientes separados. | [ ] Modelo/recursos preparados, inferencia real sin internet, identidad del artefacto y revisión separada; modelo ausente, baja salida, error y falta de almacenamiento; evaluar calidad con protocolo propio. |
| **CU23 — IA servidor** | Parcial | FastAPI/TensorFlow, imagen autorizada S3 y resultados MongoDB integrados. Modelo experimental; sin validación global. UI usa evidencia disponible de ejecución: no afirmar carga por lote ni todos los pasos de corrección/incorporación del adjunto. | [ ] Imagen real autorizada, persistencia/relectura, versión y errores; revisar por separado lote y flujo humano, además de calidad visual. |
| **CU24 — Duración ML** | Pendiente | No hay modelo de duración entrenado/evaluado ni flujo completo de predicción/ajuste/trazabilidad. Duración del catálogo no prueba ese modelo. | [ ] Datos históricos autorizados, partición, entrenamiento/evaluación, variables, incertidumbre y ajuste humano; fallback identificado como manual. |
| **CU25 — Asistente** | Parcial | Consultas operativas, fuentes, aclaración/denegación y resumen financiero real. Falta amplitud financiera/administrativa y matriz literal completa. No acreditar cuatro agentes autónomos especializados por existir un servicio de consultas. | [ ] Pregunta con fuentes, período financiero, ambigüedad, permiso, dato ausente, propietario caído e instrucciones maliciosas en datos; no admitir escritura. |
| **CU26 — Reportes** | Parcial | Operativo y financiero separado, trabajos estables y exportación JSON/CSV. Productividad, gráficos y filtros por indicador pendientes; aceptación UI financiera incompleta. El modelo financiero produjo una cifra incorrecta y fue sustituido por plantilla rotulada. | [ ] Métricas contra propietarios, relectura/replay del mismo trabajo, exportación, permisos y fallback; terminar productividad/gráficos antes de afirmar alcance completo. |
| **CU27 — Sync** | Verificado en recorrido acotado | Evidencia real PWA y Android: avances, fotos e inferencia de cliente, reintentos/403. No significa sync de todos los formularios. Conflictos avanzados/multidispositivo no ejercidos. En esta computadora MS05 quedó sin iniciar por el emulador. | [ ] Preparar/reabrir offline, autenticar al volver, replay tras respuesta perdida, carga S3, rechazo conservando evidencia y reintento sin efecto adicional; conflictos avanzados aparte. |
| **CU28 — Automatizaciones** | Verificado en alcance local configurado | Flujos y pruebas con canal local, programación, idempotencia/recuperación y destinatario inexistente. No acredita mensajes externos, cloud, autonomía indefinida ni una UI web general de administración de flujos. Aquí no se preparó n8n. | [ ] Flujo habilitado, evento/cron real, autorización, recibo, duplicado, falla/reintento y destinatario inexistente; reparación previa no se revierte. |
| **CU29 — MCP consulta** | Verificado en catálogo acotado | Proceso separado y seis herramientas sobre órdenes, agenda y ejecución. Los ejemplos `listar_servicios`, historial, indicadores y disponibilidad del adjunto **no son el catálogo entregado**. Si se exigen esas herramientas concretas, el alcance literal no está completo. | [ ] Cliente autorizado, descubrimiento e invocación con SDK, filtrado por scopes/permisos, argumentos cerrados, denegación y auditoría sin secretos. |
| **CU30 — MCP acciones** | Pendiente | No hay herramientas de escritura con confirmación humana y resultado idempotente implementadas. No confundir consulta ni cron con CU30. | [ ] Pendiente implementar acción, autorización por cliente/usuario/registro, confirmación, replay y auditoría. |
| **CU31 — Acceso MCP** | Pendiente | Registro local por archivo no equivale a pantalla/CRUD de altas, modificación, suspensión y revocación con auditoría. | [ ] Pendiente implementar gestión autorizada de clientes y alcances, validación y revocación conforme a vigencia. |

## 3. Actores, alcance y arquitectura

| Requisito del adjunto | Estado / evidencia | Qué no se debe afirmar |
| --- | --- | --- |
| Un taller, sin sucursales ni inventario/venta | Conforme al alcance y servicios inspeccionados | No añadir módulos de productos para explicar cobros |
| Cinco actores humanos | Roles/permisos iniciales y sesiones por empleado; [contrato de permisos](../../contracts/auth/permissions.md) | No reducir el control de acceso a ocultar botones |
| Una persona con varios roles | Asignaciones de CU02 y unión de permisos vigentes | Cargo o especialidad no son roles |
| Clientes sin cuenta obligatoria | Clientes/vehículos son datos operativos, no usuarios del IdP | Alta de cliente no es signup |
| Keycloak, S3, n8n y cliente MCP como sistemas externos | Representados por integraciones separadas y contratos | Activar Compose principal no configura automáticamente las cuatro integraciones |
| Componentes internos no son actores UML del límite global | Criterio correcto del adjunto; hay que revisar los diagramas contra él | No certificar UML de los scripts sin generar/inspeccionar los diagramas |
| Cinco microservicios y propiedad de datos | Operaciones Java/PostgreSQL; Empleados Nest/PostgreSQL; Finanzas Laravel/PostgreSQL; Inteligencia FastAPI/MongoDB; Sync Nest/DynamoDB | Compartir servidor PostgreSQL local no permite consultar bases ajenas |
| BFF sin base de negocio | NestJS ejecuta SDL GraphQL y consume APIs | No coordina CU15 ni reemplaza a propietarios |
| Agentes separados de MCP | `integration/agent` y `integration/mcp-server`, fuente REST independiente de MCP | CU25 no entrega CU30/CU31 ni todas las especializaciones propuestas |
| Agentes/reportes en MS04 según distribución preliminar | **Diferencia documentada de implementación:** inferencia en MS04; asistente/reportes en proceso TypeScript adicional | Si la evaluación exige que residan dentro de FastAPI, requiere acuerdo explícito; no presentar equivalencia literal |
| Cuatro microfrontends y Shell | Angular Empleados/Operaciones; React Finanzas/Inteligencia; single-spa/Shell PWA | Asistente/reportes actuales aparecen en MF Empleados, no exclusivamente en React Finanzas; revisar distribución exigida |
| Móvil Flutter Android | Proyecto, SQLite/LiteRT y evidencia física en repositorio | No acredita instalación/configuración de APK en el teléfono de este usuario |
| Gateway/entrada | Nginx expone web, identidad y adaptaciones permitidas; BFF empresarial | No hay evidencia aquí de un despliegue cloud/API Gateway administrado |

## 4. Tecnologías y reglas transversales

| Checklist | Evaluación y evidencia | Pendiente o condición |
| --- | --- | --- |
| [x] GraphQL para gestión web | Contratos `contracts/graphql`, BFF y `SessionPort.requestBusiness` | Indicadores CU21 y tipos de reporte faltantes no están cubiertos por tener GraphQL |
| [x] REST para móvil/integración interna | APIs de servicios y contratos REST | No usar REST empresarial directo desde los microfrontends como bypass del BFF |
| [x] SSO con Keycloak | Shell y MF integrados comparten sesión; validación JWT y permiso propietario | Primer login online; logout no revoca instantáneamente todo JWT ya emitido |
| [x] DDD/hexagonal/Clean en estructura | Capas domain/application/infrastructure y puertos/adaptadores; modelos ORM del propietario | Evidencia de estructura, no certificación exhaustiva de Clean Code de cada archivo |
| [x] PostgreSQL, MongoDB y DynamoDB previstos | Propiedad por servicio, drivers y migraciones/configuración | DynamoDB local es emulación; aquí no quedó operativo |
| [x] RabbitMQ + Outbox/Inbox | CU15, eventos, confirms/deduplicación y recuperación registrados | Entrega al menos una vez; no prometer exactamente una ni lectura humana de avisos |
| [x] Saga persistida y compensaciones | [Contrato CU15](../../contracts/rest/saga.md), decisión 016 y matriz real en STATUS | Timeout no es rechazo; no deshacer trabajo físico/cobros por compensación |
| [x] S3 privado para evidencia de ejecución | CU16 real documentado, acceso prefirmado y referencias en base | Bucket propio, CORS y usuario limitado configurados localmente; prueba directa AWS PASS. Falta repetir recorrido desde interfaz; EC2 requiere rol propio |
| [~] S3 para todas las clases de archivos del adjunto | Evidencia operativa usa S3; documentos financieros tienen proveedor propio local MinIO | No afirmar S3 AWS para documentos financieros de producción ni todas las carpetas sugeridas |
| [x] MongoDB para resultados/metadatos | MS04 y análisis de servidor/cliente | No confundir resultados recibidos del cliente con inferencia verificada por el servidor |
| [x] IndexedDB web / SQLite móvil | Colas y copias autorizadas, evidencia CU27 | No alta offline universal de clientes/citas/órdenes; no persistir contraseñas como mecanismo offline |
| [~] TFJS web y LiteRT móvil | Exportaciones y equivalencia de ejecución registradas; revisión humana independiente | Modelo ausente aquí; calidad/licencia y aceptación global pendientes |
| [~] ML/DL | Visión implementada experimental | CU24 duración no implementado; no sustituirlo por minutos de catálogo |
| [x] n8n en alcance local configurado | Flujos y evidencia CU28, programación/recuperación | Preparación separada, consentimiento con vigencia, sin afirmar correo externo/cloud |
| [~] Reportes generativos | Narrativa operativa, reporte financiero con verificador y fallback | No todos los tipos/gráficos/filtros; exactitud narrativa financiera no acreditada |
| [x] MCP independiente de consulta | SDK oficial, autenticación, scopes y seis herramientas autorizadas | Escritura/gestión de clientes y ejemplos adicionales pendientes |
| [~] ICONIX | Requisitos, dominio/referencias y scripts de diagramas presentes | `diagram/` aparece sin seguimiento; no se identificó un proyecto EA versionado en esta lectura. Falta revisión de trazabilidad completa con diagramas generados |
| [ ] Despliegue cloud realizado y verificado | Solo propuesta/documentación de portabilidad | Compose local no demuestra despliegue en proveedores cloud |

Leyenda de esta tabla: `[x]` evidencia de presencia/recorrido acotado; `[~]` parcial o diferencia de alcance; `[ ]` pendiente. No convierte automáticamente todas las excepciones de los CU asociados en aprobadas.

### Organización S3 propuesta en el adjunto

Los prefijos `vehiculos/.../recepciones`, `ordenes/.../entregas`, `inspecciones-ia/...` y `documentos/...` se presentan como una recomendación. La implementación de evidencia usa sus propios prefijos y autorizaciones. Cambiar el nombre de una carpeta no es un requisito funcional por sí mismo. Si el docente exige esa estructura física exacta, registrar y validar ese requisito por separado. Entregas, archivos de recepción y documentos fiscales no aparecen implementados por existir un bucket.

### Relaciones ICONIX

- [ ] Revisar `extend` desde CU22/CU23 hacia CU11 únicamente si ese recorrido opcional se implementa/describe; el enlace conceptual no acredita que la pantalla lo ejecute.
- [ ] Mantener consulta de disponibilidad como función distinta de administrar horarios; no introducir un `include CU15→CU04` por mera secuencia temporal.
- [ ] Distinguir obtención de indicadores de abrir el panel CU21; reporte y panel no son la misma interacción.
- [ ] Revisar dirección de flechas, actores humanos/externos y límites del sistema en diagramas realmente generados.
- [ ] Trazar requisito → robustez → secuencia → clases/operación → evidencia por CU; los scripts de generación solos no cierran esa trazabilidad.

## 5. Qué está pendiente en esta computadora

Observaciones de la preparación local de esta conversación; no se reejecutaron al escribir este documento:

- [x] Imágenes principales construidas y web/identidad respondiendo HTTP 200; núcleo online saludable en la última consulta.
- [x] Bootstrap/migraciones/demo terminaron con código 0; cinco empleados y dos trabajos confirmados para 2026-11-17.
- [x] Cuentas exportadas a archivos privados ignorados por Git; no se incluyen valores aquí.
- [x] Override local `output/local/runtime.compose.yaml`: elimina `CU28_WEBHOOK_URL` vacío para no activar el publicador opcional de Spring.
- [ ] Recuperar LocalStack y arrancar Sync: se observó un ejecutable Python de tamaño cero en la imagen local; la nueva descarga también sufrió EOF. No se atribuye ese fallo al código del dominio.
- [ ] Preparar S3 privado de Operaciones. Sin él, evidencia disponible y revisión técnica quedan bloqueadas; por tanto, una orden nueva no puede recorrer legítimamente hasta el cobro.
- [ ] Configurar proveedor privado de documentos de Finanzas si se probarán respaldos.
- [ ] Obtener/preparar modelos visuales autorizados para servidor/web/Android; Git ignora los artefactos.
- [ ] Confirmar descarga y ejecución de `qwen3.5:4b` en Ollama y su conexión desde el agente.
- [ ] Preparar n8n, clientes MCP y, para móvil, APK/configuración/dispositivo.

## 6. Prioridades para completar el alcance

1. Para una demostración E2E desde cero: resolver S3, verificar evidencia/finalización/cobro y registrar el resultado real. Recuperar Sync si se demostrará offline.
2. Implementar CU08 y CU18 para cerrar historial y entrega física. No confundir cierre operativo con final del ciclo del cliente.
3. Implementar CU21 y CU24 con fuentes/datos reales y contratos verificables.
4. Completar la matriz funcional de CU25/CU26 y los tipos de reportes, gráficos/filtros pendientes.
5. Resolver calidad y distribución del modelo visual, sin convertir equivalencia numérica en precisión diagnóstica.
6. Implementar CU30/CU31 y acordar si las herramientas MCP ilustrativas son requisitos obligatorios de CU29.
7. Conciliar las variantes offline generales, videos, archivos de recepción y devoluciones/anulaciones con el alcance aprobado; no contarlas como existentes.
8. Completar UI/UX, trazabilidad ICONIX y despliegue cloud con evidencia propia.

Esta es una revisión documental y de fuentes, no una auditoría exhaustiva de seguridad ni una aceptación nueva de los 31 CU. Ninguna casilla pendiente se convierte en completada por crear este archivo.

## Fuentes principales

- [PROJECT](../context/PROJECT.md), [STATUS](../context/STATUS.md) y [PLAN](../context/PLAN.md), priorizando las consolidaciones más recientes.
- [Casos de uso](../use-cases), [contratos](../../contracts), [decisiones](../decisions).
- [CU19/CU20, conciliación literal T8](../evidence/cu19-cu20-20261108.md).
- [CU22, revisión local](../evidence/cu22-local-inspection-20261107.md), [CU27](../evidence/cu27-20261105.md).
- [Matriz CU25/CU26](../evidence/cu25-cu26-acceptance-matrix.md), [MCP de consulta](../../contracts/mcp/consultation.md).
- [Guía local](../deployment/local-compose.md) y formularios/rutas de `web/`; no se usaron mocks como evidencia de integración nueva.
