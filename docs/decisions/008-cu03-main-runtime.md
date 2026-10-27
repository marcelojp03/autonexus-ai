# 008 — CU03 en raíz principal y puerto único3002

Fecha2026-10-26. Integración local explícitamente autorizada por Marcelo; no publicar en GitHub. Usar raíz/main como workspace elegido, sin worktree adicional: operación mecánica sobre backend previamente revisado. Especificación existente S2.7, no nuevo diseño de negocio.

Se verificaron ancestros0/7, main89bc8e1 y featureefc2e1c; su padre281b9ee es código revisado y efc2e1c exclusivamente documental. Source se cambia a main en897873b antes de git merge --ff-only. No squash/reset/borrado de ramas/worktrees ni push.

## Runtime

Empleados usa127.0.0.1:3002 desde services/employees de raíz. El antiguo3003 era ejemplo manual de rama, no segunda autoridad permanente. Conservar ambos Compose en infra/compose e infra/keycloak de raíz y sus volúmenes existentes. No regenerar .env ni cliente técnico; no repetir inicializadores/provisión IdP para mover código.

start-main.ps1 comprueba root/main, artefacto, privados ignorados, ejecutable y entrypoint absoluto de instancias Empleados conocidas por worktree. Rechaza dueño3002 desconocido o Node3003 ambiguo antes de detener procesos. -Restart es explícito; sin él se conserva un único dueño de raíz y no se crea otro. Usa working directory de raíz/servicio, fija PORT3002 e inyecta ruta privada del cliente, cargando/restaurando entorno del proceso llamador sin imprimir valores. No modifica archivos privados ni otros servicios.

La compilación se hace antes de sustituir el proceso. La migración se ejecuta explícitamente por el propietario y en esta integración fue no-op. Verificación de consulta/modificación/historial/auth apunta al3002 vivo, no inicia otra aplicación para acreditar integración. Sintético creado queda inactivo con historia; no DELETE.

## Entrega y publicación

No hay BFF ejecutable ni UI empresarial integrada. Participante2 recibe OpenAPI, SDL propuesto y auth, manteniendo operationId/expectedVersion y estados de acceso. No credenciales administrativas en BFF ni REST empresarial directo en web. Cuenta sin roles/credencial habilitada no tiene acceso operativo; CU02 no está terminado.

Preparar primer push main-only tras auditoría de TODO historial y árbol final; no ejecutar push/dry-run/PR ni reescribir historia. Remoto vacío al leer no demuestra permiso de escritura. Auditoría de valores actuales y patrones no equivale a certificación universal de secretos desconocidos. CU04 queda preparado conforme a su documento, sin inventar políticas temporales ni asignaciones implementadas.
