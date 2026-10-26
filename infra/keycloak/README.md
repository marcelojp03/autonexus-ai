# Keycloak local CU01

Infraestructura ejecutable aprobada por docs/compose/spec/cu01-keycloak.md (S2/S5) y contracts/auth/README.md. Solo identidad local; la semilla **no implementa CU02** ni CRUD de empleados. No se acredita SSO de aplicaciones con estas comprobaciones.

## Aislamiento y propietario runtime

Workspace runtime: C:/UAGRM/Ingenieria de Software 2/segundo parcial/autonexus-ai/.worktrees/cu01-keycloak/infra/keycloak.

- Proyecto exclusivo: autonexus-keycloak-dev. Contenedores: autonexus-keycloak-dev-keycloak-1 y autonexus-keycloak-dev-postgres-1.
- Único puerto publicado: 127.0.0.1:8180 → Keycloak8080. Puerto8180 comprobado libre antes del arranque. Gestión/health9000 solo dentro del contenedor; PostgreSQL5432 solo en la red propia.
- Volumen persistente: autonexus-keycloak-dev_idp-postgres-data. Base/rol de aplicación autonexus_idp; administrador PostgreSQL separado idp_database_admin. Aplicación NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION; base propia, sin CONNECT a postgres/template1.
- Los scripts verifican labels de proyecto/servicio/working_dir de contenedores y proyecto/nombre lógico del volumen antes de mutar. Desde otra copia/worktree rechazan ownership de contenedores existentes. No migrar el runtime de ubicación sin una tarea explícita que conserve credenciales/volumen.
- No se administra autonexus-backend-dev, su PostgreSQL55432, bases/usuarios/volumen de Operaciones/Empleados, ni proyectos ajenos. No usar down -v, volume rm/prune ni borrar .env/.local para reinicializar datos existentes.
- HTTP y start-dev son una excepción de desarrollo loopback, no despliegue de producción ni evidencia HTTPS. Docker puede inspeccionar secretos del entorno: exige acceso local de confianza al daemon. Windows hereda ACL de los archivos; los permisos POSIX0600 solicitados por Node no sustituyen ACL del host.

## Contrato público

realm.json no incluye usuarios, contraseñas ni secretos. Realm autonexus; issuer exacto http://127.0.0.1:8180/realms/autonexus; RS256.

| Cliente público | Origen | Redirect exacto | Post-logout exacto |
| --- | --- | --- | --- |
| autonexus-shell | http://127.0.0.1:4200 | http://127.0.0.1:4200/auth/callback | http://127.0.0.1:4200/ |
| autonexus-mf-employees | http://127.0.0.1:4201 | http://127.0.0.1:4201/auth/callback | http://127.0.0.1:4201/ |
| autonexus-mf-operations | http://127.0.0.1:4202 | http://127.0.0.1:4202/auth/callback | http://127.0.0.1:4202/ |

Sin comodines/localhost implícito/client secret. Solo Code Flow; atributo servidor pkce.code.challenge.method=S256, sin implicit/directAccessGrants/serviceAccounts. Recursos bearer-only autonexus-operations-api y autonexus-employees-api; mappers incluyen ambas audiencias en access tokens, no en ID tokens. Scope estándar roles asignado por defecto emite realm_access.roles.

Roles del taller no compuestos: administrador, recepcionista, mecanico, jefe_taller, responsable_financiero. No hay herencia empresarial del administrador. Los roles internos que Keycloak crea para account/master/default-roles no son roles funcionales del taller; se retiran composites del rol predeterminado del realm dedicado para no conceder account/offline grants por defecto a fixtures.

Access60s, SSO idle900s/max3600s, revokeRefreshToken=true y refreshTokenMaxReuse=0. Consumidores deben serializar refresh con la cola del SDK. Logout no revoca de inmediato JWT que una API valida offline: ventana hasta exp+tolerancia5s según contrato.

## Datos privados y provisión

.gitignore excluye .env y .local/ antes de generar; init ejecuta git check-ignore sobre ambos destinos, usa crypto.randomBytes, escritura exclusiva y no imprime valores. Genera contraseñas independientes de PostgreSQL administrador/aplicación, bootstrap admin infraestructura y siete fixtures. .env.example conserva valores vacíos seguros.

.local/test-accounts.json es **ARRAY** de objetos {key,username,password,roles,enabled}. Las claves son exactamente los cinco roles, sin_rol (enabled=true, roles=[]) y deshabilitado (enabled=false, roles=['mecanico']). Username y password aleatorios se conservan. El perfil IdP usa nombre sintético Local Fixture y email derivado del username en example.invalid para satisfacer el perfil estándar sin pedir datos personales al login; no cambia el formato del archivo privado. Consumidores deben leer el archivo en memoria, no mostrarlo ni copiar sus valores a comandos/trazas/capturas. La cuenta bootstrap master es distinta de la fixture administrador.

init repetido conserva bytes existentes; un estado parcialmente inicializado falla cerrado sin sobrescribir. provision crea/reutiliza realm, roles, clientes y cuentas: actualiza configuración pública y enabled; no elimina realm/clientes/usuarios ni resetea contraseñas de cuentas reutilizadas. Roles de taller inesperados en una fixture requieren investigación, no borrado automático. No modifica datos empresariales. Bootstrap administrativo por POST HTTP, credenciales/tokens en RAM, nunca kcadm --password ni passwords en argumentos/URLs. psql recibe el secreto por variable de entorno y lo lee con \getenv, no por argv.

## Comandos PowerShell reproducibles

Ejecutar en el directorio absoluto indicado; no usar Node/pnpm global. No se necesita pnpm ni dependencias npm para estos scripts.

~~~powershell
Set-Location 'C:/UAGRM/Ingenieria de Software 2/segundo parcial/autonexus-ai/.worktrees/cu01-keycloak/infra/keycloak'
$node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
& $node --version
& $node --check scripts/manage.mjs
& $node --test scripts/config.test.mjs
& $node scripts/manage.mjs init
& $node scripts/manage.mjs bootstrap --background
Get-Content .local/bootstrap.result.json
Get-Content .local/bootstrap.log
~~~

El worker desacoplado evita que una herramienta termine Docker/Node a los60s. El launcher devuelve PID; NO acredita éxito del trabajo. Polling con llamadas separadas hasta status=PASS/FAIL y exitCode=0/1 en .local/<acción>.result.json; el log termina EXIT=0/1 y contiene solo etiquetas sanitizadas, nunca bodies OAuth/Authorization. No ejecutar dos workers mutadores simultáneos. Se reemplaza únicamente el resultado/log de esa acción, jamás credenciales. Para separar pasos: acciones up, provision y verify (también admiten --background).

~~~powershell
& $node scripts/manage.mjs verify-idempotency --background
Get-Content .local/verify-idempotency.result.json
Get-Content .local/verify-idempotency.log
# Esperar PASS antes de la siguiente acción: reinicia SOLO Keycloak.
& $node scripts/manage.mjs verify-persistence --background
Get-Content .local/verify-persistence.result.json
Get-Content .local/verify-persistence.log
~~~

verify comprueba Admin API real, discovery, JWKS, tiempos/rotación, clientes/origins/mappers, cuentas/roles, rechazo sin PKCE y con plain, rol SQL no-superuser, ownership/volumen/health y publicaciones de puertos. No imprime identificadores privados. verify-idempotency compara bytes privados e IDs en memoria antes/después de init/provision. verify-persistence compara IDs/configuración antes/después de reiniciar solo el contenedor Keycloak; PostgreSQL y todos sus datos permanecen activos.

Nunca ejecutar docker compose config sin --quiet, docker inspect completo/Config.Env, ni imprimir .env, cuentas, cuerpos token endpoint o logs sin sanitizar. Los scripts capturan salida de subprocesos y omiten diagnósticos potencialmente sensibles al fallar. Investigar errores con campos seleccionados y redacción, no desactivar validaciones de ownership.

## Versiones, fuentes y resultados reales

Verificado localmente2026-10-25/26 (fecha UTC de logs26): Node22.22.3; Docker cliente/servidor29.9.2; Compose5.6.0; Keycloak26.8.1/JVM21.0.12.1; PostgreSQL17.11 (Debian17.11-1.pgdg12+2). El SDK frontend acordado keycloak-js26.2.4 tiene minor distinto legítimo; no se cambió ni instaló aquí.

- Release: https://api.github.com/repos/keycloak/keycloak/releases/tags/26.8.1 y https://github.com/keycloak/keycloak/releases/tag/26.8.1. Metadata real tag26.8.1, draft=false, prerelease=false, publicada2026-10-13T08:58:15Z.
- Manifest real: docker manifest inspect quay.io/keycloak/keycloak:26.8.1 --verbose. Linux amd64 digest sha256:3e1ac632e743660017b1e6bb4c3ffc800fd02c82cdd0db858cd03456a98a8dfc; también arm64/ppc64le. La imagen runtime y kc.sh --version confirmaron26.8.1. Imagen PostgreSQL fijada postgres:17.11-bookworm, postgres --version confirmó17.11.
- PASS --check y seis pruebas sin secretos (node --test), incluida búsqueda en RAM de valores privados en archivos públicos/logs/resultados.
- PASS init y git check-ignore antes de escribir; provision HTTP real y verify real. Bootstrap definitivo PASS2026-10-26T03:41:53Z, con perfiles sintéticos completos sin requiredActions.
- PASS verify-idempotency definitivo2026-10-26T03:43:48Z, exitCode=0/EXIT=0: mismas cuentas/clientes y mismos bytes privados, sin password reset. Incluye verificación final de ownership de volumen y puertos reales.
- PASS verify-persistence (2026-10-26T03:35:50Z): IDs de siete cuentas y cinco clientes/configuración conservados tras restart exclusivamente de Keycloak; PostgreSQL IdP nunca detenido. Ambos contenedores healthy al cierre, con mismo volumen.
- Intentos iniciales no acreditados: sintaxis bash rechazada por terminal PowerShell (sin mutaciones), consultas cortadas por presupuesto de herramienta, bootstrap frío terminó FAIL sin diagnóstico retenido por el worker inicial, y un verify previo finalizó por await sin handle referenciado durante arranque. Se corrigió manteniendo un handle durante el worker y esperando health en persistencia; reejecuciones definitivas son las acreditadas. No se borró volumen ni regeneraron secretos para recuperarse.
- Advertencias de Keycloak conservadas: identity-brokering-api:v1/twitter-broker:v1 y shouldAttachRoute deprecados. No afectan estos clientes locales y no se ocultan cambiando versiones.

## Límites de evidencia

No se prueba Shell, standalone, backend protegido, login/SSO entre módulos, credenciales incorrectas, refresh real del SDK, logout ni tokens emitidos en navegador; corresponden al principal. Inspeccionar mappers y rechazar PKCE inválido no sustituye comprobar access/ID tokens reales en ese recorrido. No se acredita CU01 completo, CU02, datos de negocio ni producción. No se cambiaron AGENTS, contratos, spec, STATUS, decisiones ni otras fuentes. Sin commits ni Git init.
