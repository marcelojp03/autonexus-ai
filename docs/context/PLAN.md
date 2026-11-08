# Plan de cobertura del segundo parcial

Actualizado: 2026-11-08. Fuente de alcance: `docs/context/PROJECT.md`, `docs/use-cases/CU01..CU31` y
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
| CU19 Cobro de servicio | 3 | Ledger propietario + contexto Operaciones + BFF + React, publicado fb27230 | **Parcial**: saldo íntegro, replay/recibo y recuperación de referencia real verificados; revisiones147/149conformes para publicación parcial | Antes/después1440/390 y foco medidos, sin inspección de píxeles | Compose local, imagen3c6abd4a26b6 servida | cu19-cu20-20261108, decisión030; React42/PHP3+evidencia previa | UX visual pendiente; política conservadora no acredita abonos ni pasarela/factura fiscal. No suma3puntos |
| CU20 Gastos operativos | 2 | Ledger/categorías/documentos privados + BFF + React, publicado fb27230 | **Parcial**: gasto/documento/hash, duplicado explícito y recuperación reales; consulta read-only UI corregida | Antes/después1440/390 medidos, sin inspección visual acreditada | Compose local + MinIO persistente propio | cu19-cu20-20261108, traslado3/3 y conservación posterior4/4; React42 | UX visual pendiente. Worker Windows falló, suite Linux42/42 sí ejecutada. No suma2puntos |
| CU21 Indicadores | 4 | Ninguna | **Pendiente** | — | — | — | Indicadores derivados de cobros/gastos/órdenes |
| CU22 IA visual local (web/móvil) | 5 | Inferencia local Flutter/PWA; revisión manual independiente y conservación de predicción/revisión; recuperación de caché | **Parcial global**: recorrido y excepciones core verificados, revisión directa declarada; capacidad del modelo no validada | UX nueva pendiente; captura sin inspección visual no acredita conformidad | Compose local + Android físico previo; teléfono disponible pero acceso de nueva revisión sin completar | `docs/evidence/cu22-local-inspection-20261107.md`, decisión029; nueva UX separada en offline-workspace-ux-20261108 | Calidad del modelo/licencia sin cambios. Borrador PWA aislado y preparación/formulario Flutter en verificación separada, sin volver a aceptar CU22. No suma5puntos |
| CU23 IA de servidor | 5 | `services/intelligence` desplegado, MongoDB, BFF, MF | **Parcial**: infraestructura e inferencia integradas, capacidad diagnóstica experimental y no validada (no suma) | No revisada | Compose local | Decisión 021, evidencia cu23 | Validación de la capacidad visual y de la calidad del modelo |
| CU24 ML de duración | 5 | Ninguna | **Pendiente** | — | — | — | Dataset, entrenamiento, evaluación y límites |
| CU25 Asistente con agentes | 5 | `integration/agent` en Compose, Ollama externo configurable, catálogo cerrado, BFF, MF | **Parcial verificada**: pregunta con herramientas, aclaración, denegación y reserva determinista en navegador real | No revisada | Compose local (servicio `agent` sin puerto) | Evidencia cu25-cu26-shell §8–§10, decisión 026 | Evaluación funcional acotada contra APIs propietarias y cobertura operativa/financiera/administrativa del CU25; ver matriz técnica |
| CU26 Reportes generativos | 4 | Reporte operativo con cifras deterministas, trabajo asíncrono, exportación JSON/CSV | **Parcial verificada**: reporte escrito por el modelo con 8 afirmaciones y contrato sin violaciones | No revisada | Compose local + proveedor Ollama externo | Evidencia cu25-cu26-shell §4, §9–§10 | Tipos financiero/productividad, filtros e indicadores seleccionables, gráficos y entrada texto/audio de referencia 07 sin aceptación acreditada; matriz técnica |
| CU27 Sincronización offline | 5 | `services/sync` desplegado, PWA + Flutter, DynamoDB | **Verificada** (aceptación funcional PWA y Android físico) | No revisada | Compose local + dispositivo | Evidencia cu27-20261105 | Conflictos avanzados y multi-dispositivo no ejercidos |
| CU28 Automatizaciones n8n | 3 | Cinco flujos originales: Outbox propietarios, temporizadores n8n y CU26; revisión adicional | **Verificada, alcance local configurado**: ocho pasos y siete excepciones conciliados, incluidos dos rechazos de destinatario inexistente sin efecto/reversión | No revisada | Compose local (n8n en su propio compose) | cu28-recipient-local-20261107 + evidencia previa del catálogo/transporte; decisiones 025/027/028; revisión independiente conforme | No acredita mensajes externos, cloud ni autonomía indefinida de la sesión delegada |
| CU29 MCP consulta | 4 | `integration/mcp-server` con PKCE y alcance cerrado | **Verificada** (10 etapas reales) | No revisada | Compose local (loopback) | Evidencia cu29-20261105 | — |
| CU30 MCP acciones | 5 | Ninguna | **Pendiente** | — | — | — | Acciones autorizadas con permisos y auditoría |
| CU31 Acceso MCP externo | 3 | Ninguna | **Pendiente** | — | — | — | Registro y alcance por cliente MCP |

## Cobertura actual (estimación interna, no puntaje oficial)

Sólo suma la aceptación funcional **verificada**; un CU parcial no aporta puntos.

| Dimensión | Puntos | Detalle |
| --- | ---: | --- |
| Aceptación funcional verificada | **57** | CU01–CU07, CU09–CU17, CU27, CU28 local configurado y CU29 |
| Parcial, no suma | 24 | CU19 (3), CU20 (2), CU22 (5), CU23 (5), CU25 (5), CU26 (4) |
| Sin implementación | 21 | CU08 (2), CU18 (2), CU21 (4), CU24 (5), CU30 (5), CU31 (3) |
| Calidad visual | 0 acreditados | Sólo CU05 tiene una revisión declarada pendiente; el resto no se revisó |
| Despliegue | Compose local | Todos los servicios, incluido el asistente, corren en Compose reproducible; el despliegue cloud es una propuesta sin ejecutar |

Referencia del 70 % sobre 102: **72 puntos**. Faltan **15** puntos verificados; CU24 (5),
CU25 (5), CU26 (4), CU22 (5) y CU30 (5) conservan sus requisitos y aceptación pendientes.

La continuación financiera **no añade puntos verificados: siguen57**. Sólo mueve
5puntos de planificación de «sin implementación» a «parcial», porque ahora existen
ledger/APIs/BFF/React y recorridos reales acotados de CU19/CU20 documentados en
`docs/evidence/cu19-cu20-20261108.md`. No se confunde esa reclasificación con cierre
funcional global, revisión visual, suite React aprobada ni publicación.

CU23 no suma todavía: su infraestructura e inferencia están integradas y verificadas, pero la capacidad
visual es **experimental y no validada**, así que no se cuenta como aceptación funcional del CU.
Se conserva la clasificación previa, no se niega la ejecución funcional ya acreditada ni se afirma
calidad diagnóstica por haber ejecutado inferencia; los umbrales de calidad están en
`contracts/ai/cu23-acceptance-criteria.md`.

La variación **54/22/26 → 57/19/26** corresponde exclusivamente a los **3 puntos de CU28**:
`docs/evidence/cu28-recipient-local-20261107.md` concilia los ocho pasos y siete excepciones
con la evidencia real anterior y la nueva aceptación; revisión independiente conforme en
especificación, corrección y consistencia. Ningún otro CU cambia de clasificación.
CU22 ya tiene conversión y ejecución TFJS: `ml/Dockerfile.tfjs`,
`ml/training/export_tfjs_reference.py`, `scripts/cu22/verify-tfjs.mjs` y
`scripts/cu22/verify-tfjs-browser.mjs`; STATUS registra equivalencia Node (3e-06), Chromium WebGL
(2e-06) y recorrido desde foto (0,0070). La evidencia CU27 registra inferencia PWA offline real.
No confundir equivalencia de ejecución con calidad del modelo experimental ni con revisión visual de UI.

Ollama externo mediante `OLLAMA_URL` es una dependencia válida del producto, ya ejercitada desde
Compose; no exige empaquetar el modelo en el mismo contenedor para aceptar CU25. La generación de
CU26 se acepta independientemente de la programación y entrega semanal de CU28. Los pendientes
y la evaluación acotada están en `docs/evidence/cu25-cu26-acceptance-matrix.md`; no hay nuevos PASS.

Publicación técnica posterior: Finanzas `fb27230` y UX operativa `aed5dd9`,
ambas revisadas, integradas y confirmadas en remoto. React42/42 Linux y
Flutter31/análisis/APK, Shell10/tipos y conservación4/4 registrados; no nuevos
puntos ni cierre visual/físico por esas verificaciones.

## Ruta orientativa por entregas

Cada fila se suma **sólo** cuando su aceptación funcional está verificada.

| Entrega | Acumulado |
| --- | ---: |
| Base verificada anterior al cierre CU28 | 54 |
| CU28: cinco flujos locales y siete excepciones aceptadas (incluye resumen semanal), **ya acreditado** | 57 |
| CU25 y CU26 completos contra sus especificaciones y matriz funcional (sin exigir scheduler CU28) | 66 |
| CU24 ML de duración | 71 |
| CU22 IA visual local en web y móvil | 76 |
| CU30 acciones por MCP | 81 |
| CU31 acceso MCP externo | 84 |
| CU08 y CU18–CU21 (historial, entrega, cobro, gastos, indicadores) | 97 |
| CU23 con capacidad visual validada | 102 |

## Cobertura por dimensión

| Dimensión | Estado |
| --- | --- |
| Funcional web online | CU01–CU07, CU09–CU17, CU27, CU28 local y CU29 verificados; CU19/CU20 en delta funcional acotado sin revisar/publicar; CU22, CU23, CU25 y CU26 parciales; CU23 tiene ejecución integrada verificada, no calidad visual validada |
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

- **MongoDB** persiste los análisis de CU23 en Inteligencia. No sirve actualmente a CU25/CU26:
  el agente conserva trabajos y ledger de entregas en su volumen propio agent-jobs, sin tokens.
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
