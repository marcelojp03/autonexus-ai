# CU05 TEST harness — preparado, NO ejecutado

Actualización final de ejecución autorizada: BFF03 PASS; UI final h23 A/B+jefe PASS con10 capturas; consistency01 PASS; linked-pair/restauración exacta PASS por etapas (su corrida inicial FAIL de browser se conserva); globalpending02 PASS; dependency01 PASS con DIRECT restaurado; postcheck8/8 PASS. identity01 FAIL tras E/O403 correctos pero denegación GraphQL distinta de403 esperada; revocación pendiente y sin aceptación completa. Fuente BFF convierte BusinessError previo a execute en SERVICE_UNAVAILABLE503; exactas extensiones de la primera falla identity no se guardaron y no se inventan. Consolidado: output/cu05/t246-delivery.json y t246-execution-checkpoint.md. Las secciones históricas siguientes describen preparación, no sustituyen la evidencia final.

Solo preparación autorizada. Ningún archivo importa ejecutores CU15 con efectos laterales. Importar estos módulos o invocar verificadores sin --run no abre conexiones, navegador, listeners ni archivos privados. SQL de inyección TEST está preparado exclusivamente en injections.mjs y solo se ejecuta mediante entrypoint separado, --run y adapter main. No se incluye restart, gestión de procesos, migraciones ni cambios Docker. Main debe desplegar E/O/BFF/Shell y autorizar expresamente la ejecución primero CU05 real; Docker después.

## Configuración al ejecutar (por main, no realizada)

Variables obligatorias, sin endpoints ni rutas de máquina incrustados:

| Variable | Valor que debe aportar main |
| --- | --- |
| CU05_EMPLOYEES_URL / CU05_OPERATIONS_URL / CU05_FINANCE_URL | Base REST directa de cada propietario, sin slash final |
| CU05_GRAPHQL_URL | Endpoint GraphQL completo |
| CU05_SHELL_URL | Origen Shell |
| CU05_ISSUER | Issuer real del realm, incluyendo /realms/... |
| CU05_REDIRECT_URI / CU05_CLIENT_ID | Callback exacto y cliente público PKCE registrado |
| CU05_ADMIN_ACCOUNT_FILE | JSON privado existente: objeto username/password o array de test-accounts; solo lectura |
| CU05_UNLINKED_ACCOUNT_FILE | JSON privado existente: objeto o array; cuenta sin empleado pero con agenda:read:self; solo lectura |
| CU05_ADMIN_ACCOUNT_KEY / CU05_UNLINKED_ACCOUNT_KEY | Selección opcional en array; defaults administrador / mecanico. No se persisten copias privadas de estas cuentas |
| CU05_EMPLOYEES_CLIENT_FILE | JSON privado existente clientId/clientSecret del cliente de gestión E; solo RAM |
| CU05_COORDINATOR_CLIENT_FILE | Solo consistency/all: cliente técnico CU15 clientId/clientSecret; solo RAM |
| CU05_PLAYWRIGHT_MODULE | Solo browser/all: módulo Playwright ya instalado resoluble por createRequire; sin instalación automática |
| CU05_UI_TARGETS_FILE | Solo browser/all: output/cu05/ui-targets.json, confirmado por main tras entregas actores38–41; example permanece falso |
| CU05_RUNTIME_HOOKS_MODULE | Entry points dependency/injections: ruta al módulo main, cargado solo después de --run |

No pasar contraseñas/tokens por argv. No leer/imprimir .env, volcar objetos de sesión, HAR, tracing ni storageState. No editar infra/keycloak/.local/test-accounts.json ni credenciales existentes. Main puede preparar los archivos de selección privados bajo output/cu05 después de check-ignore; no se generan en esta preparación.

## Capas pendientes de orden de ejecución

Desde la raíz del worktree, con Node aprobado por main:

    node scripts/cu05/verify.mjs --run --layer=api
    node scripts/cu05/verify.mjs --run --layer=bff --fixture-file=output/cu05/<run-api>/private.json
    node scripts/cu05/verify.mjs --run --layer=browser --fixture-file=output/cu05/<run-api>/private.json
    node scripts/cu05/verify.mjs --run --layer=identity --fixture-file=output/cu05/<run-api>/private.json

consistency crea su juego aislado y prueba estados técnicos sin importar fixtures históricos:

    node scripts/cu05/verify.mjs --run --layer=consistency

--layer=all crea un juego y ejecuta API/BFF/consistency/browser/identity en ese orden; NO ejecuta caída ni reinicios. No usar all antes de confirmar UI. Para un supervisor Node, usar process.execPath, no otra ruta fija al binario. Cada corrida genera un directorio UUID nuevo, result.json, run.log y run.exit (0/1). Fallos anteriores se conservan. pass indica únicamente la capa elegida, nunca aceptación completa CU05. Fallos de preflight anteriores a crear directorio solo establecen exit=1 y mensaje fijo sin secretos.

private.json se crea exclusivamente con wx tras git check-ignore --no-index, modo 0600, y solo contiene cuentas **nuevas**, IDs/comandos sintéticos y referencias de su corrida. No contiene JWT ni credenciales administrativas/técnicas. En Windows la ACL del directorio también debe ser privada. No reemplazar privados previos. Los fixture-file se leen sin escritura: una corrida de identidad cambia solo sus empleados dedicados; no se repite como si fuera read-only.

## Fixtures reales, no Demo

- CU03 crea A/B, CHIEF, NOPERM, INACTIVE y REVOKED con access.requested=true. Espera access.status=synced y subject presente. Solo entonces fija credencial aleatoria para ese subject recién creado mediante cliente E en RAM. Username sigue el patrón local employee-ID. Roles reales por CU02, sin tocar catálogo global ni permisos de roles compartidos. A/B/CHIEF deben tener tres subjects distintos. Caché en RAM por subject/identidad, nunca tokenFor(mecanico) compartido.
- A/B reciben turno del weekday futuro 22:00–23:59 por CU04. Flujo basado en createFlow(employee,slot) de scripts/cu15/fixtures.mjs: cliente, vehículo, servicio de 30 min, recepción, orden y aprobación reales por APIs propietarias. Inicia POST /orders/:id/confirmations y consulta GET /confirmations/:sagaId hasta terminal confirmed. No INSERT ni atajos para fabricar trabajos.
- Ambos trabajos son 23:00–23:30 -04:00 en la misma fecha futura de La Paz: cambia el día UTC, no la medianoche local. Prioridades alta/normal permiten probar filtro. Browser usa Pacific/Auckland y compara la fecha/hora formateada con America/La_Paz, no solo la etiqueta de zona.
- Un rechazo F controlado usa cotización pendiente **propia**, prueba reserva E aplicada y autorización F rechazada, y espera Saga rejected. No borra cotizaciones, decisiones ni historia. No es una repetición de la matriz Saga.
- INACTIVE y REVOKED no tienen asignaciones. Desactivar no libera/invalida reservas. Conservar JWT previo y realizar solicitudes nuevas de contexto E/O/BFF; para revocación probar además JWT recién emitido. No exigir nuevo login de la cuenta ya inactiva: IdP puede deshabilitarla.

## Consistencia y limpieza

consistency.mjs crea una orden propia sin iniciar Saga O y un sagaId técnico propio E. Solo APIs CU15 reserve → confirm → release, comandos persistidos antes de enviar y expectedVersion real. Comprueba los estados reserved y confirmed-local sin prueba global mediante GET técnico y check humano E; ambos quedan fuera de lista/detalle REST/BFF. finally vuelve a consultar recurso real y libera únicamente ese sagaId, con operación estable y replay idempotente; released también queda fuera. Es evidencia de participantes **sin Saga global**, NO de una intercalación O confirmation_pending. No se invoca release sobre las Sagas globales confirmadas de A/B.

Se preservan cuentas/empleados/órdenes/cotizaciones/historia sintéticos. No limpieza SQL ni revocación de permisos globales. Los trabajos confirmados permanecen hasta que exista una transición de negocio autorizada. Si un inicio de Saga queda incierto o no terminal, la corrida falla y conserva command/operationId/sagaId: main debe conciliar la misma intención, no repetir creando otra orden ni borrar registros. Si falla release, private.json conserva comandos para recuperar el mismo recurso propio.

## Error propietario: adapter pendiente de main, no reinicio automático

employees-proxy.mjs exporta createEmployeesProxy y withOwnedEmployeesFailure, ambos inertes hasta llamada explícita. Proxy escucha únicamente loopback con puerto efímero, falla **solo** /agenda/assignments/check cuando está armado, marca INJECTED y reenvía el resto (incluyendo permisos/contexto/CU15) al E real sin imprimir bearer. No falsifica BFF200 ni estado SQL. dependency.mjs comprueba baseline real con un trabajo, O503 AGENDA_DEPENDENCY_UNAVAILABLE, GraphQL sin datos con ese código/statusCode503 y recuperación del mismo assignmentId; call counts solo acreditan llegada a la inyección, no aprobación funcional.

Main debe suministrar hooks verifyOwnership, switchToProxy(url), restoreDirect(url), verifyDirect(url). verifyOwnership debe contrastar metadata de runtime, CIM con JAR esperado y PID/listener, preservando flags/backup DIRECT de CU15. verifyOwnership y verifyDirect deben devolver true como prueba positiva. Ningún hook de procesos está implementado aquí ni se llama desde verify.mjs. withOwnedEmployeesFailure restaura DIRECT y verifica en finally antes de cerrar proxy. Si restoreDirect/verifyDirect falla, **no cierra el proxy**: lo deja desarmado reenviando E sano y lanza CU05_DIRECT_RESTORE_FAILED_PROXY_RETAINED_FORWARDING con referencia proxy/proxyUrl. El entrypoint conserva PID/URL en result.json; el proceso sigue vivo para proteger el runtime. Main debe restaurar/verificar DIRECT antes de finalizar ese runner. También acepta un browserProbe de main que compruebe error distinto de vacío y trabajo restaurado usando targets definitivos. No simular éxito vacío.

## Entry points de integración separados — preparados, no ejecutados

### Reanudación focalizada de identidad tras el defecto BFF

identity-fixtures.mjs exporta createIdentityFixture: un empleado propio por llamada, acceso CU03 sincronizado, credencial únicamente de esa cuenta nueva, rol CU02 sincronizado y JWT en RAM por subject. No crea clientes/órdenes/Sagas ni trabajos. identity-resume.mjs conserva referencias de A/B/jefe/noPerm/jobs originales y reemplaza solo INACTIVE/REVOKED en modo green.

Rojo autorizado y reproducido: t246-identity-red-02.exit=1, run28645ba7-b147-4936-abed-ec466a9d73bd. Creó un único control REDINACTIVE nuevo, obtuvo JWT antes de desactivar y realizó la primera consulta BFF solo después de inactivación (cache MISS). Resultado exacto GraphQL HTTP200/sin datos/SERVICE_UNAVAILABLE503 frente a E/O403 AGENDA_ACCESS_DENIED. pass=false y redReproduced=true: es evidencia de FAIL productivo, no aprobación. Se conserva el control inactivo y privados; ningún token se guardó.

    node output/cu05/run-supervised.mjs t246-identity-red-02 output/cu05/t246-run-identity-resume.mjs --run --mode=red --fixture-file=output/cu05/b4a86176-612c-4372-9f93-ada0ecf95372/private.json

Runner verde listo pero **NO autorizado/NO ejecutado aún**, hasta que main confirme despliegue BFF corregido:

    node output/cu05/run-supervised.mjs t246-identity-green-01 output/cu05/t246-run-identity-resume.mjs --run --mode=green --fixture-file=output/cu05/b4a86176-612c-4372-9f93-ada0ecf95372/private.json

Green crea exactamente dos controles propios aislados (INACTIVE/mecanico y REVOKED/jefe_taller), sin recrear cohorte de seis ni jobs. Prueba inactivación y revocación mediante identityMutations existente, con JWT anterior y JWT nuevo tras revocación, solicitudes nuevas E/O/BFF y403 exacto. No reactiva controles históricos ni modifica contraseñas/roles globales. El launcher auxiliar lee solo referencias de operator-config y no cambia whitelist de main.

    node scripts/cu05/verify-dependency.mjs --run --fixture-file=output/cu05/<run-api>/private.json
    node scripts/cu05/verify-injections.mjs --run --scenario=global-pending
    node scripts/cu05/verify-injections.mjs --run --scenario=subject-drift

CU05_RUNTIME_HOOKS_MODULE debe exportar createHooks({config,session,store,report,stage}). El objeto devuelto aporta verifyOwnership y, para dependencia, switchToProxy/restoreDirect/verifyDirect; para inyecciones aporta ownerDatabase(owner), que entrega un cliente pg ya conectado, dedicado al harness, con query/rows/rowCount/end. No retornar pools compartidos ni conexiones ajenas. Hooks o módulo también debe proporcionar browserProbe({expected,fixture,account?}) real. dependency llama expected=dependency-error-not-empty y work-restored. injections llama prepare antes de armar retraso, notification-pending y notification-observed. Main debe preautenticar ese navegador en prepare para obtener evidencia del aviso dentro de la ventana de 60 segundos; no usar callback vacío. Los entrypoints crean report/log/exit propios e inertes al importar. integration-entry conserva hooks fuera de try y llama await hooks?.close?.() en finally, incluso ante un fallo API previo al último callback. Un fallo de close se registra FAIL/exit1; no elimina la protección de proxy retenido. createHooks/close de main debe cerrar únicamente sus recursos browser, no el proxy protector.

injections prepara turno del día f.date+1 por API y nueva orden CU15 propia a 23:00, sin contaminar conteos A/B del día base. Adquiere solo advisory lock E cu15-order:<orderId>, inicia CU15 real, comprueba O confirmation_pending y ausencia REST/BFF. Antes de liberar lock crea función/trigger con nombre UUID propio sobre O Outbox: BEFORE INSERT condicionado exclusivamente por sagaId y event_type=operations.order.confirmed.v1; cambia únicamente next_attempt_at a +60s. Después de liberar E espera confirmed real, comprueba E confirmed/flag=false y agenda confirmationObservation=pending con aviso browser. finally elimina solo su trigger/función y vuelve vencido únicamente su evento pendiente. Luego espera publisher real, Inbox y notificación únicos, flag=true y aviso observado. No escribe estados de orden/Saga/asignación, payload ni versiones. Lock y objetos DDL propios quedan registrados para recuperación; DDL usa lock_timeout 2s y falla antes de bloquear indefinidamente un despliegue.

**Subject drift compatible con CHECK:** employee_subject exige subject IS NOT DISTINCT FROM record.access.subject (migración E1793023200000). Main aprobó explícitamente linked-pair SOLO TEST propio DRIFT; output/cu05/runtime-control.mjs declara hooks.subjectDriftMode='linked-pair'. No se elimina/deshabilita CHECK. Se cambian atómicamente solo columna subject y record.access.subject del empleado recién creado, bajo CAS id/document/old-subject/version explícita y record exacto; se conservan versión/credenciales/asignaciones de rol, se prueba JWT anterior denegado y se restauran ambos campos por CAS en finally. Comprueba registro completo y roles idénticos al baseline y contexto restaurado. Es INYECTADO, no una operación de negocio legítima ni un nuevo usuario IdP. El gate linked-pair se conserva para impedir habilitarlo accidentalmente mediante otro adapter; autorización de ejecución sigue pendiente.

## Diagnóstico de preparación y baseline pendiente

- Main aprobó linked-pair y confirmó selectores/contratos. Revisión fuente del adapter output/cu05/runtime-control.mjs: createHooks expone ownerDatabase/browserProbe/close; verifyOwnership usa stop-owned.ps1 **-VerifyOnly** antes de readiness y no invoca stopOwned. No se importó ni llamó ese módulo.
- output/cu05/browser-hook.mjs llegó durante la revisión final: createBrowserProbe y sus paquetes prepare/notification-pending/notification-observed/dependency-error-not-empty/work-restored coinciden con el entrypoint; close es idempotente por promesa compartida. Browser-hook y runtime-control pasaron node --check sin importarlos. No iniciar entrypoints hasta autorización explícita --run.
- Endpoints siguen exclusivamente por entorno en runtime.config; GraphQL espera endpoint completo. Arrays privados seleccionan key sin copiar cuentas administrativas. IDs de probes proceden de respuestas propietarias reales y fixture JSON sintético; no IDs inventados para aprobar positivos (UUID aleatorio solo caso negativo/inyección explícita).
- Baselines API/BFF/browser, casos de dependencia, global-pending/Inbox y linked-pair están **NO EJECUTADOS**. Node --check valida sintaxis JavaScript, no SQL ni comportamiento distribuido. No hay PASS real atribuible al rollout01 ni a pruebas históricas.

## Contratos/targets que main debe confirmar antes de correr

1. Main confirmó rutas/selectores de actor41 y generó autorización de manifiesto operador: output/cu05/ui-targets.json tiene **confirmedByMain=true**. ui-targets.example.json conserva false y se rechaza en ejecución. No es evidencia browser; solo aprobación estática. El harness no añade IDs al frontend. Consultar apunta solo al formulario de fechas para evitar ambigüedad con Buscar personal.
2. BFF observado normaliza 403 a FORBIDDEN/statusCode403 y validación SDL a BAD_REQUEST/statusCode400 (GraphQL200), no GRAPHQL_VALIDATION_FAILED. Owner usa AGENDA_ACCESS_DENIED, AGENDA_WORK_NOT_FOUND, VALIDATION_ERROR, AGENDA_DEPENDENCY_UNAVAILABLE, AGENDA_STATE_UNAVAILABLE y PERSISTENCE_UNAVAILABLE exactos. No relajar aserciones a cualquier 4xx/503.
3. Confirmar formato Saga steps.command/outcome y respuesta técnica assignment.id con propietarios; se siguieron los verificadores CU15 existentes. Si difieren, corregir harness contra contrato, no fabricante de datos.
4. Las inyecciones global-pending/Inbox y alternativa de subject están ahora preparadas en entrypoint separado, pero no ejecutadas: requieren adapter main, browserProbe real y aprobación linked-pair para subject. No se atribuye evidencia de esos escenarios a participant-only ni PASS históricos. Browser prepara cambio A→B en el mismo contexto y búsqueda del marcador para alcanzar el selector de empleado sin depender de su página inicial.

## Verificación realizada durante preparación

Solo revisión estática y node --check de los módulos. No API, SQL, navegador, listener, test pesado, proceso runtime, reinicio, commit ni modificación de aplicaciones/contratos/docs/secretos. El navegador no se ejercitó. Esperar orden de main execute.
