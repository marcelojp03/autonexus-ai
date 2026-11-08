# MF03 Finanzas — React, CU13/CU14 y pantallas CU19/CU20

Template ViteDash copiado directamente en esta carpeta, conservando su licencia, fuentes, AGENTS y contexto. Versiones instaladas verificadas: React 19.3.1, Ant Design 6.6.8, Vite 8.3.5; keycloak-js 26.2.4 y @ant-design/cssinjs 2.1.2 explícitos. Node 22.22.3 y pnpm 12.6.0 del repositorio, sin cambios globales. El lockfile fija las resoluciones.

## Pantallas empresariales

Consulta de órdenes pendientes, búsqueda por número/placa/ID, creación y revisión de cotizaciones, cantidades y tarifas propuestas, descuento, vigencia del calendario America/La_Paz y notas. Finanzas calcula subtotales, descuento, impuestos y total; la pantalla usa su moneda y configuración fiscal, sin fijar una tasa local. Las revisiones conservan versiones anteriores superseded; las aprobadas son inmutables.

La decisión se registra exclusivamente sobre una cotización seleccionada identificada por ID, orden y versión. Exige evidencia real no vacía y admite motivo. Las referencias de cliente y vehículo son sus UUID de Operaciones; nombre y placa son solo presentación. Permisos quotes:read/write/decide y orders:read resueltos por securityCatalog; los servicios y BFF vuelven a autorizarlos.

**Aprobar no confirma el servicio ni asigna mecánico.** La confirmación se realiza por CU15, con su estado y evidencia en STATUS. Los indicadores completos siguen pendientes; IA y offline no se acreditan.

### Cobros y gastos (CU19/CU20)

La navegación local separa Cotizaciones, Cobros y Gastos sin desmontar las intenciones pendientes al cambiar de pantalla. Cobros consulta obligaciones, importe acordado, pagos previos y saldo/versiones del servidor; lista cobros registrados y relee sus comprobantes internos (no facturas fiscales). La política publicada es cobro íntegro tras finalización, sin abonos ni anticipos. Efectivo exige confirmación humana de recepción; transferencia/QR requieren primero registrar la comprobación humana de referencia e importe, sin afirmar una consulta bancaria automática.

Gastos consulta categorías y listado paginado con filtros y total del período del servidor; el formulario requiere confirmación. Un posible duplicado se concilia como rechazo antes de presentar su candidato; registrar otro gasto legítimo requiere motivo y confirmación explícita de una intención nueva. Los importes se convierten de texto decimal a cadenas de centavos con BigInt, sin Float. Permisos payments:read/write y expenses:read/write desde securityCatalog, actualizables; el servidor mantiene toda autoridad.

El respaldo JPEG/PNG opcional se autoriza/confirma por GraphQL. Solo los bytes usan el proxy BFF /finance-files, con X-Finance-Grant opaco, sin JWT ni cookies ni redirecciones. No se adjunta documentId hasta obtener estado available. La falta de almacenamiento es error, nunca un adjunto ficticio. La descarga solicita un grant nuevo y no persiste URLs. Esto describe implementación frontend, no evidencia de integración real con S3/BFF.

Tras un resultado incierto se conservan operationId y cuerpo exactos en memoria y se bloquea una intención sustitutiva; Consultar resultado o Reintentar el mismo envío no generan otro ID. Un resultado no encontrado no se interpreta como rechazo. **La recuperación se conserva durante el montaje/sesión actual, no a través de recarga o cierre del navegador**; la pantalla advierte que no se cierre antes de conciliar. No se escribe información financiera en almacenamiento del navegador.

Verificación local: src/integrated/ledger.test.jsx usa dobles explícitos de SessionPort/jsdom y transporte binario. Cubre dinero exacto, permisos, paginación, stale fetch, confirmaciones humanas, duplicidad, conciliación/reintento y adjunto confirmado. No demuestra la integración empresarial ni el recorrido visual en navegador. Compilaciones integrado y standalone ejecutadas, en ese orden, con Node 22.22.3; persiste el aviso de tamaño del bundle. No se reinició runtime ni se hizo staging del Shell como parte de este cambio.

## Integrado en el Shell

Ruta /finance, ESM /mfs/finance/main.js, exports bootstrap/mount/unmount reales. Vite conserva las firmas públicas del entry para que no se eliminen los exports. El Shell entrega domElement, basePath=/finance, assetBase=/mfs/finance/ y SessionPort; React no crea SDK, login ni storage de tokens. Toda llamada empresarial usa requestBusiness al BFF, nunca REST directo.

Cada mount crea un root React dentro del ShadowRoot del host recibido; CSS del template, CSS-in-JS y portales AntD quedan ahí. Unmount destruye árbol, efectos y estilos propios sin cerrar la sesión del Shell. El registro y el staging del Shell incluyen Finance junto a ambos Angular, sin iframe ni marcadores de prueba.

## Independiente

Dev/preview usan exclusivamente http://127.0.0.1:4204, strictPort. main.jsx crea un propietario del helper compartido browser-auth con el cliente público autonexus-mf-finance, no el AuthContext demo del template. El login es Keycloak Code+PKCE S256 y reutiliza SSO; tokens solo en RAM. Recarga restaura /finance; perder sesión oculta/desmonta el negocio, logout vuelve a raíz anónima y BFCache recrea la sesión por recarga. Las fuentes demo se conservan pero no son el entry empresarial.

El cliente se provisiona de forma idempotente con infra/keycloak/scripts/provision-finance-clients.mjs desde la raíz. Requiere scopes basic/profile/roles, scope-mappings de roles del taller y audiencias de Finanzas, Empleados (BFF) y Operaciones; no se amplían clientes existentes ni se regeneran secretos. El BFF admite el origen exacto 4204 además de los anteriores.

## Preparación y ejecución

### Docker integrado

Para el conjunto implementado se usa el Compose de la raíz y su [guía de despliegue local](../../docs/deployment/local-compose.md): Shell y los tres microfrontends se compilan dentro de Docker. No se necesitan Node/pnpm ni builds previos en el host para ese recorrido.

El Dockerfile heredado de esta carpeta fue corregido para contexto de raíz, Node22.22.3, pnpm12.6.0 y pnpm-lock.yaml. Compila salidas standalone/integrated separadas; no usa npm ci ni package-lock. Su build se ejecutó desde la raíz con salida 0. Para el recorrido integral verificado se usan los comandos de la guía enlazada.

Ese resultado acredita compilación/imagen, no un segundo despliegue SSO independiente. El Compose integral expone solo el Shell. Para ejecutar la imagen heredada por separado también hace falta configuración legible en /run/config/service.env y provisión del cliente OIDC independiente; ese modo no se acredita en la aceptación Docker integral. Los pasos nativos siguientes corresponden al modo de desarrollo ya documentado.

Desde esta carpeta, con Node/pnpm fijados en PATH:

```text
pnpm install --frozen-lockfile
pnpm build:integrated
pnpm build
pnpm dev
pnpm preview
```

Salidas independientes: dist/integrated/main.js y dist/standalone/. Construir standalone no borra el integrado. Después de cambiar el integrado, reconstruir y ejecutar el staging/build del Shell. En este equipo se verificaron los builds con node node_modules/vite/bin/vite.js build [--mode integrated] y el navegador contra el servidor estático del Shell sirviendo dist/standalone con PORT=4204. dev/preview son scripts disponibles, no procesos adicionales verificados en esta entrega. No ejecutar dos listeners en ese puerto.

Pruebas focalizadas ejecutadas con Node 22.22.3:

```text
node node_modules/vitest/vitest.mjs run src/integrated/IntegratedApp.test.jsx src/spa.test.jsx src/standalone.test.js --pool=threads --maxWorkers=1 --testTimeout=15000 --reporter=dot
```

25/25 PASS. Dobles de SessionPort/jsdom son solo pruebas locales, no evidencia empresarial. Desde la raíz, verify-t21-web.mjs, verify-react-integration.mjs y verify-standalone-web.mjs en scripts/finance prueban navegador/Keycloak/BFF/servicios/PostgreSQL reales sin mocks. Resultados y límites vigentes en docs/context/STATUS.md; diagnósticos y capturas locales bajo output/playwright/ (ignorados). Se conservan avisos de tamaño del bundle y la limitación de pseudoelementos de jsdom, sin suprimir errores de navegador.

