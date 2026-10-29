# CU15 — preparación y verificación distribuida opt-in

**Estado: harness implementado; matriz real6 PASS7/7 acreditada, regresión/revisión/cierre pendientes.**
La delegación inicial preparó código sin ejecutar matriz ni navegador. Después el principal
ejecutó navegador, Finanzas, corridas parciales y la matriz final real6; la ausencia de ejecución en
aquella delegación no significa que las APIs no se hayan ejecutado. Sintaxis y pruebas
puras del proxy no acreditan integración. La prueba feliz de navegador es separada de
--browser-proof. No repetir los seis escenarios financieros aislados ya acreditados.

## Evidencia principal posterior y límites de esta consolidación

- Migraciones aplicadas: E1793455200000, F2026_10_28_000002 y O V7. Coordinador
  técnico y RabbitMQ provisionados por el principal, adaptadores reales habilitados.
- output/cu15/browser-real3.exit=0 y browser-real.json acreditan seis etapas reales:
  inelegibilidad; habilitación laboral explícita persistida sin roles/identidad automáticos;
  inicio versionado sin éxito prematuro; confirmación tras recarga sin nuevos efectos;
  referencias de tres propietarios y Outbox/Inbox; desktop/mobile, consola limpia y
  tokens solo en RAM. No se usa este recorrido como prueba de toda la matriz de fallos.
- output/cu15/finance-real2.exit=0 y finance-real.json acreditan seis etapas reales:
  frontera técnica/humana, vínculo versionado/ledger, replay/conflicto sin evento extra,
  cancelación conservadora/terminal, exclusión SQL concurrente con barrera de prueba
  declarada y publisher confirms/published_at en RabbitMQ. Detalle en services/finance/README.md.
- El defecto JDBC lockOperation encontrado en el primer navegador fue corregido con
  SELECT true AS locked FROM pg_advisory_xact_lock(...). output/cu15/ops-lock-red
  (.exit=1) y ops-lock-green (.exit=0) registran la regresión focalizada;
  operations-rebuild-lockfix.exit=0 acredita package aplicado por el principal.
- Las corridas distributed-real1 y distributed-real3 acreditan las primeras tres etapas:
  concurrencia por orden/replay, una ocupación por empleado/franja y rechazo F tras
  reserva con E released. Ambas terminaron en fallo en aserciones de navegador, no en
  PASS global. matrix3 también sufrió caída espontánea RabbitMQ exit137, OOMKilled=false;
  no fue una inyección del proxy. El principal recuperó el contenedor propio healthy.

La matriz posterior real6 quedó acreditada: output/cu15/distributed-real6.exit=0 y distributed-2026-10-29T00-21-30-311Z-0749409d.json PASS7/7. Cubre carreras por orden/franja, rechazo F con release E, respuesta perdida tras commit F sin compensar el éxito, reinicio del coordinador con IDs/cuerpos durables e identidad técnica, compensación inicialmente pendiente que termina cancel F→release E y retransmisión del mismo eventId con un Inbox/notificación. Ambos browser-proof (recovery_pending y compensation_pending) terminaron PASS con issues=[] y failed=[]. final-check6.json registra restauración DIRECT, readiness200 y flag sintético restaurado. La última corrida no tuvo caídas inesperadas. Esto no convierte las corridas fallidas anteriores en PASS. Regresión proporcional, revisión y cierre permanecen pendientes; no se declara CU15 completo ni revisión independiente.

Esta edición documental no ejecuta pruebas ni interviene en runtime. [STATUS](../../docs/context/STATUS.md) y la [especificación](../../docs/compose/spec/cu15-confirmation-saga.md)
son los puntos de consolidación final. Políticas aceptadas: [decisión 016](../../docs/decisions/016-cu15-confirmation-saga.md).
No se reivindica revisión independiente.

Pruebas locales declaradas en las entregas iniciales: E144 unitarias + 11 HTTP sintéticas,
F24 pruebas/113 aserciones, O111 (la regresión JDBC posterior se registra aparte),
BFF54 unitarias + 15 HTTP y web32 focalizadas. No son integración real ni se presentan
como reejecutadas durante esta consolidación. Los README de servicio conservan comandos,
logs y límites de sus rondas iniciales.

## Alcance y seguridad

- Ejecutar desde este worktree, rama reutilizable work/marcelo, con **Node 22.22.3**.
- Prerrequisitos reales ya preparados por el principal: migraciones E1793455200000,
  F000002 y O V7; E3002, BFF3004, Finanzas8000, O8081, Shell4200,
  Keycloak8180 y RabbitMQ5672/15672 del entorno local autorizado.
- No empaqueta JAR, migra, crea ramas/worktrees, usa Docker, purga colas, borra historia,
  detiene participantes/BFF/PHP/broker ni modifica aplicaciones/contratos.
- SQL de diagnóstico usa conexiones propietarias separadas con ownerDatabase().
  Es código de aceptación, no una dependencia cross-database de las aplicaciones.
- Credenciales solo mediante helpers existentes en RAM. No mostrar archivos privados,
  persistir JWT, storageState, HAR, trazas con login, headers ni respuestas OAuth.
  Cache por rol, renovación con menos de 20 s de vigencia y login simultáneo deduplicado;
  cada nueva petición consulta la caducidad, incluso después de esperas mayores de 65 s.
- Todos los fallos, barreras y cambios SQL se etiquetan INYECTADO. No se fabrican
  outcomes applied/rejected ni se intercepta la UI para simular un resultado.

## Interfaz para el agente principal: fixtures.mjs

    import { createFlow } from './scripts/cu15/fixtures.mjs';
    const flow = await createFlow({
      prefix: 'happyUI',
      mechanicEnabled: false,
      quoteApproved: true,
    });

createFlow(options = {}) es async y **sí escribe datos sintéticos al invocarlo**.
Importarlo no invoca APIs ni abre bases. Opciones:

| Opción | Default / semántica |
| --- | --- |
| prefix | CU15; etiqueta saneada/corta, sufijo UUID de 8 caracteres |
| mechanicEnabled | true; false permite que el principal habilite la ficha desde UI |
| quoteApproved | true; false conserva una cotización genuinamente pending |
| employee | Objeto real con id; se relee por API y NO crea otro turno |
| slot | {date, startsAt, endsAt}; fecha civil YYYY-MM-DD y timestamps ISO con offset |

Retorno:

    {marker, customer, vehicle, service, reception, order, quote, employee,
     date, startsAt, endsAt, requiredSpecialty, command}

Los objetos retornados son respuestas reales de las APIs, nunca entidades inventadas.
command contiene exactamente operationId, expectedVersion, quoteId, quoteVersion,
employeeId, employeeVersion, requiredSpecialty, startsAt y endsAt.
Si la ficha cambia en la UI, usar la nueva employeeVersion al iniciar desde la UI;
el comando entregado describe la versión al crear el fixture, no una autorización futura.

Creación por REST administrador: cliente → vehículo → catálogo → recepción → orden →
cotización → aprobación opcional → empleado → turno. Documentos de clientes alfanuméricos
de 12 caracteres; placas de 10; documentos de empleados menores de 40; correos
example.invalid; referencias devueltas por API, basadas en UUID.
Fecha default: hoy La Paz + 7 días; intervalo 10–11; jornada ISO weekday 09–18,
descanso 12–13. El empleado suministrado debe tener ya jornada para la fecha elegida.
No se borran fixtures ni cotizaciones/aprobaciones al terminar.

También exporta api(owner, path, method?, body?, role?) y tokenFor(role?) para peticiones
locales con renovación en RAM. Owners cerrados operations/employees/finance/bff;
rol default administrador; technical es el cliente coordinador, no un rol humano.

## Interfaz del proxy: fault-proxy.mjs

    import { createFaultProxy } from './scripts/cu15/fault-proxy.mjs';
    const p = await createFaultProxy('finance'); // o employees
    const ruleId = p.arm({sagaId, action: 'authorize', mode: 'drop-after-commit', times: 1});
    p.arm({operationId, action: 'ledger'});
    p.disarm(ruleId); // sin argumento, desarma todas
    const counters = p.snapshot();
    await p.close();

Dos servidores HTTP Node, loopback con puerto efímero 0. Destinos fijos reales E3002/F8000;
url devuelve el endpoint elegido. Forward de headers/body reales solo en RAM, sin logs.
Reglas limitadas a sagaId o operationId UUID y acciones reserve/confirm/release/authorize/
cancel/ledger. Para ledger puede usarse el operationId explícito o la asociación Saga
observada en un POST anterior. Otras Sagas/operaciones no se afectan.

- before-503 (default): HTTP503 antes de enviar; nunca un rechazo durable ficticio.
- drop-after-commit: envía realmente, comprueba envelope HTTP200 applied con Saga,
  operación y committedAt coincidentes y destruye el socket de respuesta; no inventa commit.
- times default Infinity; hits, remaining y contadores globales saneados en snapshot().
  Las reglas se evalúan en orden de armado. Una regla consumida no bloquea la siguiente.

## Comandos de comprobación aislada (sin owners reales)

PowerShell, desde la raíz del worktree:

    $node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
    & $node --check scripts/cu15/fixtures.mjs
    & $node --check scripts/cu15/fault-proxy.mjs
    & $node --check scripts/cu15/distributed-real.mjs
    & $node scripts/cu15/fault-proxy.mjs --self-test

El self-test crea únicamente servidores HTTP sintéticos en puertos efímeros loopback;
verifica forward/header, 503 previo, corte tras envelope aplicado, ledger bloqueado,
aislamiento de reglas y desarmado. No llama APIs propietarias/DB/Docker/Keycloak.

## Matriz real — ejecución exclusiva del principal, no lanzar otra corrida en paralelo

Requiere autorización de ejecución en el momento apropiado, acceso exclusivo al
coordinador propio y terminar primero builds/verificaciones del principal.
No hay auto-run por importación ni al ejecutar el archivo sin --run.

    & $node scripts/cu15/distributed-real.mjs --run --max-minutes=20
    & $node scripts/cu15/distributed-real.mjs --run --browser-proof --max-minutes=20

Para no mantener una llamada de herramienta bloqueada más de 60 s, usar el supervisor
local probado en real6, output/cu15/supervised-run.mjs. Es una **utilidad local ignorada**,
no un script versionado ni una dependencia instalada por el harness; comprobar que existe
antes de usarlo. El siguiente comando documenta la forma ya probada, con etiqueta nueva
para no sobrescribir evidencia; no ejecutarlo mientras haya otra corrida activa:

```powershell
$node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$label = 'distributed-real-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
& $node output/cu15/supervised-run.mjs $label scripts/cu15/distributed-real.mjs --run --browser-proof --max-minutes=20
```

Ejecutar desde la raíz del worktree, con output/cu15 existente. La utilidad rechaza
etiquetas cuyos .log/.exit ya existen y abre el log con creación exclusiva. Arranca el
supervisor con spawn({detached:true, windowsHide:true}), stdin ignorado, stdout/stderr
al log y unref(); ese supervisor arranca también el runner con detached:true y
windowsHide:true, stdin ignorado y salida heredada al log. Así ambos quedan desacoplados
de la consola Windows sin matar el runner al terminar la llamada inicial. No basta con
ocultar la ventana o desacoplar solo uno de los dos procesos.

El lanzamiento devuelve PID del supervisor; .pid.json registra supervisor/child/args y
.exit se escribe al terminar el runner. Esperar .exit y JSON final, no inferir éxito del
PID ni del retorno del launcher. real6 usó esta forma con etiqueta distributed-real6
y los argumentos --run --browser-proof --max-minutes=20.
No detener procesos bruscamente: SIGINT/SIGTERM solicitan limpieza controlada al siguiente
punto de espera. En Windows, Stop-Process no garantiza finally; preferir esperar el
presupuesto del runner.

Presupuesto default 20 min, configurable 5–30; es **cooperativo, no un hard kill**.
Espera por estado/readiness ≤90 s; liberación listener ≤15 s; lease del worker 30 s;
subprocesos ≤45 s (incluye CIM/ownership de Windows); HTTP del helper ≤20 s y SQL diagnóstico ≤8 s por consulta.
El presupuesto se comprueba entre operaciones y en polling; una creación de fixtures,
login o navegador en curso puede excederlo. Reservar hasta 5 min adicionales para
operación en curso y limpieza. Una restauración de transporte fallida deja proxies
healthy vivos deliberadamente y requiere intervención: se informa FAIL, nunca PASS.

### Escenarios implementados

1. Dos inicios concurrentes para una orden con operationId distintos; exactamente uno
   aceptado, conflicto del otro; replay idéntico conserva Saga; un cierre E/F/O.
2. Dos órdenes para el mismo empleado/franja: una confirmed, otra rejected durable
   de reserva; una sola ocupación reserved/confirmed.
3. Cotización pending genuina: E reserva, F rechaza durable, E released y O pending_quote;
   cotización e historia intactas, sin borrar decisiones para forzar el fallo.
4. Autorizar F hace commit real y se pierde la respuesta; bloquear ledger y siguientes
   POST mantiene recovery_pending visible. Quitar fallos concilia mismos IDs/cuerpos:
   un vínculo active, E confirmed, O confirmed, sin compensar el éxito.
5. E reserved/F503 antes de forward; reiniciar únicamente O propio. Conserva pasos/IDs/
   cuerpos; al desbloquear F continúa con initiatedBy original y executedBy cliente técnico;
   comprueba ausencia de JWT en Saga/pasos/historia/Outbox leídos.
6. F active, E confirm retenido: cambiar SOLO mechanicEnabled del empleado sintético
   identificado por UUID+documento+email. Es inyección SQL explícita porque la API de
   edición protege reservas. E devuelve rechazo real; F cancel503 conserva
   compensation_pending con F active/E reserved; luego cancelled/released/pending_quote.
   Restaura el flag original en finally, sin cambiar versión/cotización/aprobación.
7. Evento order.confirmed sintético ya publicado/notificado: reponer published_at,
   leases y next_attempt_at de UN eventId; publisher real reenvía mismo envelope/ID.
   Una barrera advisory de Inbox de ese eventId observa al consumidor real esperando;
   liberar y comprobar una fila Inbox/notificación y orderConfirmedObserved=true.

Las barreras breves employee:<UUID> permiten armar reglas después de conocer la Saga
sin que el worker adelante el paso; solo sobre empleados sintéticos de esta ejecución.
Todas las mutaciones se parametrizan y la historia se conserva.

### Ownership y limpieza

Para conectar proxies, el runner debe reiniciar O al inicio; vuelve a reiniciar O en
el caso 5 y lo restaura DIRECT E3002/F8000 al terminar. Antes de cada detención compara
output/cu15/operations.pid.json (no PID hardcodeado), netstat8081 y CIM: un único PID
listener, ejecutable Java21 esperado y ruta absoluta al JAR de ESTE workspace.
Un mismatch aborta; nunca mata un Java ajeno ni usa taskkill por nombre.
Relanza únicamente scripts/cu15/launch.mjs operations <Eurl> <Furl>, sin build/migración.
Si ya detuvo el proceso y falla launch, finally vuelve a intentar el lanzamiento directo.

Finally restaura flags/barreras, desarma fallos, captura diagnóstico por Saga, restaura
O directo y espera readiness ANTES de cerrar proxies. Si no puede restaurar, conserva
forwarding healthy, guarda error y requiere intervención explícita. No detener procesos
ajenos para sortear ownership ni arrancar un segundo listener.

### Browser proof opcional

Playwright Chromium mediante Node y dependencia local fijada del patrón T21, no
@playwright/test. Login real jefe_taller, deep-link al wizard existente por sagaId;
observa recovery_pending y compensation_pending, sin #confirmation-success, con
motivo/próxima recuperación/pasos y reservas provisionales reales. Solicita retry en
la misma Saga; admite conflicto de versión seguro y refresca. Retiene console errors,
pageerror y requestfailed; cierra navegador en finally y redacta queries OAuth.
No es evidencia del happy path de creación desde UI, ni de CU05/lectura humana.

### Salidas y interpretación

- output/cu15/distributed-<timestamp>-<suffix>.json: estado RUNNING/PASS/FAIL, etapas,
  IDs sintéticos, inyecciones, pasos/cuerpos/fingerprints, diagnóstico y contadores;
  original initiatedBy y executedBy cuando se verifica continuación. Sin JWT.
- output/playwright/cu15-<runId>-<estado>.png: solo con --browser-proof, después de login.
- stdout: progreso JSON por etapa y ruta final. Errores/timeout no cuentan como PASS.
- Exit code 1 ante fallo, incluido cleanup; la evidencia parcial se conserva.

La delegación inicial del harness no actualizó STATUS/decisiones ni declaró T7/T8
completos. Esta consolidación documental conserva esa separación histórica y tampoco
declara cierre: la matriz real6 ya está acreditada; el principal mantiene la evidencia de
regresión, revisión y cierre y cualquier defecto de producción en STATUS/especificación.
El harness no corrige la app.
