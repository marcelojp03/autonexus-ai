# Shell y PWA — primera integración local

## Runtime vigente de CU01 integrado

Ejecutar esta aplicación desde su carpeta en la raíz principal autonexus-ai. CU01 ya está en main b8d8079; las referencias a .worktrees/cu01-keycloak en la evidencia posterior son históricas. Ambos Compose se administran desde infra/compose e infra/keycloak de raíz, conservando privados y volúmenes. Ubicaciones, comandos y límites: docs/decisions/006-cu01-main-runtime.md y scripts/cu01/README.md (rutas desde la raíz). No se hizo push ni se eliminaron ramas/worktrees.

Navegación y composición del bloque 1, Marcelo (participante 1); los demás participantes integrarán sus MFs por contrato. Tecnología: TypeScript + single-spa. CU01 añade sesión OIDC Keycloak; PWA, caché/IndexedDB y service worker siguen pendientes.

## Qué ejecuta

Una sola cabecera y navegación común en http://127.0.0.1:4200/. Registra @autonexus/employees y @autonexus/operations con importación ESM nativa de builds Angular reales, sin iframe. Los enlaces cambian entre /employees y /operations sin recargar el documento. Las páginas demo comunes son widgets y dashboard/v1. Rutas desconocidas fuera de ambos prefijos no montan un MF.

El Shell pasa {domElement, basePath, assetBase, session}; cada MF exporta bootstrap/mount/unmount. Los eventos locales `autonexus:lifecycle` observan el inicio/fin/error de esos hooks reales para depuración, no simulan ejecución. Los MFs standalone siguen en4201/4202 con layout completo y propietario OIDC explícito; el login original solo pertenece al modo demo dedicado.

El banner identifica las páginas/gráficos del template como ejemplos, no como operaciones de negocio. La sesión normal del Shell es exclusivamente OIDC: no hay fallback demo. No se inventan empleados, órdenes ni indicadores empresariales.

## CU01: sesión y autorización técnica

keycloak-js26.2.4 exacto, instanciado una vez por documento en src/main.ts. Helper común sin dependencias runtime en ../browser-auth/session.ts; ver su README para interfaces/exports. Issuer local http://127.0.0.1:8180/realms/autonexus; cliente público autonexus-shell; callback exacto http://127.0.0.1:4200/auth/callback; post-logout http://127.0.0.1:4200/. No usar localhost como alias.

El Shell pasa también session: SessionPort del contrato ../../contracts/auth/session.ts. Integrado nunca crea SDK; standalone4201/4202 tiene propietario OIDC independiente. Authorization Code standard + PKCE S256 + nonce, respuesta fragment, iframe/logging desactivados. Callback consumido por SDK y URL limpiada antes del montaje. Solo ruta interna validada en sessionStorage; tokens únicamente en memoria SDK. Recargar una ruta protegida inicia nueva autorización que reutiliza cookie SSO del IdP cuando existe. La raíz anónima muestra Ingresar sin autologin, evitando bucles después de logout.

Snapshot inmutable con identidad/cinco roles filtrados; single-spa solo monta con sesión autenticada y algún rol reconocido. Cuenta sin roles muestra acceso insuficiente y salida/cambio de cuenta. No se concede ACL empresarial estática. Refresh10s y updateToken(30) antes de diagnósticos; fallo elimina SDK/estado/timer, desmonta y permite ingreso explícito. Epoch bloquea respuestas tardías. Logout invalida el puerto inmediatamente, espera desmontaje de consumidores y usa POST oficial; conserva ID token RAM hasta capturar formulario, luego limpia. No hay JWT en querystring, globals o logs.

Diagnósticos REST explícitos de Empleados3002/Operaciones8081, recursos /technical/session y /technical/admin únicamente. Cookies omitidas, redirect:error, timeout10s y DTO validado.401 invalida sesión;403 explica falta de permiso sin cerrar sesión. No es CRUD ni sustituye el futuro BFF GraphQL. Access tokens emitidos pueden seguir aceptados por APIs que validan offline hasta su expiración60s+5s de tolerancia después del logout; no se promete revocación inmediata.

## Versiones y generación

Node **22.22.3** en .nvmrc, compatible con el engine de Angular. pnpm **12.6.0**, single-spa **6.0.3**, Vite **8.3.5**, TypeScript **6.0.3**, fijados y con pnpm-lock.yaml. Se usó el generador oficial `create-vite@9.3.1` con `vanilla-ts` en un destino temporal .scaffold-temp, mediante `pnpm dlx create-vite@9.3.1 .scaffold-temp --template vanilla-ts --no-interactive`; se trasladaron solo los archivos necesarios, sin sobrescribir AGENTS/README. Los intentos con rutas absolutas no se usaron como base del proyecto.

Compatibilidad de Angular/runtime/builder y decisiones: [002](../../docs/decisions/002-shell-angular-single-spa.md). No se ejecutó ng-add ni se reemplazó @angular/build:application. Compatibilidad declarada de peers y montaje real se verifican por separado.

## Preparación y ejecución

Primero instalar y construir `build:integrated` en **cada** Angular; ver [Empleados](../mf-employees/README.md) y [Operaciones](../mf-operations/README.md). Sus salidas deben existir:

~~~text
web/mf-employees/dist/integrated/browser/main.js
web/mf-employees/dist/integrated/browser/styles.css
web/mf-operations/dist/integrated/browser/main.js
web/mf-operations/dist/integrated/browser/styles.css
~~~

Después, desde web/shell, usar Node/pnpm compatibles. En el equipo verificado, los launchers globales fallan con pnpm12; esta invocación directa funciona:

~~~powershell
$nodeExe = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$pnpmEntry = 'C:/Users/marcelo/AppData/Local/node/corepack/v1/pnpm/12.6.0/bin/pnpm.mjs'
$env:Path = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + $env:Path
& $nodeExe $pnpmEntry install --frozen-lockfile
& $nodeExe $pnpmEntry run typecheck
& $nodeExe $pnpmEntry test
& $nodeExe $pnpmEntry run build
& $nodeExe $pnpmEntry run preview
~~~

`build` ejecuta prebuild/stage-mfs, TypeScript y vite build. La salida `dist/` incluye los dos MFs staged. `preview` sirve esa salida ya construida en 4200; fue la usada para probar el navegador. `dev` sirve desarrollo y ejecuta predev/staging; `stage:mfs` permite repetir solo la copia. Ambos servidores usan 127.0.0.1 y strictPort, sin elegir silenciosamente otro puerto.

El staging valida ambos main.js/styles.css antes de reemplazar únicamente `public/mfs/employees` y `public/mfs/operations`, generados e ignorados por Git. Son copias recuperables desde cada dist/integrated, no código fuente. Tras cambiar un MF, reconstruirlo y reconstruir/stagear el Shell; no se promete HMR cruzado. No borrar src ni AGENTS para regenerar.

## Rutas y hosting

| Ruta | Dueño / comportamiento |
| --- | --- |
| / | Entrada anónima con botón Ingresar, sin autologin |
| /auth/callback | Consumo SDK, limpieza URL y retorno interno validado (default /employees) |
| /employees y /employees/* | MF01; raíz redirige a widgets |
| /operations y /operations/* | MF02; raíz redirige a widgets |
| /mfs/employees/* | ESM, chunks, CSS, imágenes y JSON de MF01 |
| /mfs/operations/* | Recursos de MF02 |
| Otros prefijos | Mensaje de ruta no encontrada, sin MF montado |

Vite dev/preview usa fallback SPA para abrir/recargar rutas history. En un hosting productivo se necesitará fallback equivalente para rutas de UI, **no** para assets faltantes. Una URL inexistente de módulo debe responder error, no HTML con MIME JavaScript. No se ha desplegado a un hosting externo.

## Estilos y responsabilidad visual

Solo el CSS del Shell vive globalmente en el documento. Los Angular montan su CSS de template, componentes y CDK overlays en ShadowRoot propio. La cabecera/nav del template no se monta en integrado; no se la oculta mediante reglas globales. El Shell conserva el lenguaje visual NG-ZORRO azul/navy/gris de las capturas, con banner demo, enlaces activos, estado de carga/error, teclado y versión móvil. El título del documento pertenece al Shell.

## Comandos y resultados históricos de composición (antes de CU01)

- Generación oficial y ambas instalaciones (inicial y frozen): código 0.
- typecheck: código 0; test: 2 pruebas de prefijos/rutas, 2 pasan.
- build: código 0; ESM single-spa real en una salida Vite construida. Los pesos del Shell no incluyen como propio el peso de los Angular copiados.
- Navegación real de módulos, exports y hooks observados; ver resultados finales en [STATUS](../../docs/context/STATUS.md).
- Evidencia: `../../output/shell-integration/` y `../../output/playwright/shell-*.png`. No se usaron mocks de Playwright para aprobar la carga de aplicaciones.

El AGENTS original se conserva. Actualmente el proyecto usa el monorepositorio raíz; las referencias anteriores a ausencia de Git son históricas. Las pruebas históricas no acreditan CU01/SSO, offline ni todo el catálogo demo.

## Verificación aislada de CU01 — histórica, antes de la integración global

En la verificación aislada se ejecutaron con Node22.22.3/pnpm12.6.0 exactos: add keycloak-js@26.2.4 --save-exact, install --frozen-lockfile, test, run typecheck y exec vite build, todos con exit0. Las pruebas de sesión usan SDK/fetch falsos y no acreditan SSO. Esa fase no stageó ni inició el runtime global.

El principal completó después run build con staging de ambos Angular finales y comparación de hashes,15 unidades y el recorrido real descrito en STATUS: Code/PKCE, navegación sin otro documento/login, reload, refresh, standalone, logout, roles y demo. Las respuestas403 deliberadas se distinguen de errores inesperados. Se comprobó la ausencia de tokens persistidos y se corrigió la emisión G2 tras desmontaje, sin silenciar console.error. Guía conjunta: ../../scripts/cu01/README.md.

## Recuperación de BFCache

pagehide invalida y destruye el propietario de sesión. Una restauración BFCache no reevalúa el módulo: pageshow con persisted=true fuerza por ello una recarga del mismo destino, creando un propietario nuevo y reevaluando SSO. No afecta cambios SPA entre módulos ni pageshow inicial. Así no se conserva una sesión ya destruida o identidad obsoleta al volver desde otro documento.

Regresión: scripts/verify-cu01-bfcache.mjs desde la raíz. --synthetic-events reproduce explícitamente PageTransitionEvent.persisted en Chromium y verifica recarga efectiva y navegación posterior al IdP; no simula SDK ni credenciales. El intento de BFCache nativo no fue elegible (notRestoredReasons=masked), por lo que no se acredita un hit nativo del cache en este entorno. El recorrido SSO principal es real e independiente de esta prueba de eventos.

## Navegación CU03 y transporte al BFF

El Shell expone `Empleados (CU03)` y `Registrar empleado` solo cuando el módulo activo es Empleados. La sesión sigue siendo la única propietaria de los tokens: el contrato añade `SessionPort.requestBusiness`, que renueva el token, llama a `http://127.0.0.1:3004/graphql` y devuelve datos o errores tipados. El token no se pasa a los microfrontends, no se escribe en storage y no se registra.

El servidor estático `scripts/serve-dist.mjs` sirve el build para verificaciones automatizadas (sin dependencia de stdin), con fallback SPA y 404 estricto para recursos `/mfs/`.