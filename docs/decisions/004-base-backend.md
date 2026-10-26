# 004 — Base técnica backend de Operaciones y Empleados

Fecha: 2026-10-25. Estado: implementación aprobada por Marcelo mediante compose-next; verificación real y revisión independiente completadas, sin críticos. Esta nota no adopta reglas funcionales de CU.

## Versiones elegidas y evidencia

| Parte               | Versión comprobada / elección                                             |
| ------------------- | ------------------------------------------------------------------------- |
| Operaciones         | Spring Boot 4.1.2 estable, Java/JDK Oracle21.0.8 LTS                      |
| Maven               | Wrapper 3.3.4 only-script del generador, distribución Maven 3.10.0 fijada |
| Migración/JDBC Java | Flyway 12.4.0, PostgreSQL JDBC42.7.14, gestionados por BOM Boot           |
| Empleados           | NestJS 12.2.0, CLI oficial12.0.10, Node 22.22.3, pnpm12.6.0               |
| Persistencia Node   | TypeORM 1.1.2, @nestjs/typeorm12.0.2, pg8.23.1                            |
| Herramientas Node   | TypeScript 6.0.3, Vitest 4.1.12; resolución fijada en pnpm-lock.yaml      |
| PostgreSQL          | Imagen oficial postgres:17.11-bookworm, runtime17.11 Debian               |
| Docker del equipo   | Engine29.9.2, Compose 5.6.0, Docker Desktop operativo Linux/amd64         |

Spring Initializr devolvió POM4.1.2/Java 21 y el Wrapper completo. Maven Central enumera 4.2RC como latest/release; se excluyó por no ser estable. La rama PostgreSQL 17 sigue soportada y17.11 era su minor vigente en la fuente oficial. Node 22.22.3 satisface los engines de Nest 12/TypeORM1 y se conserva en los frontend existentes; no se cambió Node global22.14, Java global8 ni javac global23. Los ejecutables correctos se seleccionan solo por proceso. No se generó ningún otro servicio.

Fuentes: https://start.spring.io/metadata/client ; https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-starter-parent/maven-metadata.xml ; https://docs.spring.io/spring-boot/4.1/reference/actuator/endpoints.html ; https://docs.nestjs.com/cli/usages ; https://docs.nestjs.com/techniques/database ; metadatos npm de las versiones exactas; https://www.postgresql.org/support/versioning/ y manifest oficial Docker. La compilación confirmó los paquetes Actuator4.1 `org.springframework.boot.health.contributor`.

## Límites y arquitectura

Se generan dos aplicaciones en services/operations y services/employees, sin niveles intermedios ni Git propios. Se preservan AGENTS y el alcance de README. El caso técnico de readiness y su puerto son puros; adaptadores JDBC/TypeORM y HTTP/Actuator viven en infraestructura, junto con la composición. No se crean dominios ficticios ni capas vacías: los agregados/reglas del taller se introducirán con el primer CU. ORM y migraciones permanecen en su propietario; no hay consultas/imports de dominio entre servicios.

## PostgreSQL local y secretos

Un servidor exclusivo del Compose `autonexus-backend-dev`, contenedor autonexus-backend-dev-postgres, puerto host127.0.0.1:55432 y volumen propio. No se utiliza ni se detiene PostgreSQL de otros proyectos o el servidor5432 existente. Dos bases/roles distintos: autonexus_operations y autonexus_employees. Sin superusuario, CREATEDB, CREATEROLE, replicación ni bypassRLS. PUBLIC no tiene CONNECT/TEMP en las bases de aplicación ni en postgres/template1; cada usuario conecta solo a su base. Estos roles SQL no son roles/permisos del taller ni implementan CU02.

Un script genera tres .env locales ignorados por Git, con contraseñas aleatorias diferentes y acceso exclusivo de creación; se niega a sobrescribir archivos existentes. Los ejemplos no contienen contraseñas utilizables. Los servicios reciben solo sus variables, nunca la credencial administrativa. Java carga el entorno mediante helper PowerShell; Node usa process.loadEnvFile. No se imprimen valores ni se pasan contraseñas en URLs/argumentos. Las verificaciones no muestran errores internos en respuestas HTTP.

El bootstrap initdb solo corre al crear el volumen; modificar .env no rota roles de un volumen existente. Una instancia local por nombre de proyecto/puerto; conservar los archivos privados al mover el workspace. No se automatiza down -v ni eliminación de datos. Los scripts SQL deben conservar LF, fijado en .gitattributes.

## Migraciones y salud

Operaciones: Flyway 12.4.0 y V1 crea schema operations; historial public.flyway_schema_history. Plugin Maven termina al migrar y tiene clean deshabilitado; startupFlyway sigue validando/aplicando. Empleados: CLI TypeORM sobre JS compilado y migración inicial del schema employees; historial public.employees_migrations; synchronize=false y migrationsRun=false. No hay tablas de negocio. Cada historial tiene una versión y las segundas ejecuciones fueron no-op.

| Servicio                    | Proceso vivo              | Disponibilidad con SQL real |
| --------------------------- | ------------------------- | --------------------------- |
| Operaciones, 127.0.0.1:8081 | /actuator/health/liveness | /actuator/health/readiness  |
| Empleados, 127.0.0.1:3002   | /health/live              | /health/ready               |

Readiness consulta SELECT1 contra la base propia y responde200UP/503DOWN; liveness no depende de DB. Los cuerpos contienen solo status. Adquisición/conexión/consulta tienen límites de1–2s por fase; no es un SLA agregado de1s. El pool descarta/recrea conexiones y el estado no se cachea como éxito fijo. Boot puede requerir DB al arrancar por Flyway; Empleados puede iniciar con DB ausente y comprobarla después.

El verificador de caída comprueba primero nombre/proyecto/servicio y working_dir del contenedor, detiene únicamente ese PostgreSQL y lo arranca en finally. Se observó200→503→200 en ambos readiness, liveness200 y mismos PID/hora de inicio Java/Node, sin reiniciar aplicaciones. Aislamiento real: tres rechazos42501 por rol (base ajena, postgres ytemplate1), sin privilegios elevados.

## Verificación y limitaciones

Build Maven y12 tests; buildNest,13 unitarias+3 HTTP, lint0 warnings y frozen: PASS. Migraciones/historial/idempotencia y caída/recuperación: PASS con PostgreSQL real. Shell4200 navega y recarga; MF4201/4202 renderizan login demo; sin cambios en sus fuentes o dependencias. Evidencia local ignorada en output/backend-foundation. Revisión independiente del rango7bc80a7..6027fce conforme en cumplimiento/corrección/consistencia, sin críticos; posterior reactivación con salud200 y PostgreSQL healthy. La comprobación de PID/StartTime durante caída proviene del principal, no de una aserción autónoma del script.

Se conservan avisos Maven 3.10 de metadata de feeds auxiliares Flyway con401 (los artefactos y comandos requeridos resolvieron y terminaron en0), y auto-attach Mockito/Byte Buddy en Java 21. No se configuraron credenciales para esos feeds ni se cambiaron versiones para ocultarlos. No se ejecutó ni se reintentó el ensayo adicional del actor de arrancar Java sin password bloqueado por permiso de herramienta. Una regresión aislada con MockEnvironment y DataSource falsos evidenció la validación faltante y confirmó el arreglo temprano sin leer secretos ni arrancar servicios.

Fuera de alcance: Keycloak, CU01, CRUD de empleados, Saga, BFF/GraphQL, Finanzas, Inteligencia, Sincronización, MCP, PWA/offline, datos reales del taller y despliegue. El siguiente paso de código requiere su CU/contrato, no dar por implementado negocio a partir de salud técnica.
