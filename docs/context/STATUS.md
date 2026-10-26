# Estado comprobado

## CU03 backend propietario — implementado y verificado; revisión independiente pendiente

Fecha2026-10-26. Rama feat/cu03-employees, worktree .worktrees/cu03-employees, base CU01 b8d8079 e incorporación de main89bc8e1. Contratos REST/GraphQL/autenticación publicados antes de implementar en12f44e6. Especificación aprobada docs/compose/spec/cu03-employees.md y decisión007. Sin push ni merge CU03 a main; no se tocaron AGENTS ni se reasignó el BFF del participante2.

Backend real de consulta/listado/historial, alta, modificación y desactivación sin borrado. Datos personales/laborales, cargo y especialidades; duplicados incluso inactivos, control de versión, auditoría e idempotencia ligada a actor/acción/destino/contenido. Siete endpoints autorizan administrador usando sesión CU01; cargo/especialidades no son roles. Persistencia exclusivamente PostgreSQL de Empleados: migración1793023200000 y cuatro tablas propias; Empleados ahora tiene2migraciones y Operaciones conserva1. No synchronize ni reinicialización de bases.

Cuenta Keycloak opcional con UUID empresarial/employeeId admin-only y subject estable. Cliente confidencial técnico autonexus-employees-admin con client_credentials, manage-users y scope explícitos; backend no usa bootstrap/personales. Su secreto nuevo se guarda por separado y se conservan los privados CU01. manage-users tiene alcance realm-wide; ownership por empleado se limita en adaptador, no es FGAP del IdP. Sin roles empresariales ni credencial habilitada la cuenta no tiene acceso operativo; synced no acredita CU02.

Transacción local empleado/historial/intención/resultado; IdP fuera de transacción, lock de sesión compartido por mutación/sync. Estado laboral separado de pending/synced/failed/conflict. Retry explícito recupera tras reinicio y éxito remoto con respuesta o confirmación SQL perdida, sin duplicar cuentas. Ownership incompatible no modifica cuenta ajena. No worker automático ni transacción atómica PostgreSQL+Keycloak.

| Verificación observada | Resultado |
| --- | --- |
| Empleados frozen/build | PASS, lockfile/versiones conservados; build final exit0 |
| Unitarias finales | PASS55/8archivos; incluye40CU01/base y15CU03; texto/Unicode rojo→verde y protección identidad propia |
| HTTP final, sin paralelismo entre archivos | PASS42/3archivos;32CU01/base+10CU03; RSA sintético/repositorio falso explícitos |
| Lint/tipos final | PASS exit0;0errores/0advertencias de lint |
| Matriz PostgreSQL+Keycloak real | PASS12grupos: persistencia, migración/no-op,401/403, duplicados/versión/historial, desactivación, cuenta opcional, respuesta perdida/reinicio/retry, ownership ajeno, fallo SQL posterior al remoto, lock entre conexiones y caída/restauración IdP real |
| Funcional real posterior a validación final | PASS8grupos/exit0, incluido duplicado concurrente; no repite caída/recuperación no afectadas |
| Contratos finales | OpenAPI3.1/referencias y sintaxis SDL PASS; no resolvers/BFF ejecutables |
| Regresión CU01 desde raíz tras cambios IdP | PASS13etapas/exit0,0errores inesperados/recursos fallidos y2x403 intencionales; SQL aislamientoPASS, versiones1/2 |

Evidencia local ignorada en output/cu03-employees del worktree: {build,test,test-e2e,lint,types}.{log,exit}, real.log/real.exit y functional-final.log. CU01: output/cu01-main-integration de raíz. Dos fallos iniciales de verificadores no acreditados: fixture documento41caracteres excedía40 y comparación entre representaciones IdP distintas; corregidos sin relajar reglas. Compilación inicial corrigió API real de QueryRunner sin genéricos; HTTP añadió probe falso explícito y ejecución secuencial, sin añadir secretos ni ocultar tests. Los PASS anteriores son ejecuciones posteriores observadas, no esos intentos.

Aplicaciones CU01 y ambos Compose permanecen en raíz. CU03 real se ejecutó desde el worktree con Nest en puerto efímero y se cerró al terminar; no hay proceso CU03 permanente acreditado. README explica PORT3003 manual para conservar CU01 en3002. Los registros de prueba son sintéticos, se conservan y desactivan; no se borran empleados/historia. Triggers temporales de fallo se retiran en finally; IdP propio restaurado.

BFF sigue siendo carpeta reservada, sin aplicación. Se entregan contratos al participante2; mf-employees conserva NG-ALAIN/demos y NO llama REST empresarial. No acreditar interfaz integrada, CU03 web completo, CU02, jornadas, agenda, Saga, otros servicios, Kubernetes ni producción. El cierre compose-next sigue sujeto a revisión independiente; fallos SQLite del sistema de agentes impidieron delegaciones de implementación y no se sustituyen por revisión propia.

## CU01 integrado: runtime definitivo verificado (2026-10-26)

La inspección inicial encontró main y feat/cu01-keycloak ya en b8d8079, divergencia0/0 y worktrees limpios. b8d8079 es hijo de86d81af y exclusivamente documental; código revisado1963ce3..86d81af. No se repitió un merge. Se preservan ramas/worktrees, sin push. Los apartados CU01 anteriores que sitúan main en1963ce3 son históricos.

Las seis aplicaciones se ejecutan ahora desde sus carpetas de raíz (rutas absolutas de artefactos verificadas). PostgreSQL empresarial conserva ownership infra/compose de raíz; IdP fue recreado con ownership/config/bind infra/keycloak de raíz sobre el MISMO volumen nombrado. Configuraciones privadas IdP/servicios comparadas byte a byte con worktree, sin regenerar secretos ni reinicializar bases. Ambos volúmenes existentes y tres contenedores healthy. Ver decisión006.

Builds afectados desde raíz PASS con exit0: Operaciones package -DskipTests, Empleados frozen/build, Angular OIDC/integrados y demo Empleados, Shell frozen/build/staging. No se repitieron suites completas CU01 por rutina. Regresión ownership Windows: red con separadores dobles, green1/1 y comparación completa de ubicaciones. manage.mjs verify PASS con IdP real. verify-main-runtime.mjs PASS en ownership/volúmenes/privados/readinessSQL/401.

Smoke real terminado desde raíz: browser13 etapas PASS/exit0, loginPKCE, navegación sin nuevo documento/login, reloadSSO, refreshreal, APIs200/403, standalone, logout, sin rol y demo;0 pageErrors/errores inesperados/recursos fallidos,2x403 intencionales. PostgreSQL17.11: aislamientoPASS,3rechazos por rol y1migración por servicio, exit0. Evidencia: output/cu01-main-integration/{browser-main.log,browser-main.exit,postgres-main.log,postgres-main.exit} y builds *.exit.

Límite honesto: el auxiliar de traslado se interrumpió después de recrear IdP y no retuvo el snapshot previo de IDs. No se acredita otra comparación automática antes/después de todos los IDs; sí volumen nombrado existente, bytes privados idénticos, configuración/cuentas y autenticación reales conservadas. Una sesión auxiliar falló por SQLite bloqueado del harness; el principal retomó y verificó sin repetir recreaciones.

Fecha: 2026-10-26. Los apartados anteriores de base/composición conservan fechas y resultados históricos.

## Preparado

- Estructura de 13 aplicaciones previstas y carpetas compartidas.
- Reglas para IA, copias de Notion y 31 especificaciones de CU.
- Participante 1 identificado: Marcelo, bloque 1. Se conserva el reparto por CU; Operaciones incluye CU06–CU09 del bloque 2.
- Templates NG-ALAIN presentes directamente en web/mf-employees y web/mf-operations, con AGENTS locales preservados. La primera verificación partió de src idénticos; ahora existen entradas integradas propias, conservando el diseño standalone.

## Verificación inicial Angular MF01 / MF02 (histórico)

Verificación local del 2026-10-25. La raíz AutoNexus no tiene metadatos Git; cada template conserva un repositorio propio, rama master, commit base 58a5297f (release 22.1.1). AGENTS.md y README.md ya estaban modificados respecto al upstream antes de esta tarea. No se crearon commits ni se alteró la estructura Git.

| Comprobación                                  | MF01 Empleados             | MF02 Operaciones           |
| --------------------------------------------- | -------------------------- | -------------------------- |
| package.json / angular.json en raíz local     | Sí                         | Sí                         |
| Instalación pnpm 12.6.0 con --frozen-lockfile | Código 0                   | Código 0                   |
| Build producción (pnpm run build)             | Código 0, 144.379 s        | Código 0, 144.677 s        |
| Bundle desarrollo / serve                     | Generado, 109.276 s        | Generado, 109.303 s        |
| HTTP real independiente                       | 200 en 127.0.0.1:4201      | 200 en 127.0.0.1:4202      |
| Smoke navegador                               | Login demo → dashboard/v1  | Login demo → dashboard/v1  |
| Consola del recorrido probado                 | 0 errores / 0 advertencias | 0 errores / 0 advertencias |

- Versiones resueltas en ambos: Angular core 22.2.3, CLI/build/CDK 22.2.4, NG-ALAIN/Delon 22.1.1, NG-ZORRO 22.1.2, TypeScript 6.0.3, RxJS 7.8.2. No se modificó package.json: se conservaron todos los rangos del template.
- No venía ningún lockfile. Se generó pnpm-lock.yaml con install --no-frozen-lockfile y luego se validó install --frozen-lockfile. Se habilitó su versionado en .gitignore y se alineó cli.packageManager de Angular con pnpm.
- Node activo inicial 22.14.0 incompatible; pruebas con 22.22.3 ya instalado y PATH de proceso, sin cambiar Node global. .nvmrc conserva 24.20.0. Engine CLI: ^22.22.3 || ^24.15.0 || >=26.0.0.
- Se sorteó la incompatibilidad de launchers pnpm 11/Corepack 0.31.0 con pnpm 12 mediante el bin/pnpm.mjs de 12.6.0. Primera instalación señaló ERR_PNPM_IGNORED_BUILDS por plyr; tras inspeccionar su preinstall, allowBuilds.plyr=false explícito permitió la instalación frozen. No se aprobaron scripts globalmente.
- Advertencias no bloqueantes: bundle inicial producción 2,48 MB > aviso 2 MB (bajo error 6 MB), cinco dependencias CommonJS y husky install deprecado. No se ocultaron avisos ni se cambiaron budgets.
- READMEs de ambas apps documentan comandos reales, layout, menú estático, rutas hash, autenticación Delon y mocks. Propuestas de integración Shell diferenciadas de acuerdos: chrome, prefijos, lifecycles single-spa/zoneless, assets, SSO/refresh, GraphQL y limpieza de efectos globales.
- Evidencias locales: output/angular-verification/_-build.log (marcador BUILD_EXIT=0), logs de instalación/serve y output/playwright/_-dashboard.yml. La captura de pantalla excedió el timeout y no se considera evidencia. No hubo cambios en src, _mock, estilos ni AGENTS locales.

## Primera integración Shell + Angular — comprobada

Fecha: 2026-10-25. Implementación local del participante 1, sin CU de negocio. Estrategia y fuentes: docs/decisions/002-shell-angular-single-spa.md. Se conservaron todos los AGENTS.md por SHA-256 y los cambios de la tarea previa; no se creó commit ni se alteró la estructura Git.

- Node seleccionado: **22.22.3**, fijado en los tres .nvmrc. Sustituye 24.20.0 de la línea base inicial porque es compatible y fue efectivamente probado. El Node global 22.14.0 no se cambió.
- Paquetes nuevos fijados: single-spa-angular 22.0.1 (peer Angular >=22 <23) y single-spa 6.0.3. Core Angular 22.2.3 y CLI/build 22.2.4 se mantienen. Runtime ESM standalone/zoneless comprobado; no se ejecutó ng-add porque su schematic migra a custom-webpack. Se conservó @angular/build:application.
- Shell generado con create-vite 9.3.1 vanilla-ts; Vite 8.3.5, TypeScript 6.0.3 y pnpm 12.6.0 exactos, con lockfile. Instalaciones frozen de los tres proyectos: código 0.
- Entradas Angular separadas: main.ts standalone hash con layout/login originales; main.single-spa.ts integrado history, sin chrome del template. Registros @autonexus/employees y @autonexus/operations, prefijos /employees y /operations, recursos /mfs/employees/ y /mfs/operations/.
- CSS del template y CDK overlays dentro del ShadowRoot de cada módulo. Desmontaje destruye aplicación/plataforma propias y limpia su host; no iframe. El Shell controla cabecera, navegación y título del documento. Los márgenes de títulos del template se adaptaron solo dentro del host integrado para evitar overflow móvil.
- Demo explícito: vistas reales de widgets/dashboard del template, mocks de gráficos, sin sesión SSO ni Passport integrado. Logo decorativo local en lugar de una imagen remota y onboarding de la cabecera omitido solo en integrado. Keycloak/CU01 real siguen pendientes.

| Verificación real                                    | Resultado                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| pnpm install --frozen-lockfile, 3 apps               | Código 0                                                                             |
| pnpm run build:integrated, ambos Angular             | Código 0, exports bootstrap/mount/unmount presentes                                  |
| pnpm run build standalone, ambos Angular             | Código 0                                                                             |
| Shell typecheck / build                              | Código 0 (build incluye tsc, staging y Vite)                                         |
| Shell test                                           | 2 pruebas de rutas, 2 pasan                                                          |
| Navegador Empleados → Operaciones → Empleados        | Mismo performance.timeOrigin; hooks reales; host anterior vacío; una raíz y cabecera |
| Atrás / adelante                                     | Navegación correcta sin recargar documento                                           |
| Enlace directo + reload                              | widgets y dashboard/v1 en ambos prefijos; conserva query string y título del Shell   |
| Assets/chunks/CSS/JSON/favicon                       | Recursos reales HTTP 200 y MIME correcto; sin peticiones simuladas por Playwright    |
| Recurso /mfs/ inexistente                            | HTTP 404, nunca fallback HTML                                                        |
| Prefijo parecido /employees-other                    | No monta MF; mensaje de ruta desconocida                                             |
| Wildcard local /operations/not-available             | Mensaje dentro del módulo, sin redirect global                                       |
| Consola / recursos del recorrido integrado final     | 0 errores, 0 advertencias; 0 respuestas fallidas de recursos                         |
| Widgets escritorio 1440 px / móvil 390 px, ambos MFs | Sin overflow horizontal; una cabecera; ningún CSS /mfs en head del Shell             |
| Standalone en 4201 / 4202                            | Login demo → #/widgets; una cabecera del template y ninguna del Shell                |

Se corrigieron durante verificación: favicon faltante, imagen externa, tutorial dependiente del layout, campo TS del modo integrado, márgenes negativos de título móvil y escritura asíncrona de Title de Delon. La revisión independiente encontró un mensaje de error persistente tras recuperarse una carga; se limpia al reintentar y al montar correctamente. No quedaron bloqueantes del recorrido requerido. La recuperación ante fallos transitorios no se provocó artificialmente como evidencia de integración.

Advertencias conservadas: bundle inicial standalone 2,48 MB e integrado ~2,92 MB frente al aviso de 2 MB, bajo error de 6 MB; CommonJS y Husky deprecado. El Shell añade ~21,23 kB de JS propio (no incluye el peso de los MFs copiados). No se cambiaron budgets ni versiones Angular para ocultarlas.

Comandos y condiciones de reproducción en web/shell/README.md y ambos README Angular. Logs finales en output/shell-integration/ (builds con EXIT=0, instalaciones, pruebas y scripts/resultados de navegador); capturas output/playwright/shell-{employees,operations}-{desktop,mobile}.png. Los logs *-intermediate.log registran una iteración fallida corregida, no resultados finales.

Servidores locales al cierre: Shell preview en 127.0.0.1:4200; standalone en 4201/4202. Sesiones de navegador automatizado cerradas al terminar. Staging sirve copias generadas: tras cambiar un MF, reconstruirlo y volver a stagear/construir el Shell; no hay HMR cruzado prometido. No se desplegó a hosting externo ni se probó todo el catálogo demo.

## Organización Git vigente

El 2026-10-25 Marcelo indicó usar un único monorepositorio en `autonexus-ai`. Se inicializó la raíz en `main` y se configuró `origin=https://github.com/marcelojp03/autonexus-ai.git`, sin push. Se confirmó que los dos `.git` Angular pertenecían a NG-ALAIN, no a AutoNexus, y se retiraron a la Papelera con autorización; fuentes/AGENTS/lockfiles preservados. El `.gitignore` raíz excluye dependencias/builds/cachés, entornos reales, secretos, datos locales y artefactos de verificación, conservando lockfiles y ejemplos. Ver decisión 003. Las referencias anteriores a falta de Git son históricas.

## Base backend MS01/MS02 — técnica terminada y revisada

Fecha: 2026-10-25. Rama feat/backend-foundation, worktree .worktrees/backend-foundation, base main7bc80a7. Especificación aprobada: docs/compose/spec/backend-foundation.md; decisión004. Sin merge/push automático ni CU de negocio terminado.

- Operaciones: Boot 4.1.2/JDK 21.0.8, Wrapper 3.3.4/Maven 3.10.0, Flyway 12.4.0/JDBC 42.7.14. Initializr oficial, raíz correcta y AGENTS preservado. Build final:12 tests sin fallos/errores/omitidas. Regresión de configuración aislada red(2fallos)→green; no se leyó .env ni se repitió el arranque sin contraseña bloqueado al actor.
- Empleados: Nest 12.2.0/CLI 12.0.10, Node 22.22.3/pnpm 12.6.0, TypeORM 1.1.2/@nestjs/typeorm 12.0.2/pg 8.23.1, TypeScript 6.0.3/Vitest 4.1.12. Generador oficial skip-git/no-observe. Frozen/build,13 unitarias+3 HTTP y lint pasan; lockfile versionado.
- Casos técnicos y puertos puros separados de adaptadores SQL/HTTP/Actuator y composición. Sin dominio ficticio ni capas vacías de negocio. No se generaron otros servicios ni se modificaron versiones/fuentes frontend.
- Compose propio autonexus-backend-dev, imagen postgres:17.11-bookworm, bind127.0.0.1:55432 y volumen exclusivo. Dos bases/roles autonexus_operations/autonexus_employees sin privilegios elevados. Cada rol conecta a su base y recibe tres rechazos42501: base ajena, postgres ytemplate1. No se detuvieron contenedores ajenos.
- Tres .env privados con secretos aleatorios distintos, ignorados por Git; ejemplos vacíos versionados. Segunda inicialización rechazada sin modificar archivos. Nunca se imprimen passwords ni se pasan por URL/argumentos.
- Migraciones reales: schemas operations/employees e historiales public.flyway_schema_history/public.employees_migrations; una versión por servicio y segunda ejecución no-op. Sin tablas de negocio ni synchronize.

| Verificación real          | Resultado                                                                |
| -------------------------- | ------------------------------------------------------------------------ |
| Operaciones 127.0.0.1:8081 | /actuator/health/liveness y /actuator/health/readiness                   |
| Empleados 127.0.0.1:3002   | /health/live y /health/ready                                             |
| DB disponible              | Ambos live200UP/ready200UP                                               |
| DB propia detenida         | Ambos live200UP/ready503DOWN                                             |
| DB restaurada              | Ambos live200UP/ready200UP, sin reiniciar apps                           |
| Cuerpos HTTP               | Solo status; sin SQL, password, host, usuario o stacks                   |
| Frontend                   | Shell4200 navega y recarga; MF4201/4202 login demo;0 errores JS/recursos |

Mismos PID/hora de inicio Java/Node durante caída/restauración. El verificador valida ownership por nombre/proyecto/servicio/working_dir y restaura en finally. Fakes de unidades no sustituyen la integración real. Avisos no bloqueantes: metadata de feeds auxiliares Flyway401 y Mockito/Byte Buddy; sin añadir credenciales ni ocultarlos. Java global8/javac23/Node global22.14 no se modificaron.

README por servicio/infra con comandos reales para configurar, instalar, compilar, migrar, ejecutar y verificar. Evidencia local ignorada: output/backend-foundation (build/tests, migraciones, aislamiento, health-outage, frontend-browser). Revisión independiente de7bc80a7..6027fce: cumplimiento, corrección y consistencia conformes;0críticos. Se reactivaron después los procesos propios: PostgreSQL healthy, Ops8081/Empleados3002live/ready200 y frontends4200/4201/4202HTTP200. El script no compara PID automáticamente: la identidad durante caída fue comprobada por el principal. Especificación delivered con evidencia y tareas completas; cierre Git local sin merge/push automático.

## Integración local de backend-foundation en main

El 2026-10-25, por instrucción de Marcelo, main avanzó por fast-forward de7bc80a7 a3bbf499; feat/backend-foundation y su worktree se conservaron, sin push. Las tres configuraciones privadas se copiaron a la carpeta principal con creación exclusiva/comparación byte a byte, sin regenerar contraseñas. Se recompiló allí: Maven12tests PASS; Empleados frozen/build,13unitarias+3HTTP PASS. Los primeros intentos de consola excedieron60s y no se acreditan; verificaciones desacopladas terminaron con exit0.

El contenedor PostgreSQL propio fue recreado para que bind/config/ownership apunten a infra/compose de la raíz principal. Se comprobó el mismo volumen autonexus-backend-dev_postgres-data, credenciales conservadas y una migración por servicio. El verificador de raíz pasó caída/restauración200→503→200 con mismos PID/hora de inicio; el verificador del worktree anterior rechazó ownership antes de mutar. La ejecución definitiva de esta base está en la raíz; el worktree se conserva como fuente histórica, no como dueño runtime. Evidencia local: output/backend-main-integration. CU01/Keycloak siguen pendientes de la siguiente rama.

## CU01 web local — feat/cu01-keycloak

La base permanece integrada en main1963ce3. CU01 queda entregado localmente en .worktrees/cu01-keycloak, rama feat/cu01-keycloak, base main1963ce3; contratos682bfeb, implementación0a8bd2f y corrección86d81af. Revisión integral y re-revisión afectada conformes en especificación/corrección/consistencia: C1/NC1 cerrados, cero críticos pendientes. Especificación delivered con rango revisado1963ce3..86d81af, excluyendo el commit documental final. No se hizo push, reset, borrado de ramas/worktrees ni merge automático de CU01. Todos los AGENTS se preservan.

Runtime de esta entrega: código de servicios y web desde el worktree CU01; PostgreSQL de aplicación administrado desde infra/compose de la raíz principal, con mismo volumen y credenciales. Las dos configuraciones privadas CU01 coinciden byte a byte con main. IdP propio administrado desde infra/keycloak del worktree, proyecto autonexus-keycloak-dev y volumen autonexus-keycloak-dev_idp-postgres-data; no usa las bases de Operaciones/Empleados. No administrar el PostgreSQL compartido con el verificador de un worktree anterior.

Keycloak26.8.1/PostgreSQL17.11 propios; keycloak-js26.2.4 y jose6.2.13 exactos. Se mantienen Node22.22.3/pnpm12.6.0, Boot4.1.2/JDK21.0.8, Nest12.2.0 y Angular22/Delon del lockfile. Servidor y SDK tienen minor distinto legítimo, comprobado sin cambiar versiones por suposición. HTTP/start-dev loopback no acredita producción/TLS.

Shell es propietario de una sola sesión OIDC Code+PKCE S256, nonce/state y refresh en memoria. Pasa SessionPort, no JWT/refresh/ID tokens. Los Angular integrados no crean SDK, fallan cerrados si falta sesión y mantienen prefijos/CSS/ShadowRoot/chrome único. Standalone4201/4202 tiene cliente OIDC explícito y layout completo. Demo solo con entrada/configuración dedicadas, Delon en memoria y sin APIs protegidas. Passport ficticio/ACL completa quedan limitados al demo, no al modo normal OIDC.

APIs RS256/JWKS confiable, issuer/audiencia propios, exp/sub/typ obligatorios, tolerancia5s y políticas servidor; salud pública conserva SQL real. /technical/session permite roles reconocidos; /technical/admin exige administrador. Solo diagnósticos REST: funciones empresariales web siguen reservadas a GraphQL/BFF. Semilla de cinco roles/siete cuentas sintéticas no implementa CU02 ni crea empleados.

| Verificación ejecutada | Evidencia observada |
| --- | --- |
| Operaciones clean verify | PASS46 tests; Security7.1.2/Nimbus10.9.1; 12 base+20 RSA/JWKS sintéticos+14 MVC explícitamente falsos |
| Empleados frozen/build/test/test:e2e/lint/tsc | PASS40 unitarias+32 HTTP; lint0 errores/advertencias |
| Angular, ambos | Frozen/tipos/2 pruebas de política cada uno PASS; seis builds producción: integrado/OIDC/demo con EXIT0 |
| Shell frozen/test/build | PASS15 unidades; staging final y hashes main.js coinciden con los bundles Angular finales |
| Regresión G2 del template | Red reproduce ObjectUnsubscribedError tras destroy; green6/6 cada Angular con servicio real y loader sintético; parche pnpm22.1.1 sin upgrade; navegación rápida posterior sin errores Angular |
| Cargador PowerShell | Red rechaza OIDC documentado→green3/3 con fixtures temporales; permite tres claves públicas y mantiene rechazo de desconocidas, sin .env reales |
| IdP config/verify/idempotency/persistence | PASS6 tests; clientes/orígenes/PKCE/mappers reales; mismos bytes privados e IDs tras reprovisión/restart de Keycloak |
| APIs con Keycloak real | PASS10 grupos: salud/CORS,401 sin token/inválido, credenciales erróneas/deshabilitada,200/403 roles, rechazo IDtoken/firma alterada, refresh real, logout y expiración |
| PostgreSQL propietario | Roles sin privilegios; tres rechazos42501 por rol; una migración cada servicio; readiness200→503→200 y live200, mismos PID/StartTime sin reiniciar apps |
| Navegador real final | PASS12 etapas funcionales, Node exit0: Code/PKCE/retorno, navegación sin reload/login, reload SSO, refresh real, diagnósticos200/403, standalone4201/4202, logout/nuevo login, sin rol sin bucle y demo4203 sin bearer |
| Consola/recursos/almacenamiento | 0 pageErrors/errores inesperados/recursos fallidos/PKCE inválido/tokenFailures; 2 errores403 deliberados contados aparte; sin tokens en localStorage/sessionStorage/IndexedDB |

Se capturaron y verificaron desktop1440/mobile390 con identidad/diagnósticos enmascarados, una cabecera y sin overflow al capturar. La repetición final posterior al parche de ciclo de vida reutiliza explícitamente esos PNG: no cambió la presentación y no se acredita otra ronda visual. Playwright1.64.1/Chromium1248 provienen del lockfile; se instaló el ejecutable faltante sin actualizar paquetes. El verificador corrigió selectores reales de Keycloak/Delon y el formato Locator[] de máscaras; esos intentos no se contaron como PASS. El error real G2 se reprodujo y corrigió, no se clasificó como ruido.

Primera revisión independiente1963ce3..0a8bd2f: C1 detectó propietario destruido tras restauración BFCache y NC1 el README del Shell obsoleto. C1 se corrige recargando solo pageshow.persisted; NC1 diferencia fase histórica y cierre global. Regresión scripts/verify-cu01-bfcache.mjs --synthetic-events: red conserva documento/propietario muerto, green crea documento nuevo y llega al IdP sin credenciales. Es simulación explícita de eventos con recarga/navegación reales, no prueba de hit nativo BFCache: Chromium lo denegó con notRestoredReasons=masked. Tras el cambio, Shell15 unidades/build y SSO real12 etapas volvieron a PASS, con0 errores inesperados y2x403 intencionales. Re-revisión0a8bd2f..86d81af cerró ambos hallazgos; no repitió suites por rutina ni activó apps durante revisión.

Al cierre se reactivaron seis procesos propios y tres contenedores, sin recrear volúmenes ni regenerar configuraciones. final-smoke.json PASS/exit0: live/ready200 y protegidos anónimos401 en ambos servicios, issuer correcto, web4200/4201/4202/demo4203 HTTP200, assets de módulos200/inexistente404. PostgreSQL mantiene aislamiento y una migración por servicio en la comprobación repetida. Los PID iguales corresponden al ensayo de caída, no a antes/después de las pausas planificadas de revisión.

Access local60s. Logout invalida cliente/sesión IdP/refresh, pero un access token real emitido siguió200 y después recibió401 en ambos servicios tras exp+tolerancia. No se promete revocación instantánea de JWT offline. Credenciales/tokens solo en RAM de verificadores; no se publican bodies, Authorization ni URLs OAuth. Los fixtures privados y output están ignorados.

Evidencia local: output/cu01-keycloak/{backend-verification.json,operations-build.log,employees-unit.log,employees-http.log,api-real.log,health-outage.log,browser-real.log}; API/browser/health .exit=0. Builds finales con parche: g2-{red,green,build}-results.json y logs por app/modo; seis builds exit0 y tests reales del servicio en Chromium6/6 cada app. IdP: infra/keycloak/.local/*.result.json/log con PASS/exitCode0; no publicar archivos privados. Capturas sanitizadas output/playwright/cu01-{desktop,mobile}.png. Ejecución/puertos/comandos completos en scripts/cu01/README.md. ESLint global Angular adicional no se acredita: excedió el timeout; no se presenta como PASS ni se ocultaron budgets/CommonJS y warnings de módulos Node.

## Pendiente

- Identificar participantes 2 y 3 por nombre.
- Inicializar y verificar Finanzas, Inteligencia, Sincronización y aplicaciones de integración restantes cuando sus responsables/CU lo requieran. Operaciones y Empleados ya tienen base técnica terminada y revisada; ningún CU de negocio se considera implementado.
- Completar BFF GraphQL y funciones empresariales mediante contratos por CU. CU01 web se entrega en su rama; los gráficos siguen siendo ejemplos, no CRUD ni integración empresarial.
- Crear contratos, infraestructura ejecutable y configuración.
- Implementar y probar CU15, IA, offline, sincronización, MCP y demás funciones.

## Siguiente entregable

Acordar matriz de permisos empresariales para CU02 y contrato BFF del participante2: audiencia propia, forwarding/exchange autorizado, validación issuer/firma/exp y rol/acción/registro por campo/CU. El SessionPort y los cinco roles técnicos están versionados, no sustituyen esas políticas. Flutter/offline de CU01 y CU15 permanecen pendientes.

## Evidencia

No se ha integrado ni probado una plataforma AutoNexus completa ni todos sus CU. La base backend está en main; esta rama incorpora CU01 web local real y distingue explícitamente sus pruebas de las demos históricas. No se acredita Flutter, offline autorizado, CU02, CRUD, BFF, Saga ni producción. El callback ficticio y ACL completa solo pueden ejecutarse en la entrada demo dedicada; compilar/probar ese modo no lo convierte en autenticación válida.

## Próxima actualización

Registrar fecha, rama/commit, cambios implementados, verificaciones reales, bloqueos y siguiente paso. No reemplazar pendientes por porcentajes estimados sin evidencia.
