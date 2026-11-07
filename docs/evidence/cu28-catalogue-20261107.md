# CU28 — cuatro flujos restantes del catálogo

Base publicada `7baf72b`, rama `work/marcelo`, aceptación local 2026-11-07. Fuentes de alcance:
`docs/use-cases/CU28.md` y `docs/reference/07-automatizacion.md`. No es documentación ICONIX.

## Catálogo y frontera de aceptación

Orden finalizada era **1/5**, no 2/5. Solicitud de revisión es adicional y conserva su evidencia
en `cu28-20261106.md`. Esta continuación implementa asignación, cotización pendiente, cita y
resumen semanal. Se reutilizan receptor, secreto, canal JSONL y deduplicación ya verificados; no
se vuelve a contar la matriz de transporte como si fueran cuatro pruebas nuevas. Sin mensajes
externos ni nuevos recursos cloud. La cadencia de aceptación es cada 30 segundos, sobre copias
con sufijo `Proof`; el código y contratos son los de las exportaciones normales inactivas.

| Flujo | Disparador empresarial observado | Resultado y repetición | Recuperación pertinente |
| --- | --- | --- | --- |
| Asignación | Cotización aprobada y confirmación CU15 por APIs reales; Saga `c9ca25f4…` termina `confirmed` | Evento `d947a72f…`, orden `a104dba0…` v3; repetir el comando original conserva Saga y **1** registro en canal | La intención se confirma en la misma transacción que el cierre global; ninguna reserva/confirmación provisional inserta este tipo. El publicador existente conserva/reintenta la intención |
| Cita | Cita `682a8e46…` creada 13:54:44Z para mañana civil; sin activar manualmente su selector | Temporizador → evento `c2c21188…` → canal 13:55:03Z, **1** registro; activación repetida conserva ID | Otro aviso `9dffee91…` agota con canal caído y se reclama explícitamente por operador: mismo ID entregado 13:54:29Z. Cita cancelada `a178855c…`: aviso `a9749015…` suprimido, `CU28_APPOINTMENT_REMINDER_STALE`, sin entrega |
| Cotización | Finanzas selecciona `4228e157…` aún `pending` tras plazo; intención persistida 13:33:46Z | Evento `300f6090…`, entrega real 13:58:53Z; repetición del selector y reenvío del sobre al webhook → HTTP 200 duplicate, **1** fila/registro | Cotización nueva `6629a4d0…` envejece naturalmente de 2,65 s a 65,74 s. Con publicador detenido se persiste aviso `2c931062…`, luego se rechaza por API; al reanudar: `CU28_QUOTE_STALE`, `suppressed_at`, sin `delivered_at` ni registro de canal |
| Semana | Temporizador real solicita a CU26 semana anterior 2026-10-26→2026-11-01, America/La_Paz | Job `9b24525d…`, evento `a0280001-0000-8000-8000-202610260002`; **1** registro, sucesivas ejecuciones devuelven duplicate | Canal caído produce ejecuciones fallidas, sin entrega; al restaurarlo se entrega el mismo trabajo/período. Documento leído nuevamente con empleado autorizado = documento entregado, campo por campo |

La política normal de cotización es **24 horas**. Sólo para esta aceptación local se configuró
`CU28_PENDING_QUOTE_HOURS=0.016666666666666666` (60 s), con el reloj real de Finanzas: no se
retrocedieron fechas por SQL. La cita usa la próxima jornada civil `America/La_Paz`, horizonte
máximo configurable de 48 horas por defecto. Las APIs no aceptan una fecha de cliente como reloj.

Asignación usa versión de **orden**, no versión de ejecución ni de Empleados. Se corrigió también
la emisión futura de orden finalizada: usa la versión real de su agregado y conserva la versión
de ejecución en sus datos; los eventos históricos ya entregados no se reescriben.

## Documento semanal y procedencia

`scripts/cu28/verify-operations-delivery-local.mjs`: PASS 2026-11-07T14:05:58Z. La lectura
autorizada `GET /report/jobs/{jobId}` respondió `succeeded`; documento de CU26 idéntico al
`data` entregado (excluyendo sólo `operationId/jobId` añadidos por el sobre), **0** violaciones del
validador compartido. Tres claims, procedencia Operaciones `/agenda/team`,
`narrative.path=llm`, `generative=true`, modelo existente `qwen3.5:4b`. No se presenta el
reporte vacío de esa semana como evidencia de productividad, de finanzas ni de calidad general.
La exportación conserva igualmente la variante `deterministic/model=null/generative=false`;
regresión unitaria sobre la misma función embebida, sin nueva afirmación de fallback real semanal.

## Autorización programada

Empleado sintético `6789a1eb…`, sin administrador/jefe, cinco permisos efectivos:
`appointments:read`, `quotes:read`, `orders:read`, `agenda:read:team`, `executions:read:team`.
Cliente confidencial `autonexus-cu28-scheduler`, Code+PKCE; sin `client_credentials`. n8n guarda
la credencial cifrada en su volumen; eventos y trabajos no guardan tokens. Access token 60 s.
Empleados publica el vínculo laboral vigente del propio portador en `/security/permissions`;
los selectores reautorizan permiso y vínculo activo sin usar la caché genérica. El agente vuelve
a autorizar en Operaciones cada lectura y cada repetición de creación de un reporte guardado.

Prueba real S2.10 (`scripts/cu28/verify-scheduled-local.mjs`): antes de la intervención, los
tres workflows tenían ejecución `mode=trigger/status=success`. Se cerraron sólo las sesiones
de ese empleado en Keycloak a **14:17:35Z**; después de los 60 s de access token y tolerancia,
los tres temporizadores registraron **error** (14:20:00Z), sin nueva entrega semanal. Tras
Code+PKCE e importación de credencial/restablecimiento de n8n a 14:22:24Z, los tres registraron
**success** a **14:26:00Z**; mismo jobId, período y **1** registro semanal, contrato sin violaciones.
El primer chequeo posterior al reinicio fue anterior a una ejecución exitosa nueva y falló:
no se lo cuenta como PASS; el chequeo posterior usa las fechas de la ejecución real.
Se conservan sólo metadatos nativos de ejecución; `lastResult` no se supone durable al fallar.
No se promete autonomía indefinida por haber renovado un access token. Una autorización que
vence durante generación termina el trabajo; no se genera de nuevo ciegamente.
No se amplió la política idle/max-session del IdP: habilitar un cron normal no acredita que
la delegación vaya a sobrevivir hasta mañana o el lunes. El operador debe mantener/restablecer
una sesión válida, o el disparo posterior fallará cerrado como en la prueba, sin cuenta privilegiada.

Cierre de configuración, observado **14:44:00Z**: tres copias Proof con `active=0`, sin nuevas
ejecuciones desde 14:29:00/14:29:30/14:30:30Z respectivamente, por más de un intervalo de 30 s.
Se acredita la deshabilitación del temporizador, no una cancelación retroactiva de entregas.
Tres IDs normales con `active=1`, horarios diarios/horarios/semanales de las exportaciones.
Finanzas responde con política restaurada **24** horas. La importación de credencial por stdin
se comprobó exit 0; la copia temporal antigua del contenedor se retiró, sin borrar la credencial
cifrada, sesiones de otros usuarios, fixtures locales ni evidencia de canal.

## Verificación proporcional

| Comando / directorio | Resultado observado |
| --- | --- |
| Agente: Node 22.22.3 `node_modules/typescript/bin/tsc -p tsconfig.json`; `node --test tests/*.test.mjs` | build exit 0; **88/88** |
| Empleados: Vitest `run src/application/manage-security.spec.ts src/infrastructure/postgres/postgres-security-repository.spec.ts --maxWorkers=1`; `tsc --noEmit -p tsconfig.json` | **18/18**, tipos exit 0 |
| Operaciones: `mvnw.cmd -B --no-transfer-progress -Dtest=*Confirmation*Test,*RemindersTest,*ReminderControllerTest,*FinalizedEventTest,*PublisherTimeoutTest,*RequestedEventTest test`, JDK 21 | **58/58**, BUILD SUCCESS; incluye regresión orden v3 / ejecución v28 |
| Finanzas: PHP 8.4.26 `vendor/phpunit/phpunit/phpunit --filter Cu28PendingQuotesTest --debug` | **16/16**, exit 0 |
| Raíz: `node --test scripts/n8n/scheduled.test.mjs`; `node scripts/n8n/build-scheduled.mjs --check` | **10/10**, exportaciones iguales al constructor |
| APIs/Compose reales | imágenes construidas y desplegadas; V14 Operaciones y migración Outbox Finanzas aplicadas sobre PostgreSQL propietario existente |

Intentos anteriores no convertidos en PASS: Maven offline falló antes de ejecutar por repositorios
de caché; PHPUnit agotó 180 s sin resumen. El reintento Maven normal resolvió dependencias fijadas;
PHPUnit posterior terminó correctamente. Dos intentos de reutilizar una orden ya cotizada para
el fixture financiero devolvieron 500: se preservan como fallos de preparación no resueltos, no
como aceptación de cotizaciones múltiples por orden. El fixture final creó otra recepción/orden
por sus APIs. No se modifican ni reinicializan bases o volúmenes.

Artefactos locales ignorados: `output/cu28/catalogue/{fixture,operations-delivery,finance-proof,schedule-authorization}.json`,
observaciones sanitizadas y `output/cu27/{verify-*-fresh,cu28-operations-online,cu28-finance-debug}.*`.
No se versionan credenciales, cuerpos privados, modelos ni el canal de datos.

## Correcciones exigidas por revisión F1–F3

La revisión independiente del delta encontró tres bloqueos y detuvo la publicación. La prueba
semanal inicial recuperaba en la misma semana: no demostraba durabilidad tras fallo/reinicio y
cambio de período. No se usa esa evidencia como aprobación de recuperación intersemanal.

- F1: autorización completa del documento guardado: ambos permisos actuales en Empleados y
  cada assignmentId representado en Operaciones; GET y replay, incluido el resultado que se
  completa mientras la autorización inicial espera. Regresión HTTP: agenda permitida y ejecución
  revocada impide publicar datos guardados; restablecer conserva documento/job, sin regenerar.
  **Real PASS 16:23:53Z**: reporte poblado de noviembre, job 77f97e45…, 2 trabajos y 1 ejecución
  consultada con datos. Agenda 200; GET y replay 403 REPORT_ACCESS_DENIED al retirar sólo
  ejecución, usando JWT aún válido emitido antes de revocar. Originales cinco permisos restaurados;
  mismos hashes de documento/trabajos y mismo jobId, sin generación adicional. Evidencia
  output/cu28/catalogue/f1-split-scope-real.json. Una asignación visible sin ejecución se conserva
  con métricas null; se revalida agenda paginada, nunca se convierte un 403 en ausencia.
- F2: ledger durable propio del agente; intención y snapshot completo antes de envío, ACK tras
  recibo correcto, independiente de static data y del sweep de trabajos. Pruebas de filesystem
  y HTTP reconstruyen el servicio, eliminan/sweepen el trabajo normal y solicitan otra semana:
  recuperan documento e IDs originales antes de elegir el período nuevo. **Real PASS 16:39:53Z**:
  temporizador con período 19–25 de octubre falla su primer envío, conserva pending/documento;
  agente recreado y n8n reiniciado; el fixture propone 26 de octubre–1 de noviembre y recupera
  primero la entrega original. EventId a0280001-0000-8000-8000-202610190002, job ba4a609f…,
  documento/evento idénticos, 1 registro de canal, ACK delivered durable, 0 violaciones de contrato,
  2 claims y narrativa llm. Avance de candidato controlado, no calendario real adelantado.
  Evidencia output/cu28/catalogue/f2-next-week-real.json. Se preserva el primer ensayo cuyo
  observador venció durante el arranque; se reanudó desde la intención real, sin borrarla ni regenerar.
- F3: bloqueo cita → Outbox hasta terminar POST y registrar resultado; cancelación/reprogramación
  usa la misma fila del propietario y se serializa con el envío. Ocho regresiones de intercalado
  y fencing, 27 pruebas focalizadas pasadas; no se presentan como PostgreSQL concurrente real.
  Primer ensayo real: 1 espera de bloqueo observada, pero cancelación 500 por la incompatibilidad
  entre socketTimeout JDBC=2 s y el envío acotado que mantiene la fila. PostgreSQL tenía ambos
  timeouts en 0. Se restauró webhook y se comprobó cita aún scheduled; una cancelación normal
  posterior por API confirmó cancelled v2. No se cuenta ese ensayo como PASS. El presupuesto
  temporal usa ahora CU28_WEBHOOK_TIMEOUT_SECONDS + 5 s, sólo en cancelación/reprogramación;
  toma cita antes de slots y restaura la conexión al salir. Propiedades globales sin cambios.
  **Real PASS 17:26:32Z**: cita 4065611d…, 1 espera en PostgreSQL, cancelación bloqueada antes
  de liberar gate; webhook 202 a 17:24:44.267Z, delivered_at 17:24:44.5009Z, cancelación 200
  a 17:24:44.654Z, cancelled v2. Evento 091cd7b2… con 1 registro de canal, 1 intento, sin
  suppressed_at. Webhook original restaurado y Operaciones sano. Evidencia
  output/cu28/catalogue/f3-concurrency-real.json; fallo previo en f3-first-attempt.json.

Re-verificación final de código: agente **121/121** y build; Operaciones **87/87**, incluidos
13 casos de presupuesto/replay/orden de bloqueo y 8 del publicador; n8n **10/10** y exportaciones
iguales al constructor. Imágenes nuevas del agente y Operaciones construidas y ejercitadas.
Los 18 de Empleados y 16 de Finanzas no se repiten porque sus archivos no cambiaron en F1–F3.

Se conservan los resultados de la primera ronda como historia. La re-revisión independiente del
delta de 65 rutas sobre 7baf72b examinó las observaciones de los tres JSON reales y cerró F1–F3,
sin bloqueantes nuevos en especificación, corrección o consistencia. No repitió suites ya pasadas.
La única observación menor fue documental: Operaciones ignora las entradas extra del selector,
Finanzas las rechaza. Se aclaró el contrato sin cambiar código ni presentarlo como rechazo nuevo.

## Límites

No se repite la matriz completa lease/backoff/agotamiento para cada tipo cuando el transporte no
cambió; Finanzas sí prueba su publicador nuevo, incluida obsolescencia real. No se acredita
notificación externa, independencia de una sesión delegada, UI de administración de n8n,
despliegue cloud, todos los conflictos concurrentes ni calidad general del LLM. CU25/CU26 siguen
parciales por las brechas concretas de `cu25-cu26-acceptance-matrix.md`; la programación semanal
no es un requisito pendiente de generación CU26. Puntos del PLAN sin cambios por esta evidencia
hasta conciliar todos los requisitos y cerrar revisión.
