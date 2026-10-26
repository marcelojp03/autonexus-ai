# Estado comprobado

Fecha: 2026-10-25.

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

## Pendiente

- Identificar participantes 2 y 3 por nombre.
- Inicializar y verificar Finanzas, Inteligencia, Sincronización y aplicaciones de integración restantes cuando sus responsables/CU lo requieran. Operaciones y Empleados ya tienen base técnica terminada y revisada; ningún CU de negocio se considera implementado.
- Integrar Keycloak/SSO y BFF GraphQL mediante contratos acordados. La composición Shell/single-spa de MF01/MF02 ya está comprobada, pero sus vistas continúan siendo demos sin funcionalidad de negocio.
- Crear contratos, infraestructura ejecutable y configuración.
- Implementar y probar CU15, IA, offline, sincronización, MCP y demás funciones.

## Siguiente entregable

Acordar el contrato de sesión Keycloak/roles y GraphQL para la siguiente entrega; sustituir demos por CU gradualmente sin cambiar la base de composición comprobada. Mantener en paralelo los contratos CU15 y la base de servicios/modelo web-Android.

## Evidencia

Se instalaron, compilaron y arrancaron los dos Angular en standalone y se integraron realmente en el Shell single-spa, con pruebas de montaje, navegación, recarga, assets y responsive. No se ha integrado ni probado una plataforma AutoNexus completa. Hay dos bases técnicas backend verificadas, no funcionalidades ni CU de negocio acreditados; CU01 no está implementado por haber probado el login simulado. No se probaron funcionalmente todos los CU ni se hizo despliegue productivo; las pruebas unitarias/HTTP y la integración real de la base backend se detallan arriba. El callback social ficticio y aclService.setFull(true) siguen en el template, incluso en producción: no desplegar como autenticación real.

## Próxima actualización

Registrar fecha, rama/commit, cambios implementados, verificaciones reales, bloqueos y siguiente paso. No reemplazar pendientes por porcentajes estimados sin evidencia.
