---
feature: backend-foundation
status: delivered
updated: 2026-10-25
branch: feat/backend-foundation
commits: "7bc80a7..6027fce"
---

# Base backend de Operaciones y Empleados

## Report

**What was built** — Dos bases técnicas generadas oficialmente y separadas por propietario: Operaciones Spring Boot4.1.2/JDK21 y Empleados Nest12.2/Node22.22.3. Manifiestos y fuentes directamente en sus carpetas, Wrapper/lockfile, migraciones de schemas propios y casos/puertos puros con adaptadores de disponibilidad. No hay dominio ficticio, CRUD, autenticación ni Saga.

PostgreSQL17.11 propio de Compose, dos bases/roles aislados y tres configuraciones privadas generadas sin imprimirlas ni sobrescribirlas. Liveness independiente de DB; readiness con SELECT1 real, timeout y200UP/503DOWN. README/decisión004/STATUS documentan límites, versiones y comandos.

**Verification** — Ejecutada con JDK21.0.8 y Node22.22.3/pnpm12.6.0 en sus directorios. Evidencia local ignorada en output/backend-foundation; las pruebas con fakes no se usan para acreditar PostgreSQL real.

| Comando / comprobación                                                          | Resultado observado                                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Initializr starter.zip / NestCLI12.0.10                                         | Oficiales, raíces directas, sin Git por app y AGENTS intactos                                                  |
| Ops ./mvnw.cmd -B clean verify                                                  | PASS,12tests sin fallos/errores/omitidas y JAR ejecutable                                                      |
| Empleados install --frozen-lockfile / build                                     | PASS, sin nueva resolución / compilación correcta                                                              |
| Empleados test / test:e2e / lint                                                | PASS,13unitarias+3HTTP;0errores/warnings de lint                                                               |
| init-env.mjs y segunda invocación                                               | PASS,3envGitignored; rechaza overwrite,3buffers sin cambios                                                    |
| docker compose config --quiet / up --detach --wait                              | PASS, PostgreSQL17.11 propio healthy en55432                                                                   |
| Flyway12.4.0:migrate, primera y segunda                                         | PASS, V1 aplicada y segunda no-op                                                                              |
| TypeORM migration:run -d dist/infrastructure/postgres/data-source.js, dos veces | PASS,1migración y luego sin pendientes                                                                         |
| verify-databases.mjs --require-migrations                                       | PASS,1historial por servicio, conexión propia,3denegaciones42501 por rol y sin privilegios elevados            |
| verify-health.mjs con DB real, tras último cambio                               | PASS, ambos readiness200→503→200 y liveness200; DB restaurada en finally                                       |
| Identidad de procesos durante caída                                             | Comparación del principal: mismos PID/hora de inicio; el script por sí solo no captura esa identidad           |
| Navegador frontend y diffweb                                                    | PASS,navegación sin reload,recarga,login de ambos standalone,0erroresJS/recursos;fuentes/versiones sin cambios |
| git diff --cached --check / exclusión de.env                                    | PASS; sin datos privados, builds o dependencias en índice                                                      |
| Revisión independiente del rango7bc80a7..6027fce                                | Cumplimiento/corrección/consistencia conformes;0críticos                                                       |

Después de revisión se reactivaron solo PostgreSQL y backend propios. Comprobación final: ambos live/readyHTTP200 con cuerpo solo status; PostgreSQL healthy; frontend4200/4201/4202HTTP200. La parada planificada para revisión no forma parte de la prueba de caída: esa recuperación se produjo sin reiniciar las aplicaciones. No se hizo merge ni push.

**Journey log**

1. Se preparó un único monorepo main7bc80a7, retirando a la Papelera los .git de NG-ALAIN ajenos con autorización; el trabajo backend vive en feat/backend-foundation.
2. Se evitó el PATH global Java8/javac23/Node22.14: JDK21 y Node22.22.3 por proceso. El Wrapper oficial fijó Maven3.10.0; Boot4.1 usa el paquete health.contributor.
3. CLI Nest12 genera ESM/TypeScript6/Vitest4/Oxlint, no Jest. Los paquetes/peers reales determinaron la configuración; no se supusieron versiones anteriores.
4. Un test de contexto aislado evidenció dos casos de password no validados; el control temprano pasó los tres checks. No se leyó .env ni se repitió el arranque sin credenciales bloqueado al actor.
5. PostgreSQL real acreditó migraciones/aislamiento y recuperación. Se conservan avisos no bloqueantes de feeds auxiliares Maven401 y Mockito; la observación de trazabilidad de PID queda documentada, sin fingir una aserción automática del script.

## [S1] Problema

El Shell y los dos Angular ya funcionan, pero MS01/MS02 siguen siendo carpetas con contexto. Se necesita una base técnica ejecutable, migrable y comprobable con PostgreSQL real, sin simular disponibilidad ni implementar todavía funciones del taller.

## [S2] Diseño y contratos de aceptación

### Workspace, versiones y generación

- Monorepo raíz creado por instrucción de Marcelo: main, base local `7bc80a7`, origin `https://github.com/marcelojp03/autonexus-ai.git`, sin push. Los .git de NG-ALAIN ajenos fueron retirados a la Papelera, no los archivos fuente. Esta tarea se implementa en el worktree `.worktrees/backend-foundation`, rama `feat/backend-foundation`. No se inicializa Git por aplicación.
- Operaciones: Spring Boot **4.1.2** estable, **JDK 21.0.8 LTS** disponible, Maven Wrapper3.3.4 only-script del generador oficial y distribución Maven3.10.0 fijada. Spring Initializr devuelve un POM 4.1.2/Java21 con starters webmvc, actuator, JDBC, Flyway y driver PostgreSQL. No usar frameworks/dependencias snapshot oRC aunque Maven metadata los enumere como latest/release. El identificador de desarrollo del proyecto puede conservar0.0.1-SNAPSHOT del generador; no es la versión del framework. La distribución real del Wrapper fue comprobada.
- Empleados: generador oficial **@nestjs/cli 12.0.10**, NestJS **12.2.0**, Node **22.22.3**, pnpm **12.6.0** y lockfile. TypeORM **1.1.2**, @nestjs/typeorm **12.0.2** y pg **8.23.1**: versiones publicadas y engines/peers compatibles con Node22.22 y Nest12. TypeScript6.0.3 y Vitest4.1.12 del generador comprobados; no se actualizaron por suposición.
- Generar en un directorio temporal y trasladar solo lo necesario a services/operations y services/employees, preservando AGENTS y documentación. Los manifiestos, Wrapper y fuentes quedan directamente en esas carpetas, sin segundo nivel del nombre del servicio. Nest se genera con skip-git y sin telemetría/Observe configurado. No modificar las versiones frontend.

### PostgreSQL y entorno local

- Entorno propio en infra/compose: imagen oficial **postgres:17.11-bookworm**, minor vigente de una rama soportada, manifest Linux/amd64 verificado. Un contenedor/volumen de proyecto AutoNexus específico, no reutilizar ni detener PostgreSQL de otros proyectos ni el servidor 5432 existente.
- Publicar solo en 127.0.0.1, puerto **55432**, comprobado libre. Operaciones usa su base/rol `autonexus_operations`; Empleados usa su base/rol `autonexus_employees`. Un administrador exclusivo de esta instancia crea ambos, sin entregar sus credenciales a los servicios.
- Roles de aplicación sin superusuario, CREATEDB, CREATEROLE, replicación ni membresías privilegiadas. Revocar CONNECT/TEMP de PUBLIC en las bases de aplicación y en postgres/template1; conceder acceso solo al dueño correspondiente. Probar conexión propia y rechazo de conexión a la base ajena y a postgres con ambas identidades. No borrar bases o volúmenes para repetir verificaciones.
- Variables de entorno y .env.example versionados. Generar secretos locales aleatorios mediante un script que no los imprima ni sobrescriba archivos existentes; .env reales ignorados. Cada servicio recibe únicamente su configuración de conexión. Validar configuración faltante sin mostrar sus valores. No ejecutar docker compose config sin quiet ni imprimir Config.Env, URLs con contraseña o .env.
- Operaciones usa Flyway con migración SQL V1; Empleados usa migraciones TypeORM, synchronize=false y comando explícito de migración. La migración inicial establece el schema propio del servicio y deja historial versionado; no crea tablas de empleados, órdenes ni otras funciones futuras. Comprobar las tablas de historial con su propio usuario y que repetir la migración no aplica versiones nuevas.

### Estructura y arquitectura proporcional

- Separar casos técnicos de disponibilidad y sus puertos, adaptadores de base y adaptadores HTTP/Actuator. Los casos/puertos no importan Spring, Nest, JDBC, TypeORM ni HTTP. La composición y configuración residen en infraestructura.
- No hay dominio de negocio implementado todavía: no crear entidades falsas ni carpetas de dominio/casos de uso vacías para aparentar DDD. Documentar que el primer CU introducirá sus agregados/reglas independientes del framework, mientras los adaptadores y ORM permanecerán en el servicio propietario. La salud es una capacidad técnica, no CU01 ni modelo del taller.
- No compartir modelos ORM, acceder a bases de otros servicios ni agregar endpoints de negocio, autenticación o GraphQL en esta entrega.

### Procesos y salud

- Operaciones escucha en **127.0.0.1:8081** y Empleados en **127.0.0.1:3002**, comprobados libres. Permitir puertos configurables; no detener procesos ajenos si una reserva cambia.
- Operaciones: `/actuator/health/liveness` indica proceso vivo; `/actuator/health/readiness` incluye un indicador PostgreSQL real además del estado de aplicación. Empleados: `/health/live` y `/health/ready`, respectivamente.
- Readiness ejecuta una comprobación de conexión/consulta contra la base propia, con timeout acotado. HTTP200 y cuerpo de estado UP cuando está disponible; HTTP503 y estado DOWN cuando falla. No devolver éxito fijo ni considerar solo que un objeto cliente exista. Liveness permanece HTTP200 durante la caída de PostgreSQL. No exponer contraseñas, parámetros SQL, stack traces, host/usuario de la base ni detalles de errores en respuestas.
- Pool/cliente debe tolerar desconexión y reconectar sin reiniciar el servicio; cerrar recursos al terminar. Spring podrá exigir PostgreSQL al arrancar para aplicar Flyway; probar caída una vez ambos servicios estén listos.

### Verificación y evidencia

- Compilar y ejecutar pruebas de ambos servicios y registrar comandos/códigos de salida reales. Las pruebas unitarias no sustituyen la integración con PostgreSQL.
- Arrancar el Compose propio, migrar, ejecutar ambos servicios y probar HTTP, historial y aislamiento de usuarios con conexiones reales.
- Detener únicamente el PostgreSQL de este Compose: ambos readiness deben pasar a 503 y liveness permanecer en 200, con los mismos procesos vivos. Restaurar en finally y comprobar recuperación de readiness a 200 sin reiniciar aplicaciones. Mantener las demás cargas Docker intactas.
- Verificar que el Shell y ambos MFs ya ejecutándose en la raíz siguen respondiendo y navegando; no reinstalar ni cambiar sus dependencias. Baseline de inspección: 4200/4201/4202 respondieron HTTP200.
- Concluir verificaciones antes de despachar un revisor independiente. No ejecutar pruebas pesadas en paralelo con revisión; detener los procesos backend propios si es necesario y no tocar procesos ajenos. La revisión separa cumplimiento, corrección y consistencia. Corregir críticos y re-verificar.
- README por servicio e infraestructura con comandos de configurar, instalar, migrar, ejecutar y verificar; decisión backend 004, STATUS diferenciado de CU pendientes. No marcar entregado sin evidencia real. Finalizar el documento y commits locales revisados; no hacer push ni merge automático.

### Fuentes consultadas

- https://start.spring.io/metadata/client y vista previa oficial pom.xml (HTTP200, parent4.1.2/java21).
- https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-starter-parent/maven-metadata.xml (4.1.2 estable; RC excluida).
- https://docs.spring.io/spring-boot/4.1/reference/actuator/endpoints.html y documentación oficial v4.1.0 contrastada con Context7: readiness no añade automáticamente indicadores externos.
- https://docs.nestjs.com/cli/usages y https://docs.nestjs.com/techniques/database .
- Metadatos reales npm de @nestjs/cli, @nestjs/core, @nestjs/typeorm, typeorm y pg.
- https://www.postgresql.org/support/versioning/ (17.11 vigente) y manifest Docker oficial postgres:17.11-bookworm.

## [S3] Fuera de alcance

Keycloak/SSO, CU01, CRUD de empleados, clientes/órdenes/agenda, Saga CU15, BFF GraphQL, Finanzas, Inteligencia, Sincronización, MCP, PWA/offline, despliegue externo y publicación en GitHub. No generar esos proyectos ni adoptar contratos funcionales nuevos.

## Tasks

- [x] T1: Generar y configurar MS01 con Wrapper, migración y salud — acceptance: raíz correcta, AGENTS preservado, build/pruebas unitarias pasan y adaptador SQL/indicador de readiness configurados sin éxito fijo (covers: S2).
- [x] T2: Generar y configurar MS02 con lockfile, migración y salud — acceptance: raíz correcta, Node22.22, AGENTS preservado, build/pruebas unitarias pasan y adaptador SQL/respuesta503 implementados sin éxito fijo (covers: S2).
- [x] T3: Preparar Compose, credenciales locales y aislamiento — acceptance: un servidor propio, dos bases/roles y conexiones ajenas rechazadas sin exponer secretos (covers: S2).
- [x] T4: Verificar integración, caída/recuperación y frontend — acceptance: migraciones/historial reales e idempotentes, comandos observados, readiness200→503→200 y liveness200 sin reinicio; Shell/MFs sin regresión (covers: S2; depends: T1,T2,T3).
- [x] T5: Revisar y cerrar documentación/commits locales — acceptance: revisión independiente con tres conclusiones, críticos resueltos, README/decisión004/STATUS/evidencia actualizados y documento entregado sin merge/push automático (covers: S2; depends: T4).
