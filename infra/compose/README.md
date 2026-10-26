# PostgreSQL local de Operaciones y Empleados

Base técnica del participante 1; un servidor propio, dos bases/usuarios aislados. No contiene infraestructura de Finanzas, Inteligencia, Sincronización ni MCP. Contrato aprobado en [backend-foundation](../../docs/compose/spec/backend-foundation.md) y decisión [004](../../docs/decisions/004-base-backend.md).

## Recursos y versiones comprobadas

- Imagen oficial `postgres:17.11-bookworm`; runtime PostgreSQL 17.11 Debian, manifest Linux/amd64 verificado.
- Docker Engine 29.9.2 / Compose 5.6.0 en este equipo. No se requieren instalaciones globales nuevas.
- Proyecto Compose `autonexus-backend-dev`, contenedor `autonexus-backend-dev-postgres`, volumen propio `autonexus-backend-dev_postgres-data`.
- Puerto exclusivo `127.0.0.1:55432 → 5432`. No se reutiliza ni detiene el PostgreSQL existente de5432 ni contenedores de otros proyectos.
- Operaciones: base/rol `autonexus_operations`; Empleados: `autonexus_employees`. Administrador local exclusivo, no entregado a los servicios.

Los roles de aplicación no tienen privilegios elevados. PUBLIC no tiene CONNECT/TEMP en las dos bases ni en postgres/template1; cada usuario solo conecta a la suya. Son roles SQL técnicos, no roles de negocio/CU02. Las migraciones pertenecen a cada servicio, no al bootstrap del servidor.

## Configurar y arrancar (PowerShell)

Comandos comprobados desde este directorio. En el workspace de esta tarea está en `.worktrees/backend-foundation/infra/compose`.

```powershell
$node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$pnpm = 'C:/Users/marcelo/AppData/Local/node/corepack/v1/pnpm/12.6.0/bin/pnpm.mjs'
$env:Path = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + $env:Path
& $node scripts/init-env.mjs
docker compose --env-file .env config --quiet
docker compose --env-file .env up --detach --wait --wait-timeout 60
docker compose --env-file .env ps
```

`init-env.mjs` no requiere instalar paquetes: usa Node 22, crea tres archivos privados ignorados por Git (este .env y el de cada servicio), con contraseñas aleatorias distintas. Comprueba primero que Git ignore las rutas y se niega si ya existe algún archivo; no sobrescribe ni imprime valores. Se comprobó una segunda invocación: rechazo y los tres archivos sin cambios. Los ejemplos versionados dejan contraseñas vacías deliberadamente, no sirven como credenciales.

No mostrar `.env`, `docker inspect Config.Env` ni `docker compose config` completo: este último resuelve secretos. Para validar, usar `config --quiet`. No copiar passwords a argumentos -D, URLs, capturas o informes. En POSIX los archivos se crean con modo0600; en Windows heredan ACL locales y no se versionan.

El bootstrap `initdb/010-create-databases.sh` se ejecuta **solo al inicializar el volumen**, valida nombres, cita identificadores/literales SQL y lee contraseñas vía entorno de psql, no argumentos. No habilita extensiones ni crea tablas de negocio. Cambiar .env no rota usuarios en un volumen existente; conservar configuración/volumen coherentes. Nunca se ejecuta `down -v` automáticamente.

## Preparar y migrar servicios

Seguir primero los README de [Operaciones](../../services/operations/README.md) y [Empleados](../../services/employees/README.md): instalar con las versiones correctas, compilar y cargar solo el entorno del servicio. Node/pnpm globales22.14/11 y Java global8 no se usan.

Operaciones, desde services/operations:

```powershell
$env:JAVA_HOME = 'C:/Program Files/Java/jdk-21'
$env:Path = 'C:/Program Files/Java/jdk-21/bin;' + $env:Path
./mvnw.cmd -B clean verify
. ../../infra/compose/scripts/load-service-env.ps1 -Service operations
$env:FLYWAY_URL = 'jdbc:postgresql://{0}:{1}/{2}?connectTimeout=1&socketTimeout=2' -f $env:DB_HOST,$env:DB_PORT,$env:DB_NAME
$env:FLYWAY_USER = $env:DB_USER
$env:FLYWAY_PASSWORD = $env:DB_PASSWORD
./mvnw.cmd -B org.flywaydb:flyway-maven-plugin:12.4.0:migrate
# En esta consola con entorno propio, arrancar:
& 'C:/Program Files/Java/jdk-21/bin/java.exe' -jar target/operations-0.0.1-SNAPSHOT.jar
```

Empleados, en otra consola y desde services/employees, con $node/$pnpm de arriba:

```powershell
& $node $pnpm install --frozen-lockfile
& $node $pnpm build
# Carga su entorno si la consola tenía variables de otro servicio:
. ../../infra/compose/scripts/load-service-env.ps1 -Service employees
& $node $pnpm exec typeorm migration:run -d dist/infrastructure/postgres/data-source.js
& $node $pnpm start:prod
```

El helper carga las seis variables de formato simple generado (sin eval, sin imprimirlas) solo en el proceso actual. La copia CU01 añade a su allowlist las variables públicas opcionales OIDC_ISSUER_URI, OIDC_AUDIENCE y WEB_ALLOWED_ORIGINS de .env.example; no requiere agregarlas a los archivos privados preservados, porque los servicios tienen defaults locales explícitos. Otras claves siguen rechazadas. No cambia variables globales. Java/Maven no cargan .env nativamente; Node carga su archivo con process.loadEnvFile, respetando variables ya inyectadas. Usar consolas separadas o cargar el entorno correcto antes de cambiar de servicio. Regresión con fixtures sintéticos: node --test scripts/service-env-contract.test.mjs desde la raíz CU01, sin leer secretos reales.

Ambas migraciones se ejecutaron y repitieron: Flyway informa schema actualizado sin migración nueva y TypeORM informa que no hay pendientes. Schema operations/employees, historiales `public.flyway_schema_history` y `public.employees_migrations`, una versión en cada uno. No hay tablas de empleados, órdenes u otro negocio. El proyecto Maven tiene versión de desarrollo0.0.1-SNAPSHOT del generador; las dependencias Boot/Flyway/driver seleccionadas son estables.

## Salud y prueba de caída real

| Servicio    | Puerto local | Liveness                  | Readiness                  |
| ----------- | ------------ | ------------------------- | -------------------------- |
| Operaciones | 8081         | /actuator/health/liveness | /actuator/health/readiness |
| Empleados   | 3002         | /health/live              | /health/ready              |

Las respuestas tienen únicamente status. Readiness consulta SQL real a la base propia: 200UP o503DOWN; liveness200 no depende de DB. Timeouts de conexión/adquisición/consulta se aplican por fase, no constituyen SLA agregado.

Desde infra/compose, una vez ambos servicios estén ejecutándose:

```powershell
& $node scripts/verify-databases.mjs --require-migrations
& $node scripts/verify-health.mjs
```

El verificador de bases usa el pg instalado en Empleados; requiere instalar sus dependencias. Se conecta con ambas identidades, valida base/usuario/privilegios y schema/historial, y exige error42501 para base ajena, postgres ytemplate1. No muestra contraseñas ni mensajes internos de conexión.

**verify-health cambia estado local:** valida primero las etiquetas de contenedor/proyecto/servicio/working_dir; no toca un contenedor ajeno aunque se parezca por nombre. Prueba UP, detiene solo este PostgreSQL y lo restaura en finally; no inicia ni reinicia aplicaciones. Requiere Docker operativo y las apps ya arrancadas. Si falla, informa fallo e intenta restaurar, sin declarar éxito ni ocultar la salida1. Puede consumir hasta los deadlines15/20/35s más comandos Docker; usar una terminal persistente, no un ejecutor que mate procesos largos a60s.

## Resultados reales

- Compose config/up: PASS, contenedor healthy y puerto55432 exclusivo.
- Aislamiento: PASS, conexión propia y tres rechazos por rol, sin privilegios elevados.
- Migraciones/historial/idempotencia: PASS, una versión por servicio y segunda ejecución no-op.
- Caída/restauración: PASS, ambos readiness200→503→200, ambos liveness200 y mismos PID/hora de inicio de Java y Node; sin reiniciar aplicaciones.
- .env: ignorados, nunca impresos y no sobrescritos por una segunda inicialización.
- Shell4200: navegación Empleados→Operaciones→Empleados y reload; MF4201/4202: login demo visible. 0 errores JS/recursos durante ese recorrido. No se cambiaron fuentes ni versiones frontend.

Logs locales ignorados: `../../output/backend-foundation/`. No publicar logs de migración sin revisar: el CLI oficial TypeORM imprime SQL/errores. Los scripts y ejemplos se versionan; secretos, datos y builds no.

## Operación y límites

Una instancia por este nombre/puerto en el host. Si un puerto está ocupado, elegir otro en configuración antes de arrancar; nunca matar procesos ajenos. Al mover el workspace o integrar una rama, conservar/trasladar de forma privada la configuración que corresponde al volumen existente, no regenerar passwords sobre él. Las etiquetas de ownership ligan las pruebas de caída al workspace propietario.

Para una pausa normal, `docker compose --env-file .env stop postgres` conserva datos; `start postgres` los restablece. No se documenta un reset destructivo como paso normal. Los servidores de otros proyectos se dejan intactos. PWA, BFF, Keycloak, CU01, CRUD y Saga quedan pendientes.

## Cierre de revisión

Revisión independiente de7bc80a7..6027fce aprobada en cumplimiento/corrección/consistencia, sin críticos. La comparación de PID/StartTime durante caída la realizó el principal; verify-health no la captura automáticamente. Tras pausar los procesos propios para la revisión, PostgreSQL y ambos servicios se reactivaron: healthy y live/ready200; frontends4200/4201/4202HTTP200. No hubo merge/push automático ni cambios de negocio.

## Runtime trasladado a main

Por instrucción de Marcelo, la ejecución de esta base se trasladó de .worktrees/backend-foundation a la raíz principal tras el fast-forward a3bbf499. No ejecutar init-env para regenerar secretos: se copiaron los tres archivos privados con exclusión Git y comparación de bytes. Se recreó solo el contenedor propio para actualizar bind/config/working_dir; el volumen autonexus-backend-dev_postgres-data y sus usuarios/historiales permanecieron intactos.

Se verificó desde esta raíz aislamiento, una migración por servicio y caída/restauración200→503→200 sin reiniciar apps. El verificador del worktree anterior se niega a parar el PostgreSQL por ownership distinto, comportamiento esperado; administrar con los scripts de esta ubicación definitiva. No se eliminaron worktree, rama o volumen y no se hizo push.
