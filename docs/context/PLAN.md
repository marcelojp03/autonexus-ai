# Plan de cobertura del segundo parcial

Actualizado: 2026-10-31. Fuente de alcance: `docs/context/PROJECT.md`, `docs/use-cases/CU01..CU31` y contratos vigentes.

## Regla de medición

La cobertura se mide por **puntos**, no por cantidad de CU. Los 102 puntos provienen del **reparto interno de `docs/context/PROJECT.md`**: son una **estimación de cobertura para planificar**, no el puntaje oficial del docente, que no está en el repositorio. Cada fila se clasifica como:

- **Verificado**: existe código, se ejecutó una prueba real o smoke del recorrido y hay evidencia registrada.
- **Parcial**: hay modelo, contrato o parte del recorrido, pero falta un tramo o no se probó de punta a punta.
- **Pendiente**: sin implementación funcional.

Las dimensiones se miden por separado y no se mezclan: **funcional**, **validación visual**, **móvil**, **offline** y **despliegue**. Un CU puede estar funcionalmente verificado y conservar su validación visual pendiente.

## Matriz requisito → implementación → evidencia → pendiente

| CU | Puntos | Implementación | Estado | Evidencia | Pendiente |
| --- | --- | --- | --- | --- | --- |
| CU01 Iniciar sesión | 3 | Keycloak + Shell PKCE | Verificado | CU01 API y browser, decisión 005 | — (visual global compartido) |
| CU02 Roles y permisos | 3 | Empleados, catálogo, BFF, UI | Verificado | 89/89 pruebas, verificación real, decisión 012 | — |
| CU03 Empleados | 2 | Empleados REST + BFF + MF | Verificado | CU03 API/BFF/browser | — |
| CU04 Horarios | 3 | Empleados staffing + UI | Verificado | CU04 API/browser | — |
| CU05 Agenda | 2 | Agenda propia/equipo, BFF, MF | Funcional verificado; **visual pendiente** | CU05 API/BFF/browser | G2 visual sin canal de píxeles |
| CU06 Clientes | 2 | Operaciones + MF Operaciones | Verificado | Verificación real CU06 | — |
| CU07 Vehículos | 2 | Operaciones (propietarios append-only) | Verificado | Verificación real CU07 | — |
| CU08 Historial del vehículo | 2 | Sólo `vehicle_owners` como modelo | **Pendiente** | — | Endpoint de historial de servicios + UI |
| CU09 Catálogo | 2 | Operaciones + MF | Verificado | Verificación real CU09 | — |
| CU10 Citas | 4 | Operaciones + MF | Verificado | Verificación real CU10 | — |
| CU11 Recepción | 3 | Operaciones + MF Finanzas/Operaciones | Verificado | Flujo CU11–14 | — |
| CU12 Orden de trabajo | 3 | Operaciones | Verificado | Flujo CU11–14 | — |
| CU13 Cotización | 3 | Finanzas | Verificado | Flujo CU11–14, PHPUnit | — |
| CU14 Decisión de cotización | 2 | Finanzas | Verificado | Flujo CU11–14 | — |
| CU15 Confirmar servicio | 5 | Saga Operaciones/Empleados/Finanzas | Verificado | Verificación real CU15, decisión 015 | — |
| CU16 Ejecución y evidencias | 4 | Operaciones + BFF + MF + S3 | Verificado | 15+12+7 etapas reales, decisión 019 | Deuda: identidad IAM mínima |
| CU17 Verificar y finalizar | 2 | En implementación (este bloque) | Parcial | `docs/compose/spec/cu17-verification.md` | Backend, permisos, BFF, UI |
| CU18 Entrega de vehículo | 2 | Ninguna | Pendiente | — | Registro de entrega separado de finalización |
| CU19 Cobro de servicio | 3 | Ninguna | Pendiente | — | Cobro local, sin pasarela |
| CU20 Gastos operativos | 2 | Ninguna | Pendiente | — | Registro de gastos |
| CU21 Indicadores | 4 | Ninguna | Pendiente | — | Indicadores derivados de cobros/gastos/órdenes |
| CU22 IA visual local (web/móvil) | 5 | Ninguna | Pendiente | — | TensorFlow.js en web + LiteRT en móvil sobre evidencia real |
| CU23 IA de servidor | 5 | `services/intelligence` vacío | Pendiente | — | FastAPI + MongoDB + inferencia real |
| CU24 ML de duración | 5 | Ninguna | Pendiente | — | Dataset, entrenamiento, evaluación y límites |
| CU25 Asistente con agentes | 5 | Ninguna | Pendiente | — | Agentes con herramientas autorizadas |
| CU26 Reportes generativos | 4 | Ninguna | Pendiente | — | Reporte con datos reales, no plantilla fija |
| CU27 Sincronización offline | 5 | `services/sync` vacío; sin PWA offline | Pendiente | — | DynamoDB, contratos de cambio, conflictos e idempotencia |
| CU28 n8n | 3 | Ninguna | Pendiente | — | Automatización real y auditable |
| CU29 MCP consulta | 4 | `integration/mcp-server` inexistente | Pendiente | — | Servidor MCP separado con herramientas de lectura |
| CU30 MCP acciones | 5 | Ninguna | Pendiente | — | Acciones autorizadas con permisos y auditoría |
| CU31 Acceso MCP externo | 3 | Ninguna | Pendiente | — | Registro y alcance por cliente MCP |

## Cobertura actual (estimación interna, no puntaje oficial)

- Verificado funcionalmente: CU01–CU07 y CU09–CU16 = **43 puntos**.
- Con CU17 completo: **45**.
- Referencia del 70 % sobre 102: **72 puntos** (71 equivale a 69,6 %).
- IA + offline + MCP (CU22–CU27 y CU29–CU31) suman **41 puntos**, no 36: son el salto real de cobertura, no la gestión empresarial restante (CU08, CU18–CU21 = 13).

Ruta orientativa por entregas (cada fila sólo se suma cuando está verificada):

| Entrega | Acumulado |
| --- | ---: |
| Base verificada actual | 43 |
| CU17 completo (solicitud, aprobación, devolución, agenda activa/historial) | 45 |
| CU24 ML de duración + CU23 visión de servidor | 55 |
| CU22 visión local en web **y móvil** | 60 |
| CU27 offline y sincronización | 65 |
| CU29 MCP de consulta | 69 |
| CU28 automatización n8n | **72 ≈ 70,6 %** |

La meta no es un techo: CU25 (agentes) y CU26 (reportes generativos) son requisitos explícitos y se implementan después aprovechando los datos y herramientas anteriores. CU30/CU31 completan MCP.

## Cobertura por dimensión

| Dimensión | Estado |
| --- | --- |
| Funcional web online | CU01–CU07, CU09–CU16 verificados; CU17 en curso |
| Validación visual | CU05 con G2 pendiente; el resto sin revisión visual declarada |
| Móvil (Flutter) | Pendiente: sólo existe el esqueleto `mobile/autonexus_app` |
| Offline (PWA + almacenamiento local + sincronización) | Pendiente |
| Despliegue | Compose local reproducible y publicado; cloud sólo como propuesta, sin despliegue probado |
## Modelos: duración y visión son distintos

- **CU24** estima **duración** a partir de datos observados y no acredita nada de visión.
- **CU23** (servidor) y **CU22** (cliente) analizan **imágenes**; el reutilizable entre servidor, web y móvil es el **modelo visual**, con sus conversiones y verificaciones de ejecución real en cada plataforma.
- El modelo de duración no se reutiliza como modelo visual ni al revés.
## Dependencias transversales

- **MongoDB** entra con CU23 y sirve también a CU25/CU26 (evidencias analizadas, reportes).
- **DynamoDB** entra con CU27; sin él no hay sincronización real ni conflictos.
- **Una misma evidencia** de CU16 alimenta visión local (CU22) y de servidor (CU23): no duplicar captura.
- **Un mismo modelo visual** (CU23) puede adaptarse a web (TensorFlow.js) y móvil (LiteRT); el modelo de duración (CU24) es independiente y no acredita visión.
- Ningún bloque puede declarar confirmación de transacciones distribuidas estando offline.

## Restricciones vigentes

- Sin cambios generales de IAM ni recursos cloud con costo sin revisión previa concreta.
- CU05 conserva su pendiente visual; no se acredita conformidad visual.
- Persisten la identidad IAM mínima pendiente para Operaciones y los límites de inmutabilidad/TOCTOU de CU16.
