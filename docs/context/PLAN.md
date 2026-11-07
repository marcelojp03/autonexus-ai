# Plan de cobertura del segundo parcial

Actualizado: 2026-11-07. Fuente de alcance: `docs/context/PROJECT.md`, `docs/use-cases/CU01..CU31` y
contratos vigentes. Estado reconstruido desde la evidencia registrada en `docs/evidence/` y
`docs/context/STATUS.md`, no desde el plan anterior.

## Regla de medición

La cobertura se mide por **puntos**, no por cantidad de CU. Los 102 puntos provienen del reparto interno
de `docs/context/PROJECT.md`: son una **estimación para planificar**, no el puntaje oficial del docente.

Cada CU se clasifica en **cuatro dimensiones separadas**, y ninguna sustituye a otra:

- **Implementación**: existe el código del recorrido (propietario, contrato, transporte, interfaz).
- **Aceptación funcional**: se ejecutó un recorrido real de punta a punta y hay evidencia registrada.
- **Calidad visual**: hay revisión visual declarada contra un canal de píxeles real.
- **Despliegue**: corre en un entorno reproducible (Compose local) o desplegado; el despliegue cloud es
  sólo una propuesta y no se cuenta.

**Un CU parcial no suma sus puntos.** Un CU suma sólo cuando su aceptación funcional está verificada; la
calidad visual y el despliegue se informan aparte, sin sumar puntos adicionales. Un CU con implementación
pero sin recorrido real se cuenta como parcial y **no** entra en el total.

## Matriz requisito → implementación → dimensiones → evidencia → pendiente

| CU | Pts | Implementación | Aceptación funcional | Calidad visual | Despliegue | Evidencia | Pendiente |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| CU01 Iniciar sesión | 3 | Keycloak + Shell PKCE | **Verificada** | No revisada | Compose local | STATUS CU01, decisión 005 | — |
| CU02 Roles y permisos | 3 | Empleados, catálogo, BFF, UI | **Verificada** | No revisada | Compose local | 89/89 pruebas, decisión 012 | — |
| CU03 Empleados | 2 | Empleados REST + BFF + MF | **Verificada** | No revisada | Compose local | STATUS CU03 | — |
| CU04 Horarios | 3 | Empleados staffing + UI | **Verificada** | No revisada | Compose local | STATUS CU04 | — |
| CU05 Agenda | 2 | Agenda propia/equipo, BFF, MF | **Verificada** | **Pendiente** (G2 sin canal de píxeles) | Compose local | STATUS CU05, decisión 017 | Revisión visual |
| CU06 Clientes | 2 | Operaciones + MF | **Verificada** | No revisada | Compose local | STATUS bloque operativo | — |
| CU07 Vehículos | 2 | Operaciones (propietarios append-only) | **Verificada** | No revisada | Compose local | STATUS bloque operativo | — |
| CU08 Historial del vehículo | 2 | Sólo `vehicle_owners` como modelo | **Pendiente** | — | — | — | Endpoint de historial + UI |
| CU09 Catálogo | 2 | Operaciones + MF | **Verificada** | No revisada | Compose local | STATUS bloque operativo | — |
| CU10 Citas | 4 | Operaciones + MF | **Verificada** | No revisada | Compose local | STATUS bloque operativo | — |
| CU11 Recepción | 3 | Operaciones + MF | **Verificada** | No revisada | Compose local | STATUS flujo CU11–14 | — |
| CU12 Orden de trabajo | 3 | Operaciones | **Verificada** | No revisada | Compose local | STATUS flujo CU11–14 | — |
| CU13 Cotización | 3 | Finanzas | **Verificada** | No revisada | Compose local | STATUS flujo CU11–14, PHPUnit | — |
| CU14 Decisión de cotización | 2 | Finanzas | **Verificada** | No revisada | Compose local | STATUS flujo CU11–14 | — |
| CU15 Confirmar servicio | 5 | Saga Operaciones/Empleados/Finanzas | **Verificada** | No revisada | Compose local | STATUS CU15, decisión 016 | — |
| CU16 Ejecución y evidencias | 4 | Operaciones + BFF + MF + S3 | **Verificada** | No revisada | Compose local + S3 real | 15+12+7 etapas, decisión 019 | Deuda: identidad IAM mínima |
| CU17 Verificar y finalizar | 2 | Operaciones + BFF + MF | **Verificada** | No revisada | Compose local | Suites 44 + BFF 144, auditoría 8/8, `6f954a7` | — |
| CU18 Entrega de vehículo | 2 | Ninguna | **Pendiente** | — | — | — | Registro de entrega separado de la finalización |
| CU19 Cobro de servicio | 3 | Ninguna | **Pendiente** | — | — | — | Cobro local, sin pasarela |
| CU20 Gastos operativos | 2 | Ninguna | **Pendiente** | — | — | — | Registro de gastos |
| CU21 Indicadores | 4 | Ninguna | **Pendiente** | — | — | — | Indicadores derivados de cobros/gastos/órdenes |
| CU22 IA visual local (web/móvil) | 5 | Inferencia local en Flutter y PWA (CU27) | **Parcial**: inferencia local en dispositivo, no el recorrido completo del CU | No revisada | Compose local + Android físico | STATUS CU27, evidencia cu27 | Conversión web (TFJS) y comparación visual diferida |
| CU23 IA de servidor | 5 | `services/intelligence` desplegado, MongoDB, BFF, MF | **Parcial**: infraestructura e inferencia integradas, capacidad diagnóstica experimental y no validada (no suma) | No revisada | Compose local | Decisión 021, evidencia cu23 | Validación de la capacidad visual y de la calidad del modelo |
| CU24 ML de duración | 5 | Ninguna | **Pendiente** | — | — | — | Dataset, entrenamiento, evaluación y límites |
| CU25 Asistente con agentes | 5 | `integration/agent` en Compose, LLM local, catálogo cerrado, BFF, MF | **Parcial verificada**: pregunta con herramientas, aclaración, denegación y reserva determinista en navegador real | No revisada | Compose local (servicio `agent` sin puerto) | Evidencia cu25-cu26-shell §8–§10, decisión 026 | Modelo no desplegado como componente del producto; calidad del modelo no evaluada |
| CU26 Reportes generativos | 4 | Reporte con cifras deterministas, trabajo asíncrono, exportación JSON/CSV | **Parcial verificada**: reporte escrito por el modelo con 8 afirmaciones y contrato sin violaciones | No revisada | Compose local | Evidencia cu25-cu26-shell §4, §9–§10 | Resumen semanal vía n8n (parte de CU28); calidad del modelo no evaluada |
| CU27 Sincronización offline | 5 | `services/sync` desplegado, PWA + Flutter, DynamoDB | **Verificada** (aceptación funcional PWA y Android físico) | No revisada | Compose local + dispositivo | Evidencia cu27-20261105 | Conflictos avanzados y multi-dispositivo no ejercidos |
| CU28 Automatizaciones n8n | 3 | Outbox + publicador + webhook + n8n + canal | **Parcial verificada**: 2 de los 5 flujos del catálogo (solicitud de revisión y orden finalizada) | No revisada | Compose local (n8n en su propio compose) | Evidencia cu28-20261106, decisión 025 | Asignación, cotización pendiente, recordatorio y resumen semanal; programación con identidad de empleado |
| CU29 MCP consulta | 4 | `integration/mcp-server` con PKCE y alcance cerrado | **Verificada** (10 etapas reales) | No revisada | Compose local (loopback) | Evidencia cu29-20261105 | — |
| CU30 MCP acciones | 5 | Ninguna | **Pendiente** | — | — | — | Acciones autorizadas con permisos y auditoría |
| CU31 Acceso MCP externo | 3 | Ninguna | **Pendiente** | — | — | — | Registro y alcance por cliente MCP |

## Cobertura actual (estimación interna, no puntaje oficial)

Sólo suma la aceptación funcional **verificada**; un CU parcial no aporta puntos.

| Dimensión | Puntos | Detalle |
| --- | ---: | --- |
| Aceptación funcional verificada | **54** | CU01–CU07, CU09–CU17, CU27 y CU29 |
| Parcial, no suma | 22 | CU22 (5), CU23 (5), CU25 (5), CU26 (4), CU28 (3) |
| Sin implementación | 26 | CU08 (2), CU18–CU21 (11), CU24 (5), CU30 (5), CU31 (3) |
| Calidad visual | 0 acreditados | Sólo CU05 tiene una revisión declarada pendiente; el resto no se revisó |
| Despliegue | Compose local | Todos los servicios, incluido el asistente, corren en Compose reproducible; el despliegue cloud es una propuesta sin ejecutar |

Referencia del 70 % sobre 102: **72 puntos**. Faltan **18** puntos verificados, y el salto real está en los
bloques pendientes: CU24 (5), CU25 (5), CU26 (4), CU28 (3) completos y CU30 (5).

CU23 no suma todavía: su infraestructura e inferencia están integradas y verificadas, pero la capacidad
visual es **experimental y no validada**, así que no se cuenta como aceptación funcional del CU.

## Ruta orientativa por entregas

Cada fila se suma **sólo** cuando su aceptación funcional está verificada.

| Entrega | Acumulado |
| --- | ---: |
| Base verificada al 2026-11-07 | 54 |
| CU28 con los cuatro flujos restantes y el resumen semanal | 57 |
| CU25 y CU26 completos (incluye resumen semanal y calidad evaluada) | 66 |
| CU24 ML de duración | 71 |
| CU22 IA visual local en web y móvil | 76 |
| CU30 acciones por MCP | 81 |
| CU31 acceso MCP externo | 84 |
| CU08 y CU18–CU21 (historial, entrega, cobro, gastos, indicadores) | 97 |
| CU23 con capacidad visual validada | 102 |

## Cobertura por dimensión

| Dimensión | Estado |
| --- | --- |
| Funcional web online | CU01–CU07, CU09–CU17, CU23, CU27 y CU29 verificados; CU25, CU26 y CU28 parciales |
| Validación visual | Sólo CU05 tiene una revisión declarada pendiente (G2); ninguna otra superficie tiene conformidad visual acreditada |
| Móvil (Flutter) | La app existe y la aceptación de CU27 en un dispositivo físico está registrada; el resto de los recorridos móviles no se ejercitó |
| Offline (PWA + almacenamiento local + sincronización) | Verificado para CU27 sobre cambios y fotos; conflictos avanzados y multi-dispositivo pendientes |
| Despliegue | Compose local reproducible con todos los servicios, incluido el asistente; cloud sólo como propuesta |

## Modelos: duración y visión son distintos

- **CU24** estima **duración** a partir de datos observados y no acredita nada de visión.
- **CU23** (servidor) y **CU22** (cliente) analizan **imágenes**; el reutilizable es el modelo visual, con
  sus conversiones y verificaciones de ejecución real en cada plataforma.
- El modelo de duración no se reutiliza como modelo visual ni al revés.

## Dependencias transversales

- **MongoDB** entra con CU23 y sirve también a CU25/CU26.
- **DynamoDB** entra con CU27; sin él no hay sincronización real ni conflictos.
- **Una misma evidencia** de CU16 alimenta visión local (CU22) y de servidor (CU23): no duplicar captura.
- **Un mismo modelo visual** puede adaptarse a web y móvil; el de duración es independiente.
- Ningún bloque puede declarar confirmación de transacciones distribuidas estando offline.

## Restricciones vigentes

- Sin cambios generales de IAM ni recursos cloud con costo sin revisión previa concreta.
- CU05 conserva su pendiente visual; no se acredita conformidad visual de ninguna superficie.
- Persisten la identidad IAM mínima pendiente para Operaciones y los límites de inmutabilidad/TOCTOU de CU16.
- La programación de CU28 exige una identidad de **empleado** con roles mínimos; no se usa una cuenta
  técnica privilegiada para eludir la vinculación y los permisos de los contratos.
