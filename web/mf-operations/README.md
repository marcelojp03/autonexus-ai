# MF02 Operaciones

## CU01 — modos explícitos

La misma aplicación conserva Angular core 22.2.3, CLI/build 22.2.4, Delon 22.1.1, single-spa-angular 22.0.1 y single-spa 6.0.3, con @angular/build:application. Se añade únicamente keycloak-js **26.2.4 exacto**; el lockfile conserva las versiones anteriores.

- **OIDC standalone (predeterminado)**: src/main.ts es el único propietario del SDK en esta app. Cliente público autonexus-mf-operations, realm autonexus, IdP http://127.0.0.1:8180 y origen autorizado http://127.0.0.1:4202. Callback exacto /auth/callback, consumido por el helper antes de bootstrap Angular. Layout completo del template, rutas hash /#/widgets y /#/dashboard/v1. Sin Passport, callback social ficticio, guard/token/refresh demo ni usuario Admin estático. El acceso inicial sin sesión ofrece el botón Keycloak; una ruta protegida válida permite iniciar la autorización desde el helper. Un error no activa demo.
- **OIDC integrado**: src/main.single-spa.ts exporta bootstrap/mount/unmount. Recibe IntegratedProps y SessionPort del Shell; no importa ni instancia SDK. Cada mount exige modo oidc, fase authenticated y algún rol reconocido. La validación cliente protege presentación, no sustituye autorización de APIs. No existe fallback si falta la prop. El Shell es dueño de login, renovación, logout y título del documento. Unmount destruye solo aplicación/plataforma/host propios y sus suscripciones, sin logout ni limpiar la sesión padre.
- **Standalone demo**: solo configuración Angular demo, con fileReplacement de main.ts por main.demo.ts y scripts propios. Banner inequívoco, login/guards/mocks del template, datos sintéticos y tokens Delon únicamente en RAM mediante provideAuth(withMemoryStorage()). No tiene SessionPort OIDC ni llama APIs protegidas. No acredita SSO ni CU de negocio.

En todos los modos los gráficos, widgets y menús son **DEMO**, no información del taller ni BFF. Los únicos REST protegidos son los cuatro botones de diagnóstico SessionPort.requestTechnical: session/admin de Empleados/Operaciones. El helper adjunta bearer en RAM a destinos allowlisted; nunca se copia JWT real a Delon, storage ni logs. El usuario y roles OIDC proceden de identidad de sesión, con ACL de presentación setFull(false). Sin rol se informa acceso insuficiente, sin reintento automático de login. Si se pierde sesión, se retiran las vistas protegidas y queda recuperación explícita (el Shell desmonta el MF integrado).

## Parche de ciclo de vida de gráficos (CU01)

`@delon/chart@22.1.1` contiene una carrera en `G2Service`: si se destruye el injector mientras `LazyService.load()` está pendiente, su callback intenta emitir en un Subject ya desuscrito y produce `ObjectUnsubscribedError`. No es un fallo de sesión, ACL ni título.

Se usa el mecanismo oficial **pnpm patch**, no una subclase ni acceso a campos privados desde la app. `patches/@delon__chart@22.1.1.patch` modifica solamente `fesm2022/core.mjs`: bandera `destroyed` propia, retorno inerte de `libLoad()` tras destrucción, guard antes de `loaded`/`notify$.next()` en la resolución diferida y bandera antes del `unsubscribe()` original. Conserva la deduplicación de cargas pendientes, notificaciones de instancias vivas y API pública. No añade catch, silenciamiento de errores ni demoras de navegación.

`pnpm-workspace.yaml` fija `patchedDependencies` para **22.1.1 exacto** con la ruta del parche; `pnpm-lock.yaml` registra su hash SHA-256 `460d5fcf167e627d7c33d38b2ab5e73d3c0cd2d4c4b90828db21e2d27466df72` y la resolución `patch_hash`. `.gitattributes` conserva LF en `patches/*.patch`, incluso con autocrlf en Windows. No se actualiza el framework ni se editan dependencias instaladas a mano. `install --frozen-lockfile` aplica el parche automáticamente. Ambos MFs mantienen el mismo parche literal.

`test:chart-lifecycle` usa el builder Angular/Vitest ya instalado y Chromium headless: importa `G2Service` real mediante su entrypoint público y crea injectors Angular independientes. Solo config y carga externa son dobles de unidad; una promesa controlada evita el CDN. Comprueba emisión viva, una sola carga pendiente, notificación repetida tras carga, destrucción antes de resolución sin emisión/rechazo no manejado, llamadas posteriores inertes y una instancia nueva funcional. Los rechazos no manejados siguen haciendo fallar el runner. No acredita SSO, APIs reales ni navegación integrada. La ejecución Node directa no es compatible con los imports ESM de AntV; no se usa como evidencia de regresión.

Para regenerarlo, desde esta app y con las variables Node/pnpm del bloque siguiente, usar una copia de paquete creada por pnpm en la carpeta ignorada del worktree (no `node_modules`):

~~~powershell
$scratch = [System.IO.Path]::GetFullPath((Join-Path $PWD '../../output/cu01-keycloak/chart-patch-operations'))
& $nodeExe $pnpmEntry patch @delon/chart@22.1.1 --edit-dir $scratch
# Aplicar únicamente las cuatro inserciones de guards/bandera a fesm2022/core.mjs.
& $nodeExe $pnpmEntry patch-commit $scratch --patches-dir patches
# Quitar solo el TAB final del encabezado +++ del parche generado; conservar LF.
& $nodeExe $pnpmEntry install --no-frozen-lockfile
& $nodeExe $pnpmEntry install --frozen-lockfile
& $nodeExe $pnpmEntry run test:chart-lifecycle
& $nodeExe $pnpmEntry exec tsc --noEmit -p tsconfig.app.json
& $nodeExe $pnpmEntry exec tsc --noEmit -p tsconfig.spec.json
~~~

Regresión comprobada con Node **22.22.3** / pnpm **12.6.0**: contra 22.1.1 original, en cada app hubo 4/6 pruebas válidas, 2 fallos y 2 rechazos no manejados `ObjectUnsubscribedError`; tras el parche, 6/6 PASS sin esos errores. Frozen y política de sesión también pasan. Logs ignorados `../../output/cu01-keycloak/g2-operations-{red,green,frozen,session}.log`, con códigos/fechas en `g2-{red,green}-results.json`. Son evidencias de unidad, no SSO.

Con el hash definitivo también pasan los tipos de aplicación/pruebas y los tres builds de producción por app (integrado, OIDC standalone y demo), ejecutados secuencialmente con `NG_BUILD_MAX_WORKERS=2`. Evidencia: `g2-operations-{types,spec-types,integrated,oidc,demo}.log` y `g2-build-results.json` en la misma carpeta ignorada. Se mantienen los avisos de presupuesto/CommonJS; no equivalen a errores de consola de navegador.

Retirar el parche en ambas apps solo cuando una versión upstream comprobada resuelva esta carrera: revisar su implementación, actualizar de forma explícita el contrato de versión y eliminar la entrada/parche mediante pnpm, regenerar lockfiles y repetir estas unidades y los seis builds. La revisión/SSO real posterior corresponde al verificador global; una compilación no demuestra consola limpia.

## Comandos (PowerShell desde esta carpeta)

~~~powershell
$nodeExe = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$pnpmEntry = 'C:/Users/marcelo/AppData/Local/node/corepack/v1/pnpm/12.6.0/bin/pnpm.mjs'
$env:Path = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + $env:Path
$env:NG_BUILD_MAX_WORKERS = '2'
& $nodeExe $pnpmEntry install --frozen-lockfile
& $nodeExe $pnpmEntry run test:session
& $nodeExe $pnpmEntry run test:chart-lifecycle
& $nodeExe $pnpmEntry run build
& $nodeExe $pnpmEntry run build:integrated
& $nodeExe $pnpmEntry run build:demo
# Elegir un modo, no ejecutar ambos en el mismo puerto:
& $nodeExe $pnpmEntry run start:oidc
& $nodeExe $pnpmEntry run start:demo
~~~

Solo 127.0.0.1 está autorizado por configuración de desarrollo; localhost no es alias implícito. Node 22.22.3 y pnpm 12.6.0 se seleccionan por proceso, sin alterar instalación global. Los builds Angular deben ejecutarse secuencialmente entre ambas apps para limitar memoria. Salidas: dist/ng-alain/browser (OIDC standalone), dist/integrated/browser y dist/demo/browser. Después de modificar los MFs, reconstruir ambos y stagear/construir el Shell siguiendo ../shell/README.md; no hay HMR cruzado prometido.

## Composición y límites

History integrado con prefijo /operations; assets ESM/JSON/CSS en /mfs/operations/. El CSS y OverlayContainer siguen dentro del ShadowRoot, sin cambiar estilos globales del Shell. Se conserva el layout standalone. El botón de limpieza solo existe en demo y elimina la clave propia autonexus:demo-cache, nunca localStorage.clear(). Logout OIDC usa el puerto del IdP, no el tokenService legacy.

La gestión empresarial futura usa GraphQL vía BFF; aquí no se implementan BFF, CRUD, CU02, offline ni permisos empresariales por registro. Los cinco roles permiten solo contenedores/diagnósticos técnicos. El endpoint admin sigue autorizado en servidor, no por ocultar un botón. Logout del IdP no revoca instantáneamente JWT ya emitidos; la ventana de expiración se verifica y documenta en la entrega global.

## Evidencia y reproducción

Pruebas de política pura en tests/session-policy.test.mjs (sesión ausente/demo/error/anónima/roles desconocidos y los cinco roles técnicos). Son unidades, no evidencia de Keycloak real. Los logs de instalación frozen, TypeScript y builds están en ../../output/cu01-keycloak/ (ignorados). Se conservan los avisos de budgets y CommonJS, sin elevar límites ni ocultarlos.

Las pruebas reales de navegador/SSO, renovación/logout y API son responsabilidad de la verificación global posterior con IdP y servicios en ejecución. Este cambio no inicia servidores ni acredita esas pruebas por compilar. Estado global y limitaciones en ../../docs/context/STATUS.md; contrato de sesión en ../../contracts/auth/session.ts y especificación en ../../docs/compose/spec/cu01-keycloak.md.
