# Verificación real de navegador CU01

## Ejecutar el conjunto local

CU01 vive en la rama feat/cu01-keycloak, worktree .worktrees/cu01-keycloak. main conserva la base backend integrada en1963ce3; no contiene por ello esta autenticación. No arrancar simultáneamente las versiones main/CU01 en los mismos puertos ni detener procesos de otro proyecto para liberarlos.

El PostgreSQL de Operaciones/Empleados se administra desde infra/compose de la **raíz principal**, no desde el worktree histórico ni el de CU01. Conservar su .env, volumen y credenciales; no ejecutar init-env otra vez. Las dos .env privadas de los servicios de CU01 ya fueron copiadas y comparadas sin regenerar contraseñas. El IdP es independiente y se administra desde infra/keycloak de este worktree.

Seleccionar Node22.22.3/pnpm12.6.0 por proceso, sin cambiar herramientas globales:

~~~powershell
$node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$pnpm = 'C:/Users/marcelo/AppData/Local/node/corepack/v1/pnpm/12.6.0/bin/pnpm.mjs'
$env:Path = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + $env:Path
# Desde la raíz del worktree CU01; init es idempotente y no regenera archivos existentes:
& $node infra/keycloak/scripts/manage.mjs init
& $node infra/keycloak/scripts/manage.mjs bootstrap --background
# Esperar status PASS / exitCode0 en infra/keycloak/.local/bootstrap.result.json.
~~~

En consolas separadas, siguiendo los README de cada servicio:

~~~powershell
# Cwd: services/operations del worktree CU01
$env:JAVA_HOME = 'C:/Program Files/Java/jdk-21'
$env:Path = 'C:/Program Files/Java/jdk-21/bin;' + $env:Path
./mvnw.cmd -B clean verify
. ../../infra/compose/scripts/load-service-env.ps1 -Service operations
& 'C:/Program Files/Java/jdk-21/bin/java.exe' -jar target/operations-0.0.1-SNAPSHOT.jar
~~~

~~~powershell
# Otra consola, cwd: services/employees del worktree CU01; Node/pnpm anteriores
& $node $pnpm install --frozen-lockfile
& $node $pnpm build
. ../../infra/compose/scripts/load-service-env.ps1 -Service employees
& $node $pnpm start:prod
~~~

Las migraciones propietarias ya existen y se verificó una versión por servicio. No crear nuevas tablas ni usuarios para autenticación en esas bases. Para una instalación nueva seguir los comandos de migración de sus README; el estado actual se valida desde la raíz principal con infra/compose/scripts/verify-databases.mjs --require-migrations. El verificador de caída también debe ejecutarse desde ese propietario; cambia estado y restaura solo su PostgreSQL.

Construir cada Angular secuencialmente desde su carpeta: install frozen, test:session, build, build:integrated y, si se probará demo, build:demo. Después, desde web/shell: install frozen, test y build (incluye staging). Arrancar el Shell con preview o dev en4200. Standalone OIDC: start:oidc desde cada Angular, en4201/4202, o servir las salidas ya compiladas dist/ng-alain/browser con fallback SPA. Para demo elegir start:demo explícito en vez de OIDC en ese puerto; la verificación automatizada admite una copia demo en4203. No hay HMR entre proyectos: tras cambiar un MF hay que reconstruir y stagear.

El recorrido real de esta entrega usa previews de los builds de producción, no ng serve/HMR. Comandos equivalentes al runtime comprobado, en consolas separadas con Node/pnpm anteriores:

~~~powershell
# Cwd web/shell: puerto4200 configurado y strictPort
& $node $pnpm preview
# Cwd web/mf-employees, otra consola:
& $node ../shell/node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4201 --strictPort --outDir dist/ng-alain/browser
# Cwd web/mf-operations, otra consola:
& $node ../shell/node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4202 --strictPort --outDir dist/ng-alain/browser
# Opcional, otra consola en web/mf-employees, build demo separado:
& $node ../shell/node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4203 --strictPort --outDir dist/demo/browser
~~~

| Recurso | Dirección local / modo |
| --- | --- |
| Shell integrado | http://127.0.0.1:4200/employees/widgets |
| Empleados standalone | http://127.0.0.1:4201/#/widgets |
| Operaciones standalone | http://127.0.0.1:4202/#/widgets |
| Demo de aceptación opcional | http://127.0.0.1:4203, build demo separado |
| Keycloak | http://127.0.0.1:8180, realm autonexus |
| APIs técnicas | Empleados3002 y Operaciones8081, /technical/session y /technical/admin |
| PostgreSQL aplicación | 127.0.0.1:55432; IdP PostgreSQL sin puerto host |

Las cuentas locales se consultan privadamente en infra/keycloak/.local/test-accounts.json. No imprimir sus contraseñas, pegarlas en comandos o grabar login en HAR/trazas. Para probar manualmente, usar mecanico y comparar la sesión200 con admin403; administrador recibe200 en ambos recursos. Los diagnósticos REST no son CRUD ni BFF; los gráficos siguen siendo sintéticos. Logout deja las APIs stateless con una ventana hasta exp+5s para access tokens emitidos.

## Comandos de aceptación

Desde la raíz de este worktree, con Node 22.22.3 y los runtimes ya arrancados por el responsable principal:

```sh
node --check scripts/verify-cu01-browser.mjs
node --test scripts/service-env-contract.test.mjs
node scripts/verify-cu01-api.mjs
# Esperar a que termine antes de iniciar navegador; prueba expiración real (~65s).
node scripts/verify-cu01-browser.mjs
# Solo si el build standalone-demo explícito está servido en 4203:
node scripts/verify-cu01-browser.mjs --demo-url http://127.0.0.1:4203
# Repetición funcional sin otra ronda visual, solo si no cambió la interfaz
# y ya se generaron/verificaron las capturas anteriores:
node scripts/verify-cu01-browser.mjs --demo-url http://127.0.0.1:4203 --reuse-captures
```

No inicia servidores ni Docker y no instala dependencias. Requiere Shell 4200, standalone OIDC 4201/4202, Keycloak 8180 y APIs Empleados 3002 / Operaciones 8081, siempre en 127.0.0.1. Resuelve la librería ordinaria Playwright ya instalada desde el árbol Angular; no importa el test runner. El fallback es intencional: el sandbox run-code del CLI no dispone de Node fs para cargar el fixture privado de forma segura. El lockfile resuelve Playwright1.64.1; si falta su navegador, ejecutar desde web/mf-employees el CLI instalado con pnpm exec playwright install chromium, usando Node/pnpm fijados. No actualizar paquetes para resolver un ejecutable faltante.

El fixture ignorado `infra/keycloak/.local/test-accounts.json` debe ser un array con las claves `mecanico`, `administrador`, `sin_rol`, `deshabilitado` y sus campos username/password/roles/enabled. Se lee únicamente al ejecutar, mediante fs, y permanece en RAM. La cuenta administrador se valida como precondición; RBAC administrador, expiración y ventana tras logout corresponden al verificador API independiente. No ejecutar ambos verificadores simultáneamente si comparten sesiones IdP.

El recorrido comprueba credenciales erróneas y cuenta deshabilitada en contextos separados; Code/PKCE S256/nonce/state observados; retorno exacto; Shadow DOM/CSS y cabecera única; navegación sin nuevo documento ni login; enlace directo y reload con SSO; refresh real del temporizador con plazo de 50 segundos; diagnósticos UI session200/admin403 en ambos servicios; almacenamiento local/session/IndexedDB sin tokens/JWT ni callbacks pendientes; standalone con clientes propios y cookie SSO; logout anónimo sin módulos antes de pedir login; cuenta sin rol sin módulos ni bucle. Los ejemplos del template deben estar identificados como demostración.

La salida es JSON por etapa, contadores y enums seguros. El proceso devuelve 0 al pasar y 1 ante fallo, indicando la etapa sin imprimir excepción, URL OAuth, identidad, password, headers ni cuerpos. Los errores de consola por 403 técnico esperado se cuentan por separado; el resto de errores JS/consola/recursos debe ser cero. Sin flag demo se emite `demoVerificationSkipped`, no se acredita esa comprobación. Ejecutar desacoplado si el supervisor limita la espera interactiva: el refresh real no se acelera ni se simula.

Solo se generan dos capturas, en una misma sesión: `output/playwright/cu01-desktop.png` (1440) y `cu01-mobile.png` (390). Se enmascaran `#session-identity`, `#technical-result` y `anx-session-controls`; la captura falla cerrada si encuentra nombres del fixture fuera de esas máscaras. No hay capturas de formularios, HAR, trazas, vídeo ni archivos storageState.

Dependencias de selectores: Keycloak `#username`, `#password`, `#kc-login` y alerta de error; Shell `#session-status`, `#session-identity`, `#session-login`, `#session-logout`, `[data-module]`, `[data-page="widgets"]`, `#technical-controls summary`, `[data-technical-service][data-technical-resource]`, `#technical-result`; Angular `anx-employees-root` / `anx-operations-root`, `.workspace`, `.description`, `.ant-card`, stylesheet del ShadowRoot y `.alain-default__header` standalone. No usa hooks privados del SDK ni instrumentación de producción.

El contrato PowerShell se prueba con copias temporales del helper y archivos sintéticos derivados de .env.example, sin leer/modificar .env reales ni conectar a una base. Confirma las tres claves OIDC públicas, rechazo de claves desconocidas y ausencia de valores privados en la salida. El helper de CU01 acepta esas claves opcionales; las credenciales preservadas no se regeneran.

La opción --reuse-captures exige ambos PNG existentes y no acredita una revisión visual nueva: solo se usa para repetir comportamiento cuando la interfaz no cambió. Los resultados globales y la revisión independiente se registran en ../../docs/context/STATUS.md.
