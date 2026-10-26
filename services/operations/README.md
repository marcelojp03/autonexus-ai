# MS01 Operaciones

Tecnología: Spring Boot 4.1.2, Java 21 y PostgreSQL propia.
Responsabilidad: Bloque 1; bloque 2 implementa CU06–CU09 aquí.
Alcance funcional previsto: clientes, vehículos, servicios, citas, recepción, órdenes, avances y orquestación de Saga CU15.

## Estado y límites

Base técnica S2/T1, sin CU de negocio: no hay CRUD, autenticación, GraphQL, Saga ni tablas de negocio. Build y pruebas sin base se verifican por separado de la integración PostgreSQL. La verificación principal ya comprobó migración/historial/idempotencia, aislamiento y caída/recuperación con PostgreSQL real; ver la sección integrada final. Los mocks solo cubren unidades, no acreditan esa integración.

## Generación y versiones

Generado con Spring Initializr oficial en TEMP propio, no encima de esta carpeta. Descarga HTTP200 y extracción mediante PowerShell:

```powershell
$tmp = Join-Path $env:TEMP 'autonexus-operations-initializr'
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
Invoke-WebRequest -Uri 'https://start.spring.io/starter.zip?type=maven-project&language=java&bootVersion=4.1.2&baseDir=operations&groupId=bo.edu.uagrm.autonexus&artifactId=operations&name=operations&packageName=bo.edu.uagrm.autonexus.operations&packaging=jar&javaVersion=21&dependencies=web,actuator,jdbc,postgresql,flyway' -OutFile (Join-Path $tmp 'starter.zip')
Expand-Archive (Join-Path $tmp 'starter.zip') -DestinationPath $tmp -Force
```

Se trasladaron POM, clase principal y Wrapper mediante apply_patch, preservando el alcance de este README y AGENTS.md. SHA-256 AGENTS: B3C721931AA9852D7BFCDAE1EE13061B25641F0DF4F583B9F7EC32F982EF6295.

Versiones reales: Boot parent 4.1.2; Java/javac Oracle 21.0.8; Wrapper 3.3.4 (only-script, sin wrapper.jar); distribución Apache Maven **3.10.0**, fijada en .mvn/wrapper/maven-wrapper.properties y comprobada con --version. No utiliza Maven global 3.9.11 ni Java global 8. Starters oficiales Boot 4.1 webmvc/actuator/jdbc/flyway y sus starters de prueba; Flyway **12.4.0** y PostgreSQL JDBC **42.7.14**, propiedades flyway.version/postgresql.version del BOM, reutilizadas por el plugin de migración.

## Entorno y comandos (PowerShell)

Todos los comandos siguientes se ejecutan desde la raíz absoluta del servicio:

```powershell
Set-Location 'C:/UAGRM/Ingenieria de Software 2/segundo parcial/autonexus-ai/services/operations'
$env:JAVA_HOME = 'C:/Program Files/Java/jdk-21'
$env:PATH = "$env:JAVA_HOME/bin;$env:PATH"
./mvnw.cmd --version
./mvnw.cmd -B clean verify
```

El ejemplo .env.example no contiene secretos y DB_PASSWORD está vacío deliberadamente. El helper de infraestructura prepara/carga el .env privado al entorno del proceso, sin imprimirlo; **Java y Maven no cargan .env nativamente**. No copiar contraseñas en argumentos -D, URLs, logs o historial. El servicio requiere DB_PASSWORD no vacío y falla antes de arrancar si falta. No leer ni mostrar .env para diagnosticar.

Desde la raíz del servicio, cargar el helper preparado por infraestructura en la consola actual antes de migrar o arrancar (ejecutado por la verificación principal):

```powershell
. ../../infra/compose/scripts/load-service-env.ps1 -Service operations
```

Valores por defecto de aplicación: DB_HOST=127.0.0.1, DB_PORT=55432, DB_NAME=autonexus_operations, DB_USER=autonexus_operations, PORT=8081. El bind HTTP es siempre 127.0.0.1. Solo recibe credenciales de su base propietaria, nunca del administrador ni de Empleados.

### Migración explícita antes del arranque

Con PostgreSQL propio ya preparado y variables privadas cargadas en este proceso, ejecutar desde esta misma carpeta:

```powershell
if ([string]::IsNullOrWhiteSpace($env:DB_PASSWORD)) { throw 'DB_PASSWORD requerido' }
$defaults = @{ DB_HOST='127.0.0.1'; DB_PORT='55432'; DB_NAME='autonexus_operations'; DB_USER='autonexus_operations' }
foreach ($name in $defaults.Keys) {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
        [Environment]::SetEnvironmentVariable($name, $defaults[$name], 'Process')
    }
}
$env:FLYWAY_URL = "jdbc:postgresql://$($env:DB_HOST):$($env:DB_PORT)/$($env:DB_NAME)?connectTimeout=1&socketTimeout=2"
$env:FLYWAY_USER = $env:DB_USER
$env:FLYWAY_PASSWORD = $env:DB_PASSWORD
try {
    ./mvnw.cmd -B flyway:migrate
    if ($LASTEXITCODE -ne 0) { throw 'Migración fallida' }
} finally {
    Remove-Item Env:FLYWAY_URL, Env:FLYWAY_USER, Env:FLYWAY_PASSWORD -ErrorAction SilentlyContinue
}
```

El comando termina, no levanta un servidor; no es un modo migrate-only improvisado. Plugin y driver están alineados al BOM. V1__create_operations_schema.sql crea únicamente schema operations. Historial **public.flyway_schema_history** dentro de la base autonexus_operations. No se configura operations como schema por defecto de Flyway: debe existir por V1, no por creación implícita. clean está deshabilitado en el plugin. Repetir migrate debe validar y no aplicar nuevas versiones. Flyway de arranque permanece habilitado con la misma ubicación/historial.

### Ejecutar y comprobar (requiere base real)

```powershell
./mvnw.cmd spring-boot:run
# Otra consola; cambiar 8081 si se definió PORT.
curl.exe -i http://127.0.0.1:8081/actuator/health/liveness
curl.exe -i http://127.0.0.1:8081/actuator/health/readiness
# Alternativa después de verify:
# java -jar target/operations-0.0.1-SNAPSHOT.jar
```

Arranque puede fallar con PostgreSQL ausente porque aplica Flyway. Una vez listo, detener solo el PostgreSQL de este proyecto debe mantener liveness HTTP200 y cambiar readiness a HTTP503; al restaurarlo, readiness debe volver a HTTP200 sin reiniciar Java. La verificación principal ejecutó esta prueba con los mismos procesos vivos; ver resultados al final.

## Arquitectura y salud

- application/CheckReadiness y puerto DatabaseAvailability: Java puro, sin Spring/JDBC/HTTP. Consultan de nuevo en cada invocación, sin cachear una caída.
- infrastructure/jdbc/JdbcDatabaseAvailability: DataSource propietario, SELECT 1, query timeout 1 s y try-with-resources para conexión, statement y resultset. SQLException se transforma en no disponible, sin transportar excepciones.
- infrastructure/health/OperationsDatabaseHealthIndicator: API real Boot4 org.springframework.boot.health.contributor; construye UP/DOWN sin detalles. Composición de beans en infrastructure/config.
- DDD/hexagonal/Clean proporcional: no existe dominio del taller todavía ni directorios vacíos. El primer CU incorporará agregados/reglas independientes del framework. Persistencia/ORM seguirán dentro del propietario y otros servicios accederán por contratos, nunca por imports de dominio o consultas a bases ajenas.
- Readiness incluye readinessState y operationsDatabase; liveness solo livenessState. Indicador JDBC db duplicado deshabilitado. Solo se expone health; show-details/show-components=never, errores HTTP sin mensaje, stack, binding ni excepción. Respuestas de salud previstas: únicamente {"status":"UP"} / {"status":"DOWN"}; DOWN y OUT_OF_SERVICE mapean a 503.
- Pool Hikari: espera de adquisición 1000 ms, validación 1000 ms, máximo 4 conexiones, mínimo ocioso 0. Driver PostgreSQL: connectTimeout=1 s, socketTimeout=2 s y tcpKeepAlive. La consulta tiene límite propio de 1 s; adquisición y consulta son fases distintas, no un SLA total de 1 s. Se reintenta adquirir una conexión en futuras comprobaciones y Spring cierra el pool al terminar.

## Verificación local

El comando reproducible de build es ./mvnw.cmd -B clean verify (sin credenciales ni base). Las pruebas unitarias cubren el caso puro, UP/DOWN sin detalles, timeout SQL, cierre de recursos, fallo de conexión/consulta y reintento tras recuperación simulada. Los mocks no acreditan integración real. Evidencias locales ignoradas: verification-build.log y verification-build.exit.log.

Comprobado el 2026-10-25: --version código 0; clean verify código 0, 12 pruebas sin fallos/errores/omitidas y JAR ejecutable empaquetado. help:describe -Dplugin=org.flywaydb:flyway-maven-plugin:12.4.0 -Dgoal=migrate -Ddetail=true código 0 (solo metadatos; no migra). git diff --check sin errores y hash AGENTS preservado. Advertencia conservada: auto-attach del agente Mockito/Byte Buddy en Java 21; no afecta las 12 pruebas.

Intentos previos no finales: descarga inicial de Wrapper y primer build excedieron el timeout de la herramienta; dos launchers Node no iniciaron la verificación y un launcher PowerShell separado no dejó resultado; la repetición directa con caché terminó en código 0. flyway:help falló código 1 porque ese plugin no tiene goal help; se sustituyó por help:describe. La comprobación adicional de arranque sin contraseña no llegó a ejecutarse por permiso de herramienta, por lo que no se acredita. La verificación unitaria inicial no dejó servidores activos; el estado integrado final se indica a continuación.

## Verificación integrada final

Realizada en el worktree feat/backend-foundation, con Node 22.22.3, JDK 21.0.8 y PostgreSQL 17.11 real del Compose propio. `clean verify` final pasó12 tests. Se añadió una regresión de configuración con MockEnvironment/DataSource falsos: primero2fallos por ausencia de validación; después3checks pasan para contraseña ausente/blanca/configuración sintética. No lee .env ni ejecuta el ensayo de arranque sin contraseña que fue bloqueado por la herramienta. La validación temprana usa un BeanFactoryPostProcessor y no muestra el valor.

- `./mvnw.cmd -B org.flywaydb:flyway-maven-plugin:12.4.0:migrate`: código0, V1 aplicada con el usuario propietario. Segunda ejecución: código0, schema actualizado sin nueva migración. Historial con1 versión.
- JAR ejecutado en127.0.0.1:8081 con su entorno privado. Liveness/readiness200 y cuerpo solo status. Al parar exclusivamente PostgreSQL, liveness200 y readiness503DOWN; al restaurarlo, ambos200UP sin reiniciar Java.
- El usuario conecta a su base y recibe42501 al intentar Empleados, postgres otemplate1; sin privilegios elevados.
- Shell y MFs previos siguen funcionando. No se modificaron fuentes ni versiones frontend.

Comandos de infraestructura y verificación: [infra/compose](../../infra/compose/README.md). Logs locales ignorados: `../../output/backend-foundation/operations-build.log`, migraciones y `health-outage.log`. Revisión independiente completada: cumplimiento/corrección/consistencia conformes, sin críticos. Tras la pausa planificada de revisión, el servicio se reactivó con live/ready200. Avisos no bloqueantes: metadata de feeds auxiliares Flyway401 y Mockito/Byte Buddy; no se añadieron credenciales para esos feeds ni se ocultaron advertencias.

## Ubicación definitiva de la base integrada

Backend-foundation fue integrado por fast-forward a main3bbf499 por instrucción de Marcelo. Esta carpeta principal es ahora la ubicación runtime; las configuraciones privadas se copiaron sin cambiar sus bytes/credenciales, y el volumen e historial se conservaron. Recompilación y comprobación real desde la raíz PASS; ver output/backend-main-integration y STATUS. El worktree anterior sigue existiendo, pero no administra el contenedor actual; su verificador rechaza ownership desactualizado. No se hizo push.
