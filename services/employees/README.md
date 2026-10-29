# MS02 Empleados

## Lectura del estado CU15

La sección CU15 al final separa implementación inicial delegada de verificación principal posterior. La migración 1793455200000 ya fue aplicada por el principal; el recorrido real posterior incluye los tres propietarios. Los apartados de CU03, base y CU01 conservan su contexto histórico de ejecución y no implican que CU15 carezca hoy de BFF/UI o de APIs ejecutadas. La matriz real6 está acreditada; regresión, revisión y cierre continúan pendientes; evidencia final en [STATUS](../../docs/context/STATUS.md) y la [especificación CU15](../../docs/compose/spec/cu15-confirmation-saga.md).

## CU03 — backend integrado localmente en main

Consulta paginada/detalle/historial, alta, PUT completo y desactivación sin borrado; datos personales/laborales, cargo y especialidades. Documento/email únicos incluso inactivos, validaciones y control de versión. Todas las acciones requieren administrador en servidor usando JWT CU01. Cargo/especialidad no asignan roles. El BFF y las pantallas web de CU03 se entregaron después en `work/marcelo` (ver `docs/compose/spec/cu03-web.md`); esta sección describe el backend y no acredita CU02.

Contratos desde raíz: contracts/rest/employees.openapi.yaml, contracts/graphql/employees.graphql (propuesta), contracts/auth/employees.md. Especificación: docs/compose/spec/cu03-employees.md; decisiones006/007. Publicados tempranamente en12f44e6 y alineados durante pruebas, sin push. Los apartados posteriores de base/CU01 son evidencia histórica.

### Persistencia y recuperación

Migración1793023200000 agrega tablas en schema employees: employee_records, employee_history, employee_operations e identity_intents. Agregado JSONB en PostgreSQL con constraints/índices únicos, sin ORM compartido ni bases ajenas. Dos migraciones propietarias tras CU03; repetir run es no-op. Sin synchronize ni migraciones automáticas al arrancar. No ejecutar down destructivo para borrar historia.

Empleado+historial+intención+resultado idempotente tienen una transacción SQL local. Keycloak se procesa después del commit, fuera de la transacción. Respuesta de mutación conserva snapshot guardado (puede pending); GET detalle muestra resultado actual. Replay idéntico no repite efectos; mismo operationId con otra acción/actor/contenido da409. expectedVersion evita sobrescrituras. Retry no cambia versión empresarial y reconcilia el estado vigente (incluso desde la última confirmación synced) tras reinicio o escritura incierta; no hay worker automático.

Sin access.requested no se contacta IdP. Cliente técnico confidencial autonexus-employees-admin con client_credentials y manage-users explícito; no cuenta personal ni bootstrap habitual. Credenciales solo en archivo backend privado indicado por EMPLOYEES_IDP_CLIENT_FILE. Ausente/inválido permite guardar datos, pero acceso queda failed/pending con código seguro, nunca synced ficticio. Provisión de infraestructura separada conserva secretos CU01. manage-users es realm-wide en IdP: las restricciones employeeId/username/subject son del adaptador y no equivalen a permisos finos por registro en Keycloak.

Username determinista employee-UUID, employeeId admin-only y subject estable. Error/timeout no revierte empleado ni confirma rechazo remoto. Reintento recupera creación con respuesta perdida y fallo de confirmación SQL; cuenta ajena produce conflict sin modificarla. Lock de sesión por empleado serializa mutación/sync sin transacción abierta durante red. Contención503 antes del guardado admite retry mismo operationId. Desactivar conserva historia y solicita deshabilitar cuenta. Cuenta creada sin roles empresariales ni credencial habilitada todavía NO tiene acceso operativo al taller; synced no implementa CU02 ni login listo. JWT previo puede seguir válido hasta exp+5s.

### Ejecutar CU03 integrado desde la raíz

Ubicación definitiva: services/employees de la raíz principal en main; puerto127.0.0.1:3002. No3003 permanente y no otra instancia del worktree. .env y cliente técnico privado existentes se reutilizan; ambos Compose continúan bajo infra/compose e infra/keycloak de raíz. No init-env/bootstrap/provision al integrar. En máquina nueva preparar privados según infraestructura, nunca copiarlos al BFF/repositorio.

~~~powershell
# Desde la raíz principal; versiones verificadas en esta máquina:
$node='C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$pnpm='C:/Users/marcelo/AppData/Local/node/corepack/v1/pnpm/12.6.0/bin/pnpm.mjs'
$env:Path='C:/Users/marcelo/AppData/Local/nvm/v22.22.3;'+$env:Path
Push-Location services/employees
& $node $pnpm build
& $node $pnpm migration:run
Pop-Location
& ./services/employees/scripts/start-main.ps1 -Restart
# Sin -Restart conserva un único proceso raíz ya existente.
~~~

start-main.ps1 valida raíz/main, artefacto, privados ignorados y dueños de procesos antes de detener ninguno. Rechaza dueños ambiguos3002/3003 y copias de worktree. -Restart sustituye únicamente las instancias Empleados reconocidas del mismo repo y fija3002; no toca Compose/otros servicios. Inyecta ruta EMPLOYEES_IDP_CLIENT_FILE y entorno propio sin imprimir credenciales ni cambiar archivos; restaura el entorno del llamador. No ejecutar pnpm start:prod/start:dev en paralelo por accidente. El arranque general CU01 delega Empleados al helper dedicado.

Traspaso con operaciones/errores/semántica BFF, publicación pendiente y CU04: docs/handoffs/2026-10-26-cu03-main-cu04.md desde raíz. Smoke afectado: node services/employees/scripts/verify-main-integration.mjs desde raíz o el script vía su carpeta; apunta al3002 vivo, NO crea Nest efímero. scripts/cu03/verify-cu01-main.ps1 reutiliza capturas previas sin acreditar revisión visual nueva. Logs de integración en output/cu03-main-integration.

### Verificación reproducible

Evidencia observada al preparar revisión: build PASS,70unitarias y42HTTP PASS, tipos/lint exit0 con0advertencias. Matriz final real de PostgreSQL/Keycloak PASS15grupos, incluidos email inválido, duplicado concurrente, no reactivación por edición y pérdida de sesión SQL con respuesta tardía/reparación. OpenAPI/sintaxis SDL PASS; CU01 desde raíz repitió13etapas y aislamientoSQL1/2migraciones. Estado de revisión/cierre: STATUS y especificación, no inferirlo del número de tests.

~~~powershell
# Desde este servicio, sin conexiones SQL/IdP para las unidades/HTTP con dobles:
pwsh -NoProfile -File scripts/verify-local.ps1
# Con IdP/SQL propios activos; migración y API reales, puerto efímero:
& $node scripts/verify-cu03-real.mjs --skip-recovery
# Matriz completa: incluye parada/restauración controlada SOLO del Keycloak propio,
# pérdida de respuesta tras HTTP real y trigger temporal de fallo SQL con finally:
& $node scripts/verify-cu03-real.mjs
~~~

Logs/códigos ignorados: output/cu03-employees de la raíz del worktree. El launcher en background no acredita éxito; esperar código de salida y resumen final. Los registros sintéticos example.invalid se conservan/desactivan para probar historia, sin borrar empleados, bases ni cuentas ajenas. Triggers/funciones temporales de fallo se retiran en finally. La pérdida de respuesta y confirmación SQL son fallos inyectados sobre adaptadores/SQL reales; no se presentan como una caída espontánea del IdP. La prueba de caída sí detiene/restaura el contenedor real con ownership comprobado.

## Runtime vigente de CU01 integrado

Ejecutar esta aplicación desde su carpeta en la raíz principal autonexus-ai. CU01 ya está en main b8d8079; las referencias a .worktrees/cu01-keycloak en la evidencia posterior son históricas. Ambos Compose se administran desde infra/compose e infra/keycloak de raíz, conservando privados y volúmenes. Ubicaciones, comandos y límites: docs/decisions/006-cu01-main-runtime.md y scripts/cu01/README.md (rutas desde la raíz). No se hizo push ni se eliminaron ramas/worktrees.

Tecnología: NestJS. Persistencia: PostgreSQL propia. Responsabilidad: Bloque 1.
Alcance funcional previsto: empleados, especialidades, jornadas, disponibilidad, reservas de horario y asignaciones.

## Estado y límites

Base técnica T2 del diseño docs/compose/spec/backend-foundation.md, aprobada por Marcelo (S2), generada y comprobada en feat/backend-foundation, base7bc80a7, el2026-10-25 e integrada en main. feat/cu01-keycloak incorpora ahora validación JWT y autorización técnica para CU01 web. No implementa CRUD, GraphQL, CU02 ni participación en Saga. Los resultados históricos de la base se conservan; la sección CU01 y ../../docs/context/STATUS.md distinguen las comprobaciones nuevas de la entrega web local.

Hay instalación reproducible, compilación, pruebas unitarias y HTTP con probe falso explícito. La migración, historial, aislamiento y caída/recuperación con PostgreSQL real ya fueron comprobados por la verificación principal; se describen al final. Las `.env` privadas las genera infraestructura, no se versionan ni se imprimen. AGENTS y alcance funcional preservados; sin Git separado ni commits.

## CU01: protección OIDC en este worktree

Implementación de S2/S4/S5 de `docs/compose/spec/cu01-keycloak.md` y contratos `contracts/auth` / `contracts/rest/technical-auth.openapi.yaml`. Solo Empleados: no acredita todavía Keycloak real ni CU01 completo. Sin CU02, CRUD, BFF, GraphQL ni permisos empresariales por registro; las funciones web de negocio siguen reservadas al futuro BFF GraphQL.

### Configuración pública local y confianza

| Variable | Default explícito / valores admitidos |
| --- | --- |
| OIDC_ISSUER_URI | `http://127.0.0.1:8180/realms/autonexus`, exacto, sin slash final |
| OIDC_AUDIENCE | `autonexus-employees-api`, audiencia propia exacta |
| WEB_ALLOWED_ORIGINS | `http://127.0.0.1:4200,http://127.0.0.1:4201,http://127.0.0.1:4202`; admite subconjunto separado por comas |

Los defaults son política **exclusiva de desarrollo local**; no existe modo servidor demo ni bypass. Valores ajenos al contrato fallan al componer la aplicación, sin imprimirlos. `.env.example` solo contiene valores públicos y DB_PASSWORD vacío. La `.env` privada permanece intacta: estos defaults evitan editarla. Otro entorno requiere acordar explícitamente issuer HTTPS, audiencia y allowlist; no se acredita producción pública.

`jose` **6.2.13 exacto** se confirmó en npm con `view jose@6.2.13 version` y añadió con `add --save-exact jose@6.2.13`, usando los ejecutables fijados abajo. Nest12.2.0, ESM, TypeScript6, Vitest4 y Oxlint de la base se conservan.

`jwtVerify` oficial exige RS256, firma válida, `sub` no vacío, `iss` exacto, `aud` propio y `exp` obligatorio. Valida expiración y `nbf` cuando existe con tolerancia **5s**. Además exige claim de payload `typ: Bearer` de access tokens Keycloak; un ID token no se acepta aunque llevara audiencia API.

`createRemoteJWKSet` oficial obtiene claves solo de `<issuer configurado>/protocol/openid-connect/certs`, nunca de `jku` ni del `iss` del JWT. Inicialización diferida: arranque/salud no contactan IdP. Timeout HTTP2000ms, caché600000ms, cooldown30000ms para búsqueda por kid desconocido tras un fetch exitoso. JOSE gestiona selección/rotación y firma. Clave desconocida, JWKS inválido o timeout fallan cerrados con401; claves válidas cacheadas pueden verificar tokens vigentes sin contactar al IdP.

### Recursos y política global

Guard global JWT/política registrado en AppModule: sin token válido→401; token válido sin política explícita o sin rol suficiente→403. Un futuro endpoint no hereda acceso por ser Administrador. Solo los dos handlers de salud son públicos.

- `GET /health/live` y `GET /health/ready`: públicos; SELECT1, pool, timeouts y semántica PostgreSQL originales preservados.
- `GET /technical/session`: al menos un rol realm reconocido; DTO exacto `{resource:'session',service:'employees',subject:string,roles:string[]}`.
- `GET /technical/admin`: solo `administrador`; DTO exacto `{resource:'admin',service:'employees',authorized:true}`.

Roles: `administrador`, `recepcionista`, `mecanico`, `jefe_taller`, `responsable_financiero`. Se extraen únicamente de `realm_access.roles`, filtrando desconocidos y duplicados; no se infieren de roles de cliente ni se concede herencia empresarial. El bootstrap IdP no implementa CU02.

Solo un header `Authorization: Bearer <JWT>` con tres segmentos base64url autentica; no duplicados, cookies ni querystring. Errores de firma/algoritmo/claims/JWKS devuelven401 con solo statusCode401 y message `Unauthorized`; falta de permiso devuelve403 con solo statusCode403 y message `Forbidden`. Sin token, claims completos, stack ni detalles internos en respuestas/logs.

CORS: orígenes exactos4200/4201/4202, métodos GET/OPTIONS, header Authorization y credentials=false. Sin wildcard ni reflection arbitraria; localhost no es alias autorizado. Express deshabilita `x-powered-by`. CORS no reemplaza autenticación/autorización.

### Logout stateless

No hay sesión/cookie ni endpoint logout de API. Logout OIDC pertenece a web/IdP: termina renovación y estado cliente, pero no revoca instantáneamente un access token ya emitido. Puede aceptarse hasta **exp +5s**; retirar roles o deshabilitar usuario tiene igual ventana para JWT ya emitidos. Sin blacklist ni introspección por petición. El principal debe comprobar logout/refresh/expiración real con tokens solo en RAM.

### Comandos y evidencia local CU01

```powershell
Set-Location 'C:/UAGRM/Ingenieria de Software 2/segundo parcial/autonexus-ai/.worktrees/cu01-keycloak/services/employees'
$env:PATH = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + $env:PATH
$node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$pnpm = 'C:/Users/marcelo/AppData/Local/node/corepack/v1/pnpm/12.6.0/bin/pnpm.mjs'
& $node --version
& $node $pnpm --version
& $node $pnpm install --frozen-lockfile
& $node $pnpm build
& $node $pnpm test
& $node $pnpm test:e2e
& $node $pnpm exec tsc --noEmit
& $node $pnpm lint
```

| Comprobación | Resultado | Log ignorado en esta carpeta |
| --- | --- | --- |
| Node /pnpm /jose npm | 22.22.3 /12.6.0 /6.2.13 confirmados | Salida de herramientas |
| Tests-first (red esperado) | 13 tests base PASS, dos suites sin implementación fallan | cu01-red.log |
| Instalación exacta /frozen | PASS | cu01-install.log /cu01-frozen.log |
| Build | PASS, código0 | cu01-build.log |
| Unitarias | PASS,40 tests/6 archivos, incluidas13 base | cu01-unit.log |
| HTTP, puertos efímeros | PASS,32 tests/2 archivos, incluidas3 base | cu01-http.log |
| Typecheck | PASS, código0 | cu01-types.log |
| Lint | PASS,0 warnings/0 errores | cu01-lint.log |

Tests con RSA/tokens generados solo en RAM: firma alternativa/alterada, issuer/audience, claims ausentes, exp/nbf, IDtokens, HS256/none/malformed, tolerancia, roles realm vs cliente, 401/403 genéricos, DTO exacto, default deny, headers duplicados, cookies/query ignorados, CORS y salud sin consultar claves. JWKS sintético loopback/puerto0 verifica ruta confiable ignorando jku, caché/cooldown y timeout real2s; listeners cerrados. **Son unidades/HTTP con DB falsa, no evidencia de Keycloak26.8.1, SSO ni PostgreSQL real.** Un tipo amplio de mock falló inicialmente en typecheck y quedó corregido antes del PASS final.

Pendiente del principal: cambiar runtime propietario, probar IdP/tokens/roles reales, expiración tras logout y regresión PostgreSQL conservando rol/password/volumen55432. No se leyó/imprimió/editó `.env`, no se ejecutó Docker ni se tocó el proceso activo3002, ni quedó otra aplicación. La evidencia histórica siguiente corresponde a la base, no a integración CU01.

## Generación y versiones reales (base original)

Generador oficial ejecutado en `%TEMP%/autonexus-employees-foundation`, con destino relativo; después se trasladaron los archivos necesarios mediante `apply_patch`, sin reemplazar AGENTS ni adoptar el README del template. `new --help` confirmó el flag real `--no-observe`; no se configuró Observe ni telemetría.

```powershell
# PATH y ejecutables de la sección siguiente; ejecutar en un temporal propio
& $node $pnpm dlx @nestjs/cli@12.0.10 new --help
& $node $pnpm dlx @nestjs/cli@12.0.10 new employees --directory scaffold --skip-git --skip-install --package-manager pnpm --strict --no-observe
```

| Componente                                      | Versión comprobada               |
| ----------------------------------------------- | -------------------------------- |
| Node / pnpm                                     | 22.22.3 / 12.6.0, exactos        |
| @nestjs/cli / schematics                        | 12.0.10 / 12.0.10                |
| @nestjs/common, core, platform-express, testing | 12.2.0, exactos                  |
| TypeORM / @nestjs/typeorm / pg                  | 1.1.2 / 12.0.2 / 8.23.1, exactos |
| TypeScript                                      | 6.0.3                            |
| Vitest / @vitest/coverage-v8                    | 4.1.12 / 4.1.12                  |
| Vite / Supertest                                | 8.3.5 / 7.3.1                    |
| @types/node / @types/express / @types/supertest | 24.19.2 / 5.0.6 / 7.2.1          |
| Oxlint / oxlint-tsgolint / Prettier             | 1.89.0 / 7.0.2005 / 3.9.10       |
| reflect-metadata / RxJS / source-map-support    | 0.2.2 / 7.8.2 / 0.5.21           |

Se conservaron los rangos TypeScript/Vitest y herramientas compatibles del generador: el template real es ESM, TypeScript 6, Vitest 4 y Oxlint, no Jest. Framework, ORM, Node, gestor y CLI se fijaron; `pnpm-lock.yaml` fija la resolución completa. Se omitió la capacidad de deploy de Nest MAU por estar fuera de alcance. No se aprobaron scripts de dependencias globalmente ni se modificaron herramientas globales.

## Entorno y comandos (PowerShell)

Ejecutar desde **la raíz de este servicio**, no desde la raíz del monorepo. Node global 22.14 y pnpm global 11 no se usan.

```powershell
Set-Location 'C:/UAGRM/Ingenieria de Software 2/segundo parcial/autonexus-ai/services/employees'
$env:PATH = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + $env:PATH
$node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$pnpm = 'C:/Users/marcelo/AppData/Local/node/corepack/v1/pnpm/12.6.0/bin/pnpm.mjs'
& $node --version
& $node $pnpm --version
& $node $pnpm install --frozen-lockfile
& $node $pnpm build
& $node $pnpm test
& $node $pnpm test:e2e
& $node $pnpm lint
& $node $pnpm exec tsc --noEmit
```

Primera resolución: `install --no-frozen-lockfile` (tras generar con skip-install). Para reproducir, usar frozen, sin regenerar el lockfile. `.nvmrc`, engines y packageManager documentan las versiones exactas.

### Configuración privada

El responsable de integración prepara una `.env` local privada con la estructura de `.env.example`, sin sobrescribir secretos existentes ni imprimirlos. El script de infraestructura genera las contraseñas locales; este servicio recibe solo la suya. `.env`, variantes privadas, dependencias, logs y builds están ignorados; ejemplo y lockfile se versionan. No incluir conexiones con password en comandos, logs o documentación.

| Variable    | Valor por defecto / requisito                  |
| ----------- | ---------------------------------------------- |
| PORT        | 3002; entero 1–65535                           |
| HTTP bind   | 127.0.0.1 fijo, no expone el servicio a la red |
| DB_HOST     | 127.0.0.1                                      |
| DB_PORT     | 55432; entero 1–65535                          |
| DB_NAME     | autonexus_employees                            |
| DB_USER     | autonexus_employees                            |
| DB_PASSWORD | Obligatoria, sin valor de ejemplo              |

App y DataSource CLI cargan `.env` mediante `process.loadEnvFile` de Node 22 si existe en el directorio actual. Las variables ya inyectadas en el proceso prevalecen. Se valida password faltante y puertos sin mostrar valores. No hace falta dotenv ni @nestjs/config. Cada servicio recibe solo sus credenciales y solo accede a su base.

### Migrar y ejecutar con PostgreSQL real

Con PostgreSQL propio preparado por el responsable de infraestructura y configuración privada válida:

```powershell
& $node $pnpm build
& $node $pnpm exec typeorm migration:run -d dist/infrastructure/postgres/data-source.js
# Alias equivalente, no ejecutarlo una segunda vez salvo comprobación de idempotencia:
# & $node $pnpm migration:run
& $node $pnpm start:prod
# Alternativa de desarrollo: & $node $pnpm start:dev
```

CLI real del paquete TypeORM 1.1.2 comprobado con `exec typeorm migration:run --help`; carga JavaScript ESM compilado, sin ts-node/loader añadido. `data-source-options.ts` se reutiliza en runtime y CLI. `synchronize=false`, `migrationsRun=false`, sin entidades ni instalación automática de extensiones.

La migración `1792886400000-create-employees-schema.ts` crea únicamente el schema `employees` (sin tablas de negocio). TypeORM guarda historial en `public.employees_migrations`: usar public permite crear historial antes de la migración que crea employees. El rol necesita permisos de dueño de **su propia base**. Repetir el comando debe informar cero migraciones pendientes, comprobación ya realizada por la verificación principal. `down` no usa CASCADE para no eliminar objetos de futuras entregas. El CLI oficial imprime SQL/errores de migración; no publicar logs privados ni pasar secretos por URL.

### Salud y ciclo de vida

- `GET /health/live`: HTTP200, exactamente `{"status":"UP"}`; no consulta PostgreSQL.
- `GET /health/ready`: ejecuta inicialización si es necesaria y **SELECT 1** real contra la base propia. HTTP200 `{"status":"UP"}` o HTTP503 `{"status":"DOWN"}`. Sin SQL, errores, stack, host, usuario ni password en la respuesta.
- La aplicación puede iniciar aunque PostgreSQL esté caído, siempre que la configuración sea válida. La inicialización fallida se reintenta en el siguiente check; una conexión disponible no se toma como prueba suficiente sin consulta.
- Conexión/adquisición del pool y consulta tienen límites de 1000 ms; también statement_timeout de 1000 ms. Una adquisición más consulta puede consumir aproximadamente 2 s. Pool máximo 5, conexiones ociosas recicladas tras 1000 ms.
- El handler de errores del pool evita errores no manejados y no registra detalles de conexión. El driver pg descarta/recrea conexiones rotas; no se usa un resultado cacheado de disponibilidad. La recuperación real sin reinicio fue comprobada por la verificación principal.
- Hooks de shutdown habilitados; se espera inicialización pendiente y se destruye el DataSource al cerrar la app. Terminar con Ctrl+C en primer plano; no dejar procesos propios activos tras la verificación.

## Arquitectura proporcional

`src/application/CheckReadiness` y `ReadinessProbe` son puros: sin Nest, TypeORM ni HTTP. `infrastructure/http` adapta estado a HTTP; `infrastructure/postgres` implementa el puerto con DataSource; configuración y AppModule componen dependencias. Se usa proveedor explícito en lugar de `TypeOrmModule.forRoot` para evitar conexión obligatoria/reintentos bloqueantes al arrancar. El paquete @nestjs/typeorm queda fijado y compatible para la futura persistencia de CU, sin introducir entidades ahora.

No se crean directorios vacíos de dominio ni entidades ficticias. El primer CU incorporará sus agregados/reglas independientes del framework; sus modelos ORM y migraciones permanecerán dentro de Empleados, sin compartirlos ni importar dominios de otros servicios. La salud es una capacidad técnica, no un CU del taller.

## Evidencia de la base original

Todos los comandos de verificación se ejecutaron desde este servicio con los ejecutables indicados.

| Comprobación                                           | Resultado observado                                           |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| Generador oficial (skip-git, skip-install, no-observe) | Aplicación creada; sin Git ni instalación en temporal         |
| Primera instalación no-frozen                          | Resolvió 311 paquetes, completó en 37.5 s; log local ignorado |
| install --frozen-lockfile                              | PASS, código 0; sin nueva resolución                          |
| build                                                  | PASS, código 0                                                |
| test                                                   | PASS, código 0; 13 pruebas / 3 archivos                       |
| test:e2e                                               | PASS, código 0; 3 pruebas HTTP / 1 archivo                    |
| lint                                                   | PASS, código 0; 0 errores y 0 advertencias                    |
| exec tsc --noEmit                                      | PASS, código 0                                                |
| exec typeorm migration:run --help                      | PASS, código 0; flag -d/--dataSource real                     |

Pruebas: caso de disponibilidad UP/DOWN y recuperación; puertos/configuración inválida; inicialización concurrente compartida, retry, consulta en cada check y cierre; HTTP200 live independiente del probe, ready200/503 con cuerpo sanitizado y recuperación en la misma aplicación. **Los probes/DataSources de tests son falsos explícitos**. No prueban PostgreSQL, migraciones, aislamiento, caída real, permisos, frontend ni plataforma integrada. La evidencia de PostgreSQL real se complementa con la sección siguiente, no con esos fakes.

## Verificación integrada final de la base original (anterior a CU01)

La verificación principal repitió frozen/build,13pruebas unitarias+3 HTTP y lint: código0, sin warnings de lint. Luego ejecutó `exec typeorm migration:run -d dist/infrastructure/postgres/data-source.js` contra PostgreSQL 17.11 propio con el rol de Empleados:1migración aplicada; segunda ejecución sin pendientes; historial public.employees_migrations con1 versión y schema employees presente.

El proceso Node 22.22.3 real sirve127.0.0.1:3002. Liveness/readiness200UP; PostgreSQL detenido→live200/ready503DOWN; PostgreSQL restaurado→live200/ready200UP, mismo PID/hora de inicio, sin reiniciar Node. Los cuerpos contienen exclusivamente status. El rol conecta a su base y recibe42501 para Operaciones, postgres ytemplate1, sin privilegios elevados.

Scripts y comandos en [infra/compose](../../infra/compose/README.md). Logs ignorados en `../../output/backend-foundation/`, incluidos build/tests, migraciones, aislamiento y health-outage. Revisión independiente concluida sin críticos; después se reactivó el servicio con live/ready200; ningún CU de negocio, Keycloak, CRUD o Saga se acredita por esta base técnica.

## Ubicación definitiva de la base integrada

Backend-foundation fue integrado por fast-forward a main3bbf499 por instrucción de Marcelo. Esta carpeta principal es ahora la ubicación runtime; las configuraciones privadas se copiaron sin cambiar sus bytes/credenciales, y el volumen e historial se conservaron. Recompilación y comprobación real desde la raíz PASS; ver output/backend-main-integration y STATUS. El worktree anterior sigue existiendo, pero no administra el contenedor actual; su verificador rechaza ownership desactualizado. No se hizo push.

## Cierre integrado CU01 web

En feat/cu01-keycloak el código/binario se ejecuta desde .worktrees/cu01-keycloak; el párrafo anterior describe la base histórica de main. PostgreSQL conserva su propietario en infra/compose de la raíz y las configuraciones privadas copiadas mantienen sus bytes. Frozen/build40 unitarias+32 HTTP/lint/tipos PASS; API con tokens reales de Keycloak y salud SQL/outage PASS. La revisión integral y la re-revisión cerraron los hallazgos sin críticos pendientes; el runtime se reactivó con live/ready200 y protegido anónimo401. No es CRUD, CU02 ni BFF. Comandos conjuntos, evidencia y límites en ../../scripts/cu01/README.md y ../../docs/context/STATUS.md. No se integró CU01 en main ni se hizo push automático.

Amendment de revisión: email dot-atom ASCII/DNS-punycode (local64, etiquetas1–63 sin guiones extremos, total254). Una edición laboral no reactiva una identidad deshabilitada: failed/IDP_ACCOUNT_DISABLED requiere acción autorizada separada en IdP. El mismo operationId sigue siendo replay; un retry nuevo reconcilia también desde synced (última confirmación), sin otra versión laboral. La prueba de pérdida de sesión termina solo la conexión SQL que posee el lock del empleado sintético; no detiene PostgreSQL ni toca conexiones ajenas.

Si se interrumpe el verificador: node scripts/verify-cu03-real.mjs --cleanup-only inspecciona únicamente registros activos CU03 con documento C03-UUID/email UUID@example.invalid y snapshot inicial Synthetic/CU03, y los desactiva mediante API autorizada; no borra. La espera de restauración IdP está acotada a300s y exige Dockerhealthy+discovery. El primer intento con presupuesto anterior agotó espera (arranque observado118s), no se presenta como PASS; el log histórico agotado no quedó conservado y no se acredita como PASS; real.log/real.exit acreditan la ronda posterior.

Cierre de límite ASCII: se comprueba el alfabeto antes de toLowerCase. U+212A en local/dominio es rechazado sin convertir silenciosamente la dirección; mayúsculas ASCII y punycode continúan válidos. Evidencia: red2→dominio27/27; ronda70unitarias/42HTTP y funcional real9grupos PASS después del ajuste.


## CU15 — participante Empleados (2026-10-28)

Código local implementado; las pruebas sintéticas iniciales se distinguen del recorrido principal posterior con PostgreSQL, Keycloak y RabbitMQ reales. Las políticas aceptadas se registran en la [decisión 016](../../docs/decisions/016-cu15-confirmation-saga.md). La matriz real6 está acreditada; no implica cierre global de CU15.

- CU03 añade mechanicEnabled laboral, independiente del cargo, rol e identidad Keycloak. Crear/legacy: false; edición omitida: conserva; habilitar: requiere especialidades. No se sincroniza la identidad por cambiar solamente esa habilitación.
- Migración nueva 1793455200000 registrada, synchronize=false y migrationsRun=false. Extiende employee_assignments conservando legacy; añade tombstones, ledger, auditoría, Outbox, Inbox y notificaciones. Amplía permisos a 23 con confirmations:read/write para administrador/jefe_taller mediante UNION; no restaura permisos que se hubieran retirado ni elimina personalizaciones previas.
- Reserva/confirmación/liberación serializan por Saga/operación/orden y empleado. La clave employee:<id> es común con CU03 y todos los escritores CU04. Se revalidan activo, habilitación, especialidad, versión laboral al reservar, intervalo futuro al reservar, jornada/descansos/ausencias y ocupaciones semiabiertas reserved/confirmed. Confirmar usa versión de reserva, no la versión de contacto posterior del empleado. No hay TTL de negocio.
- Cambio, resultado aplicado/rechazado, auditoría y Outbox comparten transacción. El replay conserva el snapshot original; GET de recurso muestra el estado actual. released/tombstone son terminales. OPERATION_NOT_FOUND/404 significa desconocido, nunca rechazo de negocio.
- CU04 ahora incluye transacción para mutación, auditoría e idempotencia. No admite invalidar una reserva ni un confirmed de participante sin cierre global, aunque se reconozca el conflicto. Tras observar order.confirmed vuelve a aplicar el reconocimiento CU04. CU03 no permite desactivar/deshabilitar/retirar la especialidad requerida a una asignación CU15 aún no terminada.

### API y autorización

| Método/ruta | Política |
| --- | --- |
| POST /internal/cu15/assignments/:sagaId/reserve | cu15.staffing.reserve |
| POST /internal/cu15/assignments/:sagaId/confirm | cu15.staffing.confirm |
| POST /internal/cu15/assignments/:sagaId/release | cu15.staffing.release |
| GET /internal/cu15/assignments/:sagaId | cu15.staffing.read |
| GET /internal/cu15/operations/:operationId | cu15.staffing.read |
| GET /staffing/mechanics?search=&limit=&offset= | confirmations:read humano |
| GET /staffing/mechanics/:id/availability?date= | confirmations:read humano |

El guard verifica firma/issuer/aud/exp/sub con el verificador existente y exige azp=autonexus-cu15-coordinator + scope exacto antes de consultar autorización humana. JWT humano no accede al participante; cliente/scopes CU15 no acceden a CRUD, proyección humana o sesión CU01. El DTO humano /technical/session se conserva.

Formas cerradas y nombres reserve_assignment/confirm_assignment/release_assignment, recurso, envelope y SHA-256 de JSON recursivamente ordenado {clientId,command,sagaId,body}: contracts/rest/saga.md, sección Formas concretas v1. Fechas UTC con milisegundos, UUID normalizado; ningún token en huella/ledger/Outbox. applied devuelve 200; rejected durable devuelve 409. Validación, autenticación, IDEMPOTENCY_CONFLICT y fallos transitorios usan error estándar, sin envelope rechazado ficticio.

Códigos de negocio: EMPLOYEE_NOT_FOUND, EMPLOYEE_VERSION_CONFLICT, EMPLOYEE_INACTIVE, MECHANIC_NOT_ENABLED, SPECIALTY_REQUIRED, SPECIALTY_MISMATCH, ASSIGNMENT_START_NOT_FUTURE, CROSSES_MIDNIGHT, OUTSIDE_WORKING_HOURS, EMPLOYEE_ABSENT, ASSIGNMENT_OVERLAP, ORDER_ASSIGNMENT_IN_PROGRESS, VERSION_CONFLICT, ASSIGNMENT_RELEASED, ASSIGNMENT_ALREADY_EXISTS, ASSIGNMENT_NOT_FOUND, ASSIGNMENT_NOT_RESERVED y ASSIGNMENT_ENDED. Protección de escritores: AFFECTS_PENDING_ASSIGNMENT (CU03) y AFFECTS_PENDING_CONFIRMATION (CU04).

La proyección paginada devuelve todos los candidatos con motivos de inelegibilidad sin documento/contactos. Disponibilidad conserva assignments globalmente confirmadas/legacy y separa reservations provisionales con status, version y orderConfirmedObserved; confirmar un paso de Empleados no se presenta como éxito global.

### Mensajería

CU15_MESSAGING_ENABLED=false por defecto. Para habilitar: CU15_MESSAGING_ENABLED=true y CU15_BROKER_CLIENT_FILE apuntando a JSON privado con host, port numérico, vhost=autonexus, username y password. No se incluye ni se imprime un archivo real. Biblioteca amqplib=0.10.9 (engines Node>=10) y @types/amqplib=0.10.8 fijadas; instalación comprobada con Node22.22.3/pnpm12.6.0. Context7 contrastado y firmas comprobadas contra los tipos instalados; sin actualización de Nest/TypeORM.

Infraestructura debe precrear exchange topic durable autonexus.business.v1, cola cu15.employees.order-confirmed.v1 enlazada a operations.order.confirmed.v1 y DLX autonexus.dlx.v1/cola cu15.employees.dlq.v1. Este cliente no declara ni modifica topología: no necesita permisos configure. Usa publisher confirms + mandatory/return, eventId estable, lease y fencing SQL; solo marca published_at tras ACK sin devolución. El fallo deja reintento, no revierte un commit de negocio.

Consumo valida envelope v1/productor/referencias y límite64KiB; Inbox/huella, notificación y orderConfirmedObserved se guardan juntos sin crear otra asignación. ACK posterior al commit; duplicado idéntico sin repetir efecto; inválido/conflicto va a DLQ con nack sin requeue. Una caída SQL deja la entrega sin ACK y reconexión segura. No acredita CU05 ni lectura humana del aviso.

### Historial de verificación local delegada

Ejecutados con el Node22.22.3 absoluto y pnpm12.6.0 solicitado, con --config.manage-package-manager-versions=false al instalar. Comandos largos desacoplados con output/t21/run-check.mjs, cwd services/employees; logs y .exit en output/t21/.

- node node_modules/vitest/vitest.mjs run: 144/144, 17 archivos; cu15-employees-final-unit-01.exit=0. Incluye regresiones CU03/CU04/CU02, verificador JWT y nuevos runners SQL/canal falsos explícitos.
- node node_modules/vitest/vitest.mjs run --config vitest.config.e2e.ts test/cu15.e2e-spec.ts --hookTimeout=30000: 11/11 HTTP; cu15-employees-http-03.exit=0. Son firmas RSA sintéticas y puertos sustituidos, no integración Keycloak/SQL real. Primer intento detectó readiness sin sustituir; segundo agotó hook10s; ronda posterior pasó sin cambiar aserciones.
- node node_modules/typescript/bin/tsc --noEmit: cu15-employees-final-types-01.exit=0.
- node node_modules/@nestjs/cli/bin/nest.js build: cu15-employees-final-build-02.exit=0 (también build-01 previo).
- node node_modules/oxlint/bin/oxlint --type-aware src/ test/: cu15-employees-final-lint-01.exit=0, cero errores y 14 advertencias previas unbound-method en manage-security.spec.ts. Se eliminó la advertencia del nuevo test de publisher, sin desactivar reglas.

En esa fase delegada no se ejecutó migration:run, no se reinició/provisionó PostgreSQL/RabbitMQ/Keycloak ni se habilitaron adaptadores reales; UI/BFF quedaban fuera del alcance de ese participante. No se hicieron commit/push ni cambios en STATUS/contratos fuera de esta aplicación. Son límites históricos de la delegación, no pendientes vigentes de migración ni una afirmación de ausencia global de UI/BFF.

### Verificación principal posterior y límites

El principal aplicó E1793455200000, F2026_10_28_000002 y O V7, provisionó el coordinador técnico/RabbitMQ y desplegó los adaptadores habilitados. No hubo habilitación automática: mechanicEnabled permanece false para legacy hasta una edición explícita autorizada.

En output/cu15/ ignorado, browser-real3.exit=0 y browser-real.json acreditan seis etapas reales: inelegibilidad visible; habilitación laboral explícita desde ficha existente, persistida sin identidad/roles automáticos; inicio versionado sin éxito prematuro; confirmación conservada tras recarga sin repetir efectos; referencias de O/E/F y Outbox/Inbox; evidencia desktop/mobile con consola limpia y tokens solo en RAM. La corrección JDBC de Operaciones precedió al recorrido exitoso; los primeros intentos no se cuentan como éxito.

distributed-real1 y distributed-real3 acreditaron sus primeras tres etapas: concurrencia por orden/replay, exclusión por empleado/franja y rechazo F con liberación E. Ambas corridas terminaron en fallo en aserciones de navegador; matrix3 también sufrió caída espontánea de RabbitMQ exit137 (OOMKilled=false), no inyectada. El principal recuperó el contenedor propio healthy. No se acredita desde esos resultados la matriz completa de recuperación/compensaciones/duplicado.

La matriz posterior real6 quedó acreditada: output/cu15/distributed-real6.exit=0 y distributed-2026-10-29T00-21-30-311Z-0749409d.json PASS7/7. Cubre carreras por orden/franja, rechazo F con release E, respuesta perdida tras commit F sin compensar el éxito, reinicio del coordinador con IDs/cuerpos durables e identidad técnica, compensación inicialmente pendiente que termina cancel F→release E y retransmisión del mismo eventId con un Inbox/notificación. Ambos browser-proof (recovery_pending y compensation_pending) terminaron PASS con issues=[] y failed=[]. final-check6.json registra restauración DIRECT, readiness200 y flag sintético restaurado. La última corrida no tuvo caídas inesperadas. Esto no convierte las corridas fallidas anteriores en PASS. Regresión proporcional, revisión y cierre permanecen pendientes; no se declara CU15 completo ni revisión independiente. Esta consolidación no ejecuta pruebas. CU05, Flutter, offline y cobros siguen fuera de alcance. El aviso durable no demuestra lectura por un mecánico.
