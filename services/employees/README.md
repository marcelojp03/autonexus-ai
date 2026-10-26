# MS02 Empleados

Tecnología: NestJS. Persistencia: PostgreSQL propia. Responsabilidad: Bloque 1.
Alcance funcional previsto: empleados, especialidades, jornadas, disponibilidad, reservas de horario y asignaciones.

## Estado y límites

Base técnica T2 del diseño `docs/compose/spec/backend-foundation.md`, aprobada por Marcelo (S2). Generada y comprobada localmente en `feat/backend-foundation`, base `7bc80a7`, el 2026-10-25. No implementa CU01, CRUD, autenticación, GraphQL ni participación en Saga. Ningún CU de negocio se considera terminado.

Hay instalación reproducible, compilación, pruebas unitarias y HTTP con probe falso explícito. La migración, historial, aislamiento y caída/recuperación con PostgreSQL real ya fueron comprobados por la verificación principal; se describen al final. Las `.env` privadas las genera infraestructura, no se versionan ni se imprimen. AGENTS y alcance funcional preservados; sin Git separado ni commits.

## Generación y versiones reales

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

## Evidencia de esta entrega

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

## Verificación integrada final

La verificación principal repitió frozen/build,13pruebas unitarias+3 HTTP y lint: código0, sin warnings de lint. Luego ejecutó `exec typeorm migration:run -d dist/infrastructure/postgres/data-source.js` contra PostgreSQL 17.11 propio con el rol de Empleados:1migración aplicada; segunda ejecución sin pendientes; historial public.employees_migrations con1 versión y schema employees presente.

El proceso Node 22.22.3 real sirve127.0.0.1:3002. Liveness/readiness200UP; PostgreSQL detenido→live200/ready503DOWN; PostgreSQL restaurado→live200/ready200UP, mismo PID/hora de inicio, sin reiniciar Node. Los cuerpos contienen exclusivamente status. El rol conecta a su base y recibe42501 para Operaciones, postgres ytemplate1, sin privilegios elevados.

Scripts y comandos en [infra/compose](../../infra/compose/README.md). Logs ignorados en `../../output/backend-foundation/`, incluidos build/tests, migraciones, aislamiento y health-outage. Revisión independiente concluida sin críticos; después se reactivó el servicio con live/ready200; ningún CU de negocio, Keycloak, CRUD o Saga se acredita por esta base técnica.

## Ubicación definitiva de la base integrada

Backend-foundation fue integrado por fast-forward a main3bbf499 por instrucción de Marcelo. Esta carpeta principal es ahora la ubicación runtime; las configuraciones privadas se copiaron sin cambiar sus bytes/credenciales, y el volumen e historial se conservaron. Recompilación y comprobación real desde la raíz PASS; ver output/backend-main-integration y STATUS. El worktree anterior sigue existiendo, pero no administra el contenedor actual; su verificador rechaza ownership desactualizado. No se hizo push.
