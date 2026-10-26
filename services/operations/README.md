# MS01 Operaciones

Tecnología: Spring Boot 4.1.2, Java 21 y PostgreSQL propia.
Responsabilidad: Bloque 1; bloque 2 implementa CU06–CU09 aquí.
Alcance funcional previsto: clientes, vehículos, servicios, citas, recepción, órdenes, avances y orquestación de Saga CU15.

## Estado y límites

Base técnica con Resource Server CU01 y dos recursos REST de diagnóstico; sin CRUD, GraphQL, Saga ni tablas de negocio. La autenticación interactiva pertenece a Keycloak y al cliente OIDC, no a este servicio. Build y pruebas sin base se verifican por separado de la integración PostgreSQL y del SSO real. La verificación principal de la base ya comprobó migración/historial/idempotencia, aislamiento y caída/recuperación con PostgreSQL real; las secciones de base siguientes son evidencia histórica. Los mocks solo cubren unidades, no acreditan integración.

## Seguridad técnica CU01

Implementación en `feat/cu01-keycloak`, worktree `.worktrees/cu01-keycloak`; no cambia automáticamente el runtime de main ni su PostgreSQL. No se inicia un segundo servidor en8081. El integrador principal es responsable de sustituir el runtime y comprobar Keycloak26.8.1 real.

- Se mantiene Boot **4.1.2**, Oracle JDK **21.0.8**, Wrapper **3.3.4** y Maven **3.10.0**. Starter oficial Boot4 `spring-boot-starter-security-oauth2-resource-server`, sin versiones sobrescritas: Spring Security **7.1.2**, Nimbus JOSE JWT **10.9.1**, gestionados por el BOM; `spring-security-test` solo en pruebas. APIs HTTP/Security quedan en infrastructure; application/readiness y persistencia no cambian.
- Configuración pública opcional, con defaults locales explícitos: `OIDC_ISSUER_URI=http://127.0.0.1:8180/realms/autonexus`, `OIDC_AUDIENCE=autonexus-operations-api`, `WEB_ALLOWED_ORIGINS=http://127.0.0.1:4200,http://127.0.0.1:4201,http://127.0.0.1:4202`. Están en `.env.example`; no se lee ni modifica el `.env` privado. No existe bypass de autenticación. HTTP loopback es solo desarrollo local, no configuración de producción.
- Nimbus verifica exclusivamente RS256. JWKS se deriva del issuer **configurado** añadiendo `/protocol/openid-connect/certs`; jamás de `jku` ni del `iss` recibido. No necesita discovery/red al crear el bean. Conexión y lectura tienen timeout de2s cada una. Se conserva el caché oficial Nimbus de5min, con actualización por `kid` desconocido; descarga inicial/renovación fallida rechaza la autenticación, sin aceptar firmas no verificadas. Una clave conocida en caché permite validación offline mientras siga vigente.
- Validadores oficiales comprueban issuer exacto, audiencia propia, `exp` obligatorio, tiempo de expiración y `nbf` cuando existe con tolerancia5s; además sujeto no vacío y claim `typ=Bearer`. IDtokens sin esa marca o audiencia API son rechazados. No hay criptografía casera.
- `realm_access.roles` se filtra y deduplica a administrador, recepcionista, mecanico, jefe_taller y responsable_financiero. Sin herencia empresarial. No se exponen claims completos ni autoridades internas como `FACTOR_BEARER` de Security7.
- `GET /technical/session`: token válido y alguno de los cinco roles → exactamente `{resource:"session",service:"operations",subject,roles}`. `GET /technical/admin`: administrador → exactamente `{resource:"admin",service:"operations",authorized:true}`. No constituyen permisos de negocio ni CU02.
- Ausencia/token inválido →401 `{"error":"unauthorized"}` y challenge `Bearer` sin detalles; válido sin permiso →403 `{"error":"forbidden"}`. Sin tokens, headers recibidos, stack ni datos de base en respuestas.
- Bearer solo en Authorization, sin query/form/cookies. Stateless, sin sesión, login básico/formulario, logout de API ni caché de peticiones. CSRF desactivado porque las cookies no autentican esta API. CORS solo en los dos recursos técnicos, orígenes exactos configurados (sin comodines), GET/OPTIONS y Authorization/Content-Type, sin credenciales.
- `GET /actuator/health/liveness` y `GET /actuator/health/readiness` son públicas; no consultan IdP. Readiness conserva su consulta real a la base propietaria. Todo otro recurso/método se deniega por defecto.
- Logout termina la sesión/renovación del IdP y el estado cliente, no revoca instantáneamente JWTs validados offline. Tokens ya emitidos pueden aceptarse hasta **exp+5s**; tampoco retirar roles/deshabilitar usuarios revoca mágicamente esos JWTs. No se implementa introspección/blacklist.

### Comandos de verificación CU01 (sin base ni servidor)

```powershell
Set-Location "C:/UAGRM/Ingenieria de Software 2/segundo parcial/autonexus-ai/.worktrees/cu01-keycloak/services/operations"
$env:JAVA_HOME = "C:/Program Files/Java/jdk-21"
$env:PATH = "$env:JAVA_HOME/bin;$env:PATH"
./mvnw.cmd --version
./mvnw.cmd -B clean verify
./mvnw.cmd -B dependency:tree "-Dincludes=org.springframework.security:*,com.nimbusds:*,org.springframework.boot:spring-boot-starter-security-oauth2-resource-server"
```

Estos comandos no cargan `.env`, no requieren DB_PASSWORD y no arrancan la aplicación. La comprobación de entorno de base existente usa únicamente MockEnvironment sintético; no se repite un arranque sin contraseña. Para herramientas con límite60s se ejecutaron workers PowerShell desacoplados, con logs ignorados y ficheros de salida, y se sondeó hasta terminar; no son servidores en background.

Pruebas criptográficas: RSA2048/JWKS sintéticos en memoria y transporte HTTP falso; firma válida/alterada, issuer/audience/exp/nbf/sub/tipo, skew5s, IDtoken, HS/none/malformado, destino JWKS confiable pese a jku, caché/rotación y fallo cerrado. Pruebas MVC: decoder y salud explícitamente falsos, filtro HTTP real para401/403/200, DTO exacto/roles, métodos/rutas denegados, ausencia de cookie de sesión y CORS. **Ninguna acredita login, SSO, refresh, logout o conexión con Keycloak real, ni sustituye pruebas integradas de PostgreSQL.**

Comprobado el2026-10-25: Wrapper `--version` PASS (Maven3.10.0/JDK21.0.8); `clean verify` final **exit0,46tests** (12 de base,20 de RSA/JWKS,14 MVC), sin fallos/errores/omitidas y JAR ejecutable. `dependency:tree` PASS con las versiones anteriores. Evidencia ignorada local: `verification-auth-version.log`, `verification-auth-verified.log`/`verification-auth-verified.exit.log`, `verification-auth-dependencies.log`/`verification-auth-dependencies.exit.log`.

Regresión inicial `-Dtest=AccessTokenDecoderTest test` roja, exit1 por decodificador todavía ausente (`verification-auth-red.log`). Iteraciones no finales: import de builder MVC faltante y prueba de DTO que detectó `FACTOR_BEARER`; corregidos antes del build final. `verification-auth-final.log` es una ejecución anterior de45tests PASS; la evidencia vigente es `verification-auth-verified.log` con46tests, incluyendo claim typ de tipo incorrecto. No se ocultaron avisos de metadata auxiliar MavenFeed401 ni Mockito/Byte Buddy. El AGENTS local conserva SHA-256 B3C721931AA9852D7BFCDAE1EE13061B25641F0DF4F583B9F7EC32F982EF6295. No se hicieron commits, cambios Docker, migraciones, lecturas de secretos ni arranques de servidor durante esta implementación.

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
