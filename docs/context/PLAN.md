# Plan de cobertura del segundo parcial

Actualizado: 2026-10-30. Fuente de alcance: `docs/context/PROJECT.md`, `docs/use-cases/CU01..CU31` y contratos vigentes.

## Regla de medición

La cobertura se mide por **puntos** del reparto (102 en total), no por cantidad de CU: un CU de 5 puntos no vale lo mismo que uno de 2. Cada fila se clasifica como:

- **Verificado**: existe código, se ejecutó una prueba real o smoke del recorrido y hay evidencia registrada.
- **Parcial**: hay modelo, contrato o parte del recorrido, pero falta un tramo o no se probó de punta a punta.
- **Pendiente**: sin implementación funcional.

Las dimensiones se miden por separado y no se mezclan: **web online**, **móvil**, **offline** y **cloud/despliegue**.

## Matriz requisito → implementación → evidencia → pendiente

| CU | Puntos | Implementación | Estado | Evidencia | Pendiente |
| --- | --- | --- | --- | --- | --- |
| CU01 Iniciar sesión | 3 | Keycloak + Shell PKCE | Verificado | CU01 API y browser, decisión 005 | — (visual global compartido) |
| CU02 Roles y permisos | 3 | Empleados, catálogo, BFF, UI | Verificado | 89/89 pruebas, verificación real, decisión 012 | — |
| CU03 Empleados | 2 | Empleados REST + BFF + MF | Verificado | CU03 API/BFF/browser | — |
| CU04 Horarios | 3 | Empleados staffing + UI | Verificado | CU04 API/browser | — |
| CU05 Agenda | 2 | Agenda propia/equipo, BFF, MF | Verificado, **visual pendiente** | CU05 API/BFF/browser | G2 visual sin canal de píxeles |
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

## Cobertura actual

- Verificado: CU01–CU07, CU09–CU16 = **43 de 102 puntos (42 %)**.
- Si CU17 cierra: **45 puntos (44 %)**.
- Objetivo del parcial: ~70 % (≈71 puntos). El salto real no viene de la gestión empresarial restante (CU08, CU18–CU21 = 13 puntos) sino de **IA + offline + MCP** (CU22–CU27, CU29–CU31 = 36 puntos).

## Bloques y dependencias

| Bloque | CUs | Puntos | Depende de | Criterio de cierre |
| --- | --- | --- | --- | --- |
| A. Cierre operativo | CU17 | 2 | CU16 | Solicitud/aprobación/devolución reales y agenda adaptada |
| B. Inteligencia con datos reales | CU24, CU23 | 10 | CU16 (evidencias), MongoDB | Inferencia real servida, evaluada y documentada; sin reentrenamiento automático |
| C. IA local en cliente | CU22 | 5 | CU16 (evidencias), B | Modelo ejecutado en web (TensorFlow.js) y en móvil (LiteRT) |
| D. Offline + sincronización | CU27 | 5 | CU05/CU16 (recorridos), mobile | PWA y Flutter con almacenamiento local y sincronización idempotente con DynamoDB |
| E. Agentes y reportes | CU25, CU26 | 9 | B (datos), CU19–CU21 deseable | Asistente y reporte con datos reales del taller |
| F. MCP y automatización | CU29, CU30, CU31, CU28 | 15 | CU21/B (herramientas) | Servidor MCP separado con permisos/auditoría y automatización real |
| G. Gestión empresarial restante | CU08, CU18, CU19, CU20, CU21 | 13 | CU17 | Entrega y cobro separados de la finalización técnica |

Orden elegido por cobertura frente a esfuerzo: **A → B → C → D → E → F**, y G sólo cuando alimente un recorrido (CU19 cobro → CU21 indicadores para reportes y MCP). CU18 puede reducirse a registro mínimo si el tiempo aprieta.

## Dependencias transversales

- **MongoDB** entra con CU23 y sirve también a CU25/CU26 (evidencias analizadas, reportes).
- **DynamoDB** entra con CU27; sin él no hay sincronización real ni conflictos.
- **Una misma evidencia** de CU16 alimenta visión local (CU22) y de servidor (CU23): no duplicar captura.
- **Un mismo modelo** de duración (CU24) puede adaptarse a web y móvil, reduciendo trabajo de CU22.
- Ningún bloque puede declarar confirmación de transacciones distribuidas estando offline.

## Restricciones vigentes

- Sin cambios generales de IAM ni recursos cloud con costo sin revisión previa concreta.
- CU05 conserva su pendiente visual; no se acredita conformidad visual.
- Persisten la identidad IAM mínima pendiente para Operaciones y los límites de inmutabilidad/TOCTOU de CU16.
