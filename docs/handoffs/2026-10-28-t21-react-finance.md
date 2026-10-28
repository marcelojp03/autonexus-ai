# Traspaso — T21: recepción, órdenes y cotizaciones en pantallas

Fecha: 2026-10-28. Responsable de referencia Marcelo; alcance transversal autorizado. Rama work/marcelo reutilizada, sin nueva rama/worktree. Base f63ed9803dc3ec147d51b94ea847fc515628fe62; código verificado/revisado en 5080cdc53a8c787dd034859f939b3b37cb3f4b5d, seguido de cierre documental. La fase de cierre integra a main por fast-forward y publica main y work/marcelo por push normal; consultar sus refs/SHA remotos para la evidencia Git definitiva.

## Entrega y contratos

- React/Finanzas en /finance con bootstrap/mount/unmount del ESM realmente servido, hosts/props/registro/navegación completos. Conserva template, aísla CSS y portales en ShadowRoot y consume SessionPort.requestBusiness; sin login ni SDK propios en modo integrado.
- Standalone empresarial en 4204 con el helper OIDC común, cliente público propio y PKCE S256. Scopes basic/profile/roles y audiencias de APIs necesarias; tokens solo en RAM y reutilización de SSO al cruzar al Shell.
- Recepción y órdenes CU11/CU12 en mf-operations, incluidos validaciones, cita opcional, número/prioridad/servicios/tarifas copiadas/versión/estado. Búsquedas auxiliares independientes de consultas, IDs directos autorizados y errores de negocio.
- Cotizaciones CU13/CU14 en React: referencias UUID cliente/vehículo, tarifas/cantidades/ajustes propuestos, importes y configuración fiscal del servidor, vigencia del taller, revisión/versiones/desglose. Selección explícita de cotización antes de decidir, evidencia obligatoria real y motivo opcional.
- BFF corrige catálogo público de errores CU11/CU12 y reenvío de open; CORS exacto 4204. Contratos funcionales existentes reutilizados, sin cambiar propietarios ni persistencia.
- Los dos adaptadores Angular reconcilian sus rutas con single-spa por API pública y replaceUrl, con límite de prefijo, deduplicación y cleanup. No se parchearon builders, dependencias o history por hipótesis.

## Verificación observada

Node 22.22.3/pnpm 12.6.0. React 25/25 focalizadas y lint limpio; Angular CU11/CU12 9/9 Chromium; Shell 25/25; BFF 32 unitarias + 13 HTTP, tipos/build. Ambos Angular integrados, Finance integrado/standalone y Shell construidos. Frozen Finance y detector de superficies [] PASS.

Recorrido real de navegador 8 etapas: dos recepciones y órdenes → dos cotizaciones → v2/superseded → rechazo y aprobación seleccionados. Persistencia tras recarga, UUID correctos, evidencia vacía bloqueada, roles/permisos y revisión obsoleta de aprobada rechazada con QUOTE_APPROVED_IMMUTABLE. La orden continuó pending_quote; no hubo confirmación ni asignación.

Navegador montaje/rutas 12 etapas: exports reales, single-spa MOUNTED, mount con host/basePath, unmount/remount, cuatro rutas operativas anteriores, historial Angular propio/cruzado, Empleados/horarios/seguridad, enlace directo/recarga y escritorio/móvil sin fuga CSS. Standalone 4 etapas: PKCE/GraphQL, recarga, SSO al Shell y logout/desmontaje. BFF real 6 etapas por GraphQL. Sin mocks como evidencia final. Consolas limpias; cancelaciones de recurso Angular al salir se guardan como ERR_ABORTED, sin HTTP fallidos.

Scripts en scripts/finance/{verify-t21-web,verify-react-integration,verify-standalone-web}.mjs y scripts/operations/verify-flow-bff-real.mjs. Logs/exit locales en output/t21/ y capturas/diagnósticos en output/playwright/ (ignorados). Los sintéticos T21 se conservan como evidencia; no se borraron registros reales ni se reinicializaron bases/volúmenes.

La revisión de cierre fue **directa**, sin bloqueantes, del rango f63ed98..5080cdc. El intento independiente general-20 falló antes de dictamen con SQLiteError: database is locked y se canceló. No acreditar revisión independiente.

## Límites y siguiente paso

Fotografías/S3, inspección IA, offline, cobros e indicadores siguen pendientes. Aprobar una cotización no confirma el servicio ni asigna mecánico. CU15 y CU05 con trabajos/asignaciones reales no se declaran implementados. El contrato de Saga ya preparado en contracts/rest/saga.md no fue ampliado ni ejecutado. No iniciar CU15 por inferencia: requiere la siguiente indicación del usuario.

Leer al retomar: AGENTS, PROJECT/STATUS/CONTEXT-MAP, docs/compose/spec/operations-flow.md, decisión 015, contratos GraphQL de operations/finance y contrato de Saga solo cuando CU15 entre en alcance. Persistencia conservada: Spring JDBC/Flyway; Nest TypeORM con SQL explícito/entities:[]; Laravel Query Builder; BFF sin base.
