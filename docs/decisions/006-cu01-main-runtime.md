# 006 — Runtime local de CU01 en la raíz principal

Fecha: 2026-10-26. Decisión autorizada por Marcelo al pedir integrar CU01 y continuar CU03 sin push.

La inspección inicial encontró main y feat/cu01-keycloak en b8d807995ccbef66fdfa61bcb238a57affd8beaf, sin divergencia. No se repite ni se atribuye un fast-forward a esta tarea. b8d8079 tiene padre directo 86d81af y solo cambia documentación; el rango de código revisado sigue siendo 1963ce3..86d81af. Se preservan las ramas y los worktrees históricos.

## Ubicaciones

Todas las rutas siguientes son relativas a la raíz principal autonexus-ai, no a un worktree:

| Componente | Directorio de ejecución/administración | Puerto |
| --- | --- | --- |
| PostgreSQL empresarial | infra/compose, proyecto autonexus-backend-dev | 127.0.0.1:55432 |
| Keycloak y PostgreSQL IdP | infra/keycloak, proyecto autonexus-keycloak-dev | 127.0.0.1:8180; SQL IdP sin publicación |
| Operaciones | services/operations, JAR target/operations-0.0.1-SNAPSHOT.jar | 8081 |
| Empleados CU01 | services/employees, dist/main.js | 3002 |
| Shell | web/shell, preview dist | 4200 |
| Empleados standalone OIDC | web/mf-employees, preview dist/ng-alain/browser | 4201 |
| Operaciones standalone OIDC | web/mf-operations, preview dist/ng-alain/browser | 4202 |
| Demo explícita opcional | web/mf-employees, preview dist/demo/browser | 4203 |

Los dos volúmenes existentes permanecen: autonexus-backend-dev_postgres-data y autonexus-keycloak-dev_idp-postgres-data. PostgreSQL empresarial ya pertenecía a raíz y no se trasladó. Los contenedores IdP se recrearon con el mismo proyecto/volumen para cambiar labels y bind de postgres-init.sh; no se ejecutó down -v ni se reinicializaron bases. Privados IdP transferidos a raíz con preservación de bytes, sin regenerar secretos; privados de servicios también comparados en memoria. No se publican sus valores.

## Ownership y recuperación

Compose de Windows emitió separadores escapados repetidos en labels; la comparación anterior rechazaba el directorio correcto. Se reprodujo con prueba roja y se normalizan únicamente separadores y mayúsculas/trailing slash. Sigue comparándose la ruta completa; un worktree diferente no se acepta. Se añade regresión para separadores dobles y rechazo de otra ubicación.

La ejecución auxiliar de traslado se interrumpió tras recrear el IdP y no retuvo el snapshot previo de IDs: no se acredita una nueva comparación automática antes/después de todos los IDs. Se verifican el volumen nombrado existente, configuración privada idéntica, ownership actual, salud y configuración/cuentas reales con manage.mjs verify. La evidencia funcional posterior usa esas credenciales conservadas.

Builds necesarios se ejecutaron en raíz, sin repetir suites completas: Operaciones package con skipTests; Empleados frozen/build; Angular OIDC/integrado y demo Empleados; Shell frozen/build y staging. Logs y códigos reales en output/cu01-main-integration. No usar esos builds como evidencia de nuevas suites de tests.

scripts/cu01/verify-main-runtime.mjs comprueba ownership, volúmenes, bytes privados, readiness SQL y 401 anónimo sin mutar. scripts/cu01/run-main-smoke.ps1 ejecuta el recorrido real existente y luego verifica aislamiento/migraciones PostgreSQL; los resultados deben consultarse al terminar, no inferirse del PID del launcher. STATUS registra el resultado observado.
