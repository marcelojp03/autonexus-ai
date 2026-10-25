# MF02 Operaciones

Clientes, vehículos, servicios, citas, recepción, órdenes y avances. Bloque 1 de Marcelo (CU10–CU12, CU15–CU17), y CU06–CU09 del bloque 2; la carpeta no pertenece funcionalmente a un solo participante. Persistencia prevista por APIs y copia offline autorizada.

## Estado actual — primera integración con Shell

Fecha: 2026-10-25. Dos entradas de la misma aplicación Angular: standalone con el layout/login original del template, e integrada sin cabecera ni sidebar propios. Se montan componentes reales de NG-ALAIN, no una imitación ni un iframe. No hay funcionalidades de negocio ni backend.

- Standalone: http://127.0.0.1:4202/, rutas hash, login demo original. `src/main.ts` no se modificó.
- Integrada: http://127.0.0.1:4200/operations, history con prefijo /operations; inicio en widgets. Vistas de demostración: `/operations/widgets` y `/operations/dashboard/v1`.
- Assets y ESM: `/mfs/operations/`. Entrada `src/main.single-spa.ts`: exports bootstrap/mount/unmount, sin autoarranque al importar.
- Verificación histórica inicial: [decisión 001](../../docs/decisions/001-verificacion-templates-angular.md). Estrategia vigente: [decisión 002](../../docs/decisions/002-shell-angular-single-spa.md). Las rutas de documentación correctas desde esta carpeta usan `../../docs/`.

## Versiones comprobadas

Node elegido y fijado en `.nvmrc`: **22.22.3**. Reemplaza 24.20.0 recomendado durante la tarea inicial porque 22.22.3 es la versión compatible efectivamente probada en este equipo. No se cambia el Node global (era 22.14.0, incompatible). Engine de Angular CLI: `^22.22.3 || ^24.15.0 || >=26.0.0`.

| Paquete | Versión instalada |
| --- | --- |
| Angular core | 22.2.3 |
| Angular CLI/build/CDK | 22.2.4 |
| NG-ALAIN / Delon | 22.1.1 |
| NG-ZORRO | 22.1.2 |
| TypeScript / RxJS | 6.0.3 / 7.8.2 |
| single-spa-angular (nuevo) | 22.0.1 exacto |
| single-spa (nuevo) | 6.0.3 exacto |
| pnpm | 12.6.0 exacto |

Se conservan los rangos originales de Angular/Delon/ZORRO; no hubo downgrade ni migración a Webpack. El paquete real del adaptador declara peer Angular >=22 <23 y runtime ESM/zoneless; el schematic ng-add migra a custom-webpack y **no se ejecutó**. Se usa la API v22 con imports nombrados y `provideSingleSpaPlatform()`. Los exports del artefacto generado se comprobaron explícitamente. La prueba de montaje, no solo los peers, acredita esta combinación local.

`pnpm-lock.yaml` se conserva/versiona. Al añadir los dos adaptadores se actualizó mediante install --no-frozen-lockfile; las reinstalaciones de reproducción usan --frozen-lockfile. La política `allowBuilds.plyr=false` y el resto de restricciones de la tarea inicial se mantienen.

## Comandos (PowerShell, desde esta carpeta)

El pnpm global 11.1.2 y Corepack 0.31.0 instalados no lanzan correctamente pnpm 12.6.0. Invocación comprobada en el equipo de Marcelo:

~~~powershell
$nodeExe = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$pnpmEntry = 'C:/Users/marcelo/AppData/Local/node/corepack/v1/pnpm/12.6.0/bin/pnpm.mjs'
$env:Path = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + $env:Path
$env:NG_BUILD_MAX_WORKERS = '2'
& $nodeExe $pnpmEntry install --frozen-lockfile
& $nodeExe $pnpmEntry run build
& $nodeExe $pnpmEntry run build:integrated
# Standalone independiente:
& $nodeExe $pnpmEntry exec ng serve --host 127.0.0.1 --port 4202 --open=false
~~~

Con Node/pnpm correctos ya en PATH, los equivalentes son `pnpm install --frozen-lockfile`, `pnpm run build` y `pnpm run build:integrated`. Salidas separadas: `dist/ng-alain/browser` y `dist/integrated/browser`. Después de construir **ambos** MFs, instalar y ejecutar el Shell según [su README](../shell/README.md). El Shell stagea copias estáticas; tras cambiar un MF, reconstruir y volver a stagear/construir el Shell. No hay HMR cruzado prometido.

## Routing, layout, assets y estilos

- `createAppConfig(false)` conserva router hash, LayoutBasic, login y refresh demo. `createAppConfig(true)` usa history, rutas demo y no registra guards ni refresh Delon. No monta Passport.
- APP_BASE_HREF=/operations mantiene los RouterLink del template dentro del módulo. El wildcard integrado muestra una vista local, sin redirects globales. El Shell reconoce solo la raíz exacta o el prefijo con /, no nombres parecidos.
- El componente raíz integrado usa ShadowDom. Su link a styles.css contiene el LESS global del template dentro de ese árbol; CDK OverlayContainer se inserta en el mismo ShadowRoot. El Shell no carga ese CSS en su documento.
- HTTP de assets e imágenes de las vistas demo usan ASSET_BASE; standalone conserva './'. No se modifica el base href global del Shell.
- En integrado, una imagen decorativa externa del template se reemplaza por su logo local assets/zorro.svg y se omite el tutorial que busca la cabecera original. El standalone conserva esa imagen y tutorial.
- El unmount destruye ApplicationRef y la plataforma **propias**, y vacía solo el host recibido. La raíz integrada no usa las suscripciones globales de app.ts ni localStorage.clear().
- Solo en integrado, Title no escribe sobre el documento: el Shell conserva el título aun después de las actualizaciones asíncronas de Delon. Los márgenes de título de LayoutBasic se ajustan dentro del host, sin ocultar overflow.

## Autenticación demo y límites

El modo integrado es una **demostración pública local sin sesión real**. El banner común lo identifica. Conserva mocks del template para gráficos; no se interceptan ni simulan los bundles, ciclos de vida o assets durante las pruebas. El standalone conserva admin/user demo, callback social ficticio, expiraciones artificiales y ACL completa. Nada de esto acredita CU01, Keycloak ni permisos de servidor. No desplegar este demo como autenticación de producción.

Solo se incluyen vistas del template para comprobar composición. Otros ejemplos, enlaces secundarios de demostración y personalización de temas no forman parte del contrato integrado inicial. No se implementan CU de negocio, GraphQL, SSO, PWA, backend ni offline.

## Evidencia de verificación

Los builds standalone e integrado terminan con código 0 y el Shell compila. Se conservan avisos de tamaño (2,48 MB standalone y ~2,92 MB integrado frente a aviso 2 MB, bajo error 6 MB), CommonJS y Husky deprecado. No se elevaron budgets ni se ocultaron warnings.

Resultados finales de navegación, recarga, consola y capturas: [STATUS](../../docs/context/STATUS.md). Logs de esta tarea: `../../output/shell-integration/`; capturas: `../../output/playwright/shell-*.png`. Los tests de rutas del Shell no sustituyen las pruebas de navegador.

Se preservaron los AGENTS.md locales por SHA-256 y los repositorios Git propios: master, base upstream 58a5297f; ya existían cambios de la tarea anterior. No se creó commit ni se borró/reorganizó Git.
