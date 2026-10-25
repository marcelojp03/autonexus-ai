# 002 — Shell single-spa y entradas Angular ESM

Fecha: 2026-10-25.
Estado: implementación local solicitada por Marcelo; resultados finales en STATUS.md. No define contratos backend ni SSO productivo.

## Toolchain y compatibilidad

Se unifica `.nvmrc` de Shell, Empleados y Operaciones en Node **22.22.3**, ya instalado y probado. Sustituye la recomendación 24.20.0 conservada durante la verificación 001; no cambia el Node global del equipo. Angular core sigue en 22.2.3 y CLI/build en 22.2.4, sin downgrade ni migración del builder.

El paquete real single-spa-angular **22.0.1** declara peer Angular `>=22.0.0 <23.0.0`, admite ApplicationRef standalone y `NgZone: 'noop'`. Sus exports reales son nombrados: `singleSpaAngular`, `provideSingleSpaPlatform` y `provideSingleSpa`; no se usan imports antiguos default/getSingleSpaExtraProviders. single-spa se fija en **6.0.3**.

El runtime ESM no depende de Webpack. El schematic ng-add sí reemplaza el builder por custom-webpack; por eso no se ejecuta. Se conserva `@angular/build:application` y se añade una configuración integrada con entrada `main.single-spa.ts`, `index:false`, salida separada y exports bootstrap/mount/unmount. El código instalado de build 22.2.4 configura ESM. La declaración de peers no prueba el montaje: compilación e importación reales son criterios de aceptación separados.

Fuentes primarias consultadas:

- https://registry.npmjs.org/single-spa-angular/22.0.1
- https://unpkg.com/single-spa-angular@22.0.1/types/single-spa-angular.d.ts
- https://unpkg.com/single-spa-angular@22.0.1/fesm2022/single-spa-angular.mjs
- https://unpkg.com/single-spa-angular@22.0.1/schematics/ng-add/rules/update-configuration.js
- https://unpkg.com/@angular/build@22.2.4/src/tools/esbuild/application-code-bundle.js
- https://single-spa.js.org/docs/ecosystem-angular/
- https://angular.dev/api/platform-browser/createApplication
- https://angular.dev/guide/zoneless

## Contrato local de composición

| Propiedad | Empleados | Operaciones |
| --- | --- | --- |
| Registro single-spa | @autonexus/employees | @autonexus/operations |
| Rutas integradas history | /employees, /employees/* | /operations, /operations/* |
| ESM y recursos | /mfs/employees/ | /mfs/operations/ |
| Host Angular | anx-employees-root | anx-operations-root |
| Standalone hash | 127.0.0.1:4201/#/... | 127.0.0.1:4202/#/... |

Shell pasa `{domElement, basePath, assetBase}`. Cada adaptador valida sus prefijos esperados, usa plataforma con `provideSingleSpaPlatform()`, crea ApplicationRef y arranca su componente en el host explícito. El unmount destruye aplicación y plataforma propias y vacía únicamente su contenedor. Angular de cada bundle no se comparte en esta primera etapa; solo una aplicación queda montada a la vez.

La documentación general recomienda APP_BASE_HREF=/ con prefijos en las rutas. Esta integración local usa APP_BASE_HREF=/employees o /operations con rutas internas relativas para conservar los RouterLink absolutos del template dentro de su módulo. No se presenta como receta oficial universal: back/forward, navegación cruzada, enlace directo y remount deben probar esta elección. El wildcard integrado muestra una vista local, nunca redirige al login global ni a otro módulo.

## Layout, assets y estilos

Shell controla cabecera, navegación entre módulos y enlaces demo comunes. La entrada integrada no monta LayoutBasic ni Passport: utiliza las vistas Angular reales de widgets/dashboard del template dentro de un componente raíz ShadowDom. La entrada standalone conserva main.ts, layout y login original. No se oculta una segunda cabecera con CSS.

El CSS global compilado del template se enlaza dentro de cada ShadowRoot, no en el head del Shell. CDK OverlayContainer se aloja en ese mismo árbol. El desmontaje elimina esos enlaces/overlays junto con el host. Los assets HTTP y las imágenes de las vistas integradas usan el namespace de su dueño; standalone usa el valor relativo original. No se cambia el base href del documento global ni se usa iframe.

Shell sirve copias estáticas de ambos bundles construidos mediante stage:mfs. Vite sirve el Shell en 4200 y empaqueta los recursos staged en dist. Tras cambiar un MF se debe reconstruir y volver a stagear/reiniciar el Shell; no se promete HMR entre proyectos. Los servidores dev/preview tienen fallback SPA para enlaces history; un hosting real deberá configurarlo sin convertir assets faltantes en index.html.

## Autenticación y límites

Verificación final: builds integrado/standalone de ambos Angular y build del Shell con código 0; imports ESM, bootstrap/mount/unmount/remount reales en navegador; navegación sin reload, atrás/adelante y cuatro rutas directas con recarga y query string. Una raíz/cabecera, CSS de MF fuera del head global, 0 errores de consola y recursos, y widgets sin overflow a 1440/390 px. Se conserva el arranque standalone de 4201/4202. Evidencia detallada en STATUS y output/shell-integration.

Se adaptan solo en integrado los márgenes de título heredados de LayoutBasic, el onboarding que busca su cabecera y una imagen decorativa externa (se usa assets/zorro.svg existente). Title de Angular tiene un proveedor integrado que evita que las actualizaciones asíncronas de Delon cambien el título global del Shell. Las copias de recursos se sirven con protección 404 antes del fallback SPA.

El modo integrado es una demostración pública local: no pide credenciales ni fabrica una sesión SSO. Mantiene mocks del template para sus gráficos y comunica explícitamente que Keycloak/CU01 real están pendientes. No se monta Passport ni se habilita refresh Delon integrado. El standalone conserva su login simulado. La ACL completa y los datos demo nunca acreditan autorización de negocio.

No se implementan CU01–CU31, backend, PWA/service worker, offline ni funcionalidades de empleados/operaciones. Se verifica el contenedor y las vistas demo, no todo el catálogo de ejemplos del template ni su aptitud productiva. Fuente: solicitud de Marcelo en esta sesión; sin enlace específico de Notion proporcionado.
