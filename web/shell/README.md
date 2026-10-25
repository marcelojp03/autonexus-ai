# Shell y PWA — primera integración local

Navegación y composición del bloque 1, Marcelo (participante 1); los demás participantes integrarán sus MFs por contrato. Tecnología: TypeScript + single-spa. PWA, caché/IndexedDB, service worker y sesión Keycloak **pendientes**.

## Qué ejecuta

Una sola cabecera y navegación común en http://127.0.0.1:4200/. Registra @autonexus/employees y @autonexus/operations con importación ESM nativa de builds Angular reales, sin iframe. Los enlaces cambian entre /employees y /operations sin recargar el documento. Las páginas demo comunes son widgets y dashboard/v1. Rutas desconocidas fuera de ambos prefijos no montan un MF.

El Shell pasa {domElement, basePath, assetBase}; cada MF exporta bootstrap/mount/unmount. Los eventos locales `autonexus:lifecycle` observan el inicio/fin/error de esos hooks reales para depuración, no simulan ejecución. Los MFs standalone siguen en 4201/4202 con su login y layout originales.

El banner comunica **Modo demostración**. Aquí no hay login real ni SSO compartido; Keycloak/CU01 y backend siguen pendientes. No se inventan empleados, órdenes ni indicadores empresariales.

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
| / | replaceState a /employees |
| /employees y /employees/* | MF01; raíz redirige a widgets |
| /operations y /operations/* | MF02; raíz redirige a widgets |
| /mfs/employees/* | ESM, chunks, CSS, imágenes y JSON de MF01 |
| /mfs/operations/* | Recursos de MF02 |
| Otros prefijos | Mensaje de ruta no encontrada, sin MF montado |

Vite dev/preview usa fallback SPA para abrir/recargar rutas history. En un hosting productivo se necesitará fallback equivalente para rutas de UI, **no** para assets faltantes. Una URL inexistente de módulo debe responder error, no HTML con MIME JavaScript. No se ha desplegado a un hosting externo.

## Estilos y responsabilidad visual

Solo el CSS del Shell vive globalmente en el documento. Los Angular montan su CSS de template, componentes y CDK overlays en ShadowRoot propio. La cabecera/nav del template no se monta en integrado; no se la oculta mediante reglas globales. El Shell conserva el lenguaje visual NG-ZORRO azul/navy/gris de las capturas, con banner demo, enlaces activos, estado de carga/error, teclado y versión móvil. El título del documento pertenece al Shell.

## Comandos y resultados comprobados

- Generación oficial y ambas instalaciones (inicial y frozen): código 0.
- typecheck: código 0; test: 2 pruebas de prefijos/rutas, 2 pasan.
- build: código 0; ESM single-spa real en una salida Vite construida. Los pesos del Shell no incluyen como propio el peso de los Angular copiados.
- Navegación real de módulos, exports y hooks observados; ver resultados finales en [STATUS](../../docs/context/STATUS.md).
- Evidencia: `../../output/shell-integration/` y `../../output/playwright/shell-*.png`. No se usaron mocks de Playwright para aprobar la carga de aplicaciones.

El AGENTS original se conserva por hash. No hay Git en la raíz/Shell; no se inicializó ni reorganizó el repositorio general. Las pruebas no acreditan CU de negocio, SSO, backend, offline ni todo el catálogo demo de NG-ALAIN.
