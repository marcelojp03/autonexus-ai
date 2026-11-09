---
feature: assistant-reports-events
status: in-progress
updated: 2026-11-08
source: work/marcelo
---

# CU25/CU26/CU28 — asistente con LLM, reporte narrativo y flujo por evento

## Report

Entrega local verificada sobre base 7baf72b y cierre de destinatarios sobre 24f76a9, work/marcelo,
2026-11-07. CU28 queda aceptado en su alcance local configurado; CU25/CU26 conservan sus
pendientes. La cobertura cambia sólo por CU28: 54/22/26 → 57/19/26, con evidencia y revisión.

**What was built** — asistente y reporte operativo en Compose, Ollama externo configurable,
trabajos persistentes sin tokens y Shell GraphQL; los cinco flujos originales de CU28 con
solicitud de revisión adicional. Asignación sólo al cierre global de Saga, selección/revalidación
propietaria de citas y cotizaciones, reporte semanal CU26 con ledger durable y ACK, permisos
actuales y registros reautorizados. La entrega se serializa con cambios de cita mediante bloqueo
y presupuesto de conexión temporal; salud/lecturas conservan sus límites globales.

**Verification** — agente 121/121 y TypeScript; Operaciones 87/87; Empleados 18/18 y tipos;
Finanzas 16/16; programación 10/10 y exportaciones iguales al constructor. Se observaron
los desencadenadores reales, repetición sin nuevo efecto, obsolescencia, autorización vencida,
revocación parcial y restauración. La prueba intersemanal avanzó el candidato en un fixture,
no el calendario: agente recreado, n8n reiniciado, mismos IDs/documento y un registro. La prueba
concurrente real observó espera PostgreSQL, entrega 202 y cancelación 200 posterior, con
configuración original restaurada. Evidencia y comandos en docs/evidence/cu28-catalogue-20261107.md;
los recorridos de Shell previos permanecen en cu25-cu26-shell-20261106.md.

Revisión independiente inicial exigió F1–F3; re-revisión del delta completo y de las pruebas reales
cerró los tres sin bloqueantes. La observación menor de entradas extra se resolvió aclarando
el comportamiento existente en el contrato: Finanzas rechaza, Operaciones ignora sin utilizarlas.
La matriz cu25-cu26-acceptance-matrix.md conserva pendientes concretos y no acredita calidad
general del modelo. Notificaciones externas, destinatarios y autonomía indefinida no se prometen.

## [S1] Problem

CU28 solo tiene un flujo manual: falta el recorrido disparado por un evento empresarial real,
con reentrega del mismo `eventId`, recuperación ante fallo y resultado persistido en un canal local.
CU25 tiene planificador determinista, pero no un LLM que interprete la pregunta; CU26 no existe.
Nada de esto está en la interfaz: hoy solo se ejecuta por consola.

## [S2] Design

### [S2.1] Evento real desde Outbox

CU17 (solicitud de revisión) publica `operations.execution.review.requested.v1` por el Outbox de
Operaciones en la misma transacción que el cambio de estado, con `eventId` estable, envelope
cerrado y reintentos con backoff (nunca en la transacción HTTP saliente). Un publicador entrega a
un webhook de n8n autenticado por secreto compartido local.

### [S2.2] Deduplicación y canal local

n8n deduplica por `eventId` y el **canal de prueba local** (`scripts/cu28/channel.mjs`, JSONL)
vuelve a deduplicar por `eventId` como segunda barrera. Si el canal está caído, el evento queda
pendiente en Outbox y se reintenta; al volver, se entrega **una** vez. Sin mensajes externos.

### [S2.3] Asistente con LLM real (Ollama)

`qwen3.5:4b` local vía `/api/chat` con tool-calling nativo. Límites: máximo de pasos (4), timeout
por llamada y total, catálogo cerrado de herramientas según el token del usuario. El LLM **no**
recibe permisos: elige herramientas del catálogo y las ejecuta el servidor. El resultado de una
herramienta entra como datos, nunca como instrucciones; una pasada de seguridad previa y la
validación del servidor cierran la vía de escalamiento.

### [S2.4] Reporte con cálculo separado (CU26)

Los totales y listas se calculan de forma determinista desde las herramientas; el LLM solo redacta
sobre esos números. El reporte conserva período, `generatedAt`, referencias a registros y
procedencia; no incluye cifras financieras inexistentes ni las inventa.

### [S2.5] Integración web

El BFF expone `assistantAnswer`, `operationsReport`, `startOperationsReport` y `operationsReportJob`
en GraphQL y reenvía el token del usuario al servicio del asistente, que usa ese mismo token contra
las APIs (sin acuñar identidades). La UI del microfrontend de Empleados ofrece ambas funciones con la
sesión del Shell.

### [S2.6] Generación asíncrona con identificador estable

El reporte tarda minutos, así que no se pide en una sola petición: el cliente genera un `operationId`,
`startOperationsReport` crea el trabajo y responde de inmediato, y la interfaz consulta
`operationsReportJob` con el `jobId` hasta que termina. Repetir la creación con el mismo `operationId`
devuelve el mismo trabajo; recargar la página retoma ese identificador en lugar de iniciar otra
generación. El documento terminado se persiste; el token del usuario nunca, así que un trabajo
interrumpido por un reinicio se cierra como `INTERRUPTED` y no se reanuda. Una autorización que vence
durante la generación termina en `AUTHORIZATION_EXPIRED` sin reiniciar la generación, y cada lectura
verifica token y pertenencia.

### [S2.7] Ejecución reproducible del asistente y sus trabajos

`integration/agent` deja de correr en el host: imagen propia en `infra/local/docker/agent.Dockerfile`
(Node 22.22.3 y pnpm 12.6.0 del repositorio, build TypeScript, runtime sin privilegios) y servicio
`agent` en `compose.yaml`, **sin puerto publicado**: el BFF lo alcanza por la red interna en
`http://agent:3099` y el proceso escucha en `0.0.0.0` dentro del contenedor (`AGENT_HOST`).

- Documentos y metadatos de trabajos en el volumen nombrado `agent-jobs` (`REPORT_JOBS_DIR`), con la
  retención ya definida. **Ningún token se escribe**, así que recrear el contenedor conserva los
  documentos terminados y convierte en `INTERRUPTED` los trabajos que estaban en curso.
- Ollama sigue siendo un proveedor **externo configurable**: `OLLAMA_URL` apunta al servicio del host
  (`http://host.docker.internal:11434` por omisión en Compose), se documenta esa conexión y no se
  descargan modelos nuevos. Un modelo ausente no rompe el servicio: el documento publica la plantilla
  rotulada `deterministic`.
- Aceptación: un reporte terminado se lee después de `--force-recreate` del contenedor, y un trabajo
  cortado por detener el contenedor se lee como `INTERRUPTED`.

### [S2.8] Catálogo de automatizaciones frente a lo implementado

La especificación enumera cinco flujos —recordatorio de cita o mantenimiento, aviso de orden finalizada,
notificación de asignación al mecánico, seguimiento de cotización pendiente y resumen semanal—. Lo
implementado originalmente era **otro** evento: `operations.execution.review.requested.v1`, la solicitud de
revisión de CU17. Se conserva como adicional, no como uno de los cinco. Base `7baf72b`: orden finalizada
era 1/5. La continuación S2.11 añade los otros cuatro y acredita sólo sus resultados observados en
`docs/evidence/cu28-catalogue-20261107.md`, sin reducir el alcance ni cerrar excepciones no ejercidas.

### [S2.9] Flujos pendientes por incrementos

Cada flujo reutiliza la cadena ya verificada (Outbox del propietario, publicador con lease/backoff,
webhook autenticado por secreto, deduplicación por `eventId` en n8n y canal local) y se entrega como
incremento propio con su evento, su migración y su verificación:

| Flujo | Disparador | Propietario del evento |
| --- | --- | --- |
| Orden finalizada | aprobación/finalización de CU17 | Operaciones |
| Asignación de mecánico | asignación confirmada de CU15 | Operaciones |
| Cotización pendiente | plazo sin respuesta | Finanzas |
| Recordatorio de cita | programación periódica | Operaciones (lectura) |
| Resumen semanal | programación periódica | agente de reportes (CU26) |

El resumen semanal **integra CU26**: pide el reporte del período al agente por su API autorizada y
publica el documento ya verificado, no una plantilla de n8n.

### [S2.10] Autorización de la programación

Los flujos programados necesitan una identidad que los propietarios acepten. Los contratos exigen
empleado activo vinculado, permiso vigente y registro autorizado, así que no se usa una cuenta técnica
privilegiada ni se salta la vinculación: se aprovisiona una **identidad de empleado sintética** con los
roles mínimos de lectura que cada flujo necesita, igual que las cuentas de verificación, y cada llamada
vuelve a autorizarse en el propietario. Si un flujo necesitara un alcance que un empleado no puede tener,
no se programa y se registra el motivo.

### [S2.11] Aceptación acotada de la continuación

Base publicada: `7baf72b`, worktree personal `work/marcelo` conservado. La continuación autorizada
por el usuario cubre los cuatro flujos originales pendientes, no nuevos CU. Orden finalizada cuenta
como 1/5 y solicitud de revisión como adicional. No cambian puntos por ejecutar un proveedor externo:
Ollama configurable forma parte del producto; programación semanal pertenece a CU28, no a CU26.

- Asignación: evento sólo con Saga CU15 globalmente concluida; reserva o confirmación local no bastan.
- Cotización: Finanzas selecciona pendientes vencidas y revalida estado/versión antes de publicar;
  una decisión o revisión invalida el aviso anterior de forma observable.
- Cita: programación en `America/La_Paz`, próxima jornada civil por defecto; el propietario decide
  estado vigente y suprime avisos obsoletos por cancelación o reprogramación.
- Semana: lunes 09:00 del taller, semana civil anterior lunes–domingo. CU26 genera mediante
  `operationId` estable por período; n8n consulta el mismo trabajo hasta terminar y envía período,
  procedencia, claims y `narrative.path` sin transformar plantilla en generación.
- Credenciales: sesión OAuth2 delegada de empleado sintético activo con permisos mínimos;
  refresh cifrado en credencial n8n, nunca en eventos/trabajos/logs. Vencimiento o revocación
  registra fallo y detiene publicación. Restablecer sesión reintenta las mismas claves, sin
  prometer autonomía más allá de la sesión delegada. No se usa client_credentials privilegiado.
- Prueba por flujo: desencadenador empresarial real, una entrega correlacionada por ID,
  repetición sin efecto nuevo y recuperación relevante. Programados: disparo real de temporizador
  (cadencia breve sólo en fixture), fallo de autorización y recuperación. Sin borrar registros.
- Evaluación CU25/CU26: selección de herramientas y exactitud frente a snapshots de APIs
  autorizadas, aclaración, permiso y fallo honesto con expectativas explícitas; el conjunto
  acotado no acredita calidad general ni funcionalidades financieras que no existen.

### [S2.12] Correcciones de revisión: autorización completa y entrega semanal durable

- Un documento guardado se reautoriza por todos sus datos representados, incluidas las
  ejecuciones por assignmentId. Agenda permitida no basta si se revocó ejecución. GET y replay
  de creación fallan cerrados sin publicar el documento al perder acceso a un registro/permiso.
- El agente conserva intención semanal y copia del documento terminado en su volumen propio,
  sin tokens, independiente del static data de n8n y de la retención normal de trabajos.
  `POST /report/weekly/deliveries` recibe from/to de la semana candidata, pero recupera primero
  una entrega pendiente anterior del mismo empleado. Devuelve período, IDs, jobId y documento
  durable cuando existe. Cada acceso se reautoriza. Documento/IDs quedan inmutables hasta ACK.
  `POST /report/weekly/deliveries/{operationId}/ack` exige eventId coincidente y recibo
  recorded|duplicate; sólo entonces marca entregado. n8n confirma ese recibo tras el webhook.
  Sin ACK, reiniciar y pasar a otra semana recupera el período/documento original antes de
  elegir uno nuevo. Un trabajo failed/interrupted no se reinicia automáticamente.
- La última decisión de vigencia de cita se serializa con cancelación/reprogramación mediante
  bloqueo del propietario hasta terminar el POST acotado; el resultado no puede ser simultáneamente
  suppressed y delivered. Se verifica el intercalado concurrente, no sólo cancelar antes del envío.
  Cancelación/reprogramación toman primero la fila de cita y después el bloqueo global de slots,
  para no retener el bloqueo global mientras esperan al publicador. Su conexión transaccional
  usa temporalmente timeout de lectura = presupuesto HTTP CU28 + 5 s (20 s por defecto), y lo
  restaura al salir. Salud, lecturas generales y configuración global conservan socketTimeout=2 s.

### [S2.13] Destinatario local inexistente y cierre acotado de CU28

El canal local posee un registro explícito de destinos (workshop por defecto), no contactos
externos. POST /destinations/{destinationId}/channel valida existencia antes de deduplicar;
un ID desconocido devuelve 404 CU28_RECIPIENT_NOT_FOUND, sin escribir una entrega. /channel
se conserva como alias del destino workshop para las herramientas existentes. La clave de
deduplicación incluye destino y eventId; los registros anteriores corresponden a workshop.

El receptor autenticado n8n admite x-autonexus-destination con ID local limitado (letras,
dígitos y guiones), por defecto workshop. Nunca recibe una URL arbitraria. Sólo recuerda la
entrega tras recibo recorded|duplicate con evento/destino coincidentes. Un 404 del registro local
se responde como CU28_RECIPIENT_NOT_FOUND; fallos restantes siguen sin presentarse como éxito.
El audit guarda sólo resultado, evento, destino y fecha, sin secreto/cabeceras/cuerpos.

Aceptación: reutilizar el sobre real ya aprobado de una operación empresarial finalizada,
reintentar contra un destino local que nunca existió y comparar con línea base por destino.
Debe fallar 404, no añadir efecto ni marca delivered para ese destino y conservar sin cambios
el estado/versión empresarial y su entrega histórica al destino válido. Repetir el fallo no lo
convierte en duplicate exitoso. La repetición contra workshop puede devolver duplicate real.
Se reutilizan las pruebas de transporte aprobadas y se concilian ocho pasos y siete excepciones
del CU28; no se envían mensajes externos ni se reinicia la operación empresarial.

### [S2.14] Primera fuente financiera real de CU25

Incremento acotado posterior al ledger publicado fb27230: herramienta de lectura
autonexus_get_financial_summary sobre GET Finance /financial-summary?from=&to=.
Sólo la sesión entrante, sin client_credentials, acceso SQL, MCP nuevo ni
escrituras financieras. No convierte el reporte operativo CU26/CU28 en financiero.

- Catálogo financiero sólo con FINANCE_API_URL configurada y consulta fresca de
  Empleados que confirme employeeId, employeeStatus active y payments:read más
  expenses:read. Se comprueba de nuevo al ejecutar; Finance reautoriza la misma
  sesión. Roles mcp_read_* del JWT no conceden finanzas. Catálogo operacional
  existente conserva su comportamiento; no se amplía por fallo del propietario.
- Período explícito desde/hasta AAAA-MM-DD, fechas civiles válidas, máximo31días.
  Sin período o filtro no soportado se aclara/rechaza, no se usa por defecto la
  agenda ni fechas que invente el modelo. Sólo from/to; GET a host/ruta de
  configuración fija, redirect error, plazo acotado, sin cabeceras/URLs arbitrarias.
- DTO obligatorio: from,to,timeZone America/La_Paz,currency BOB,paymentCount,
  expenseCount,receivedAmountMinor,expenseAmountMinor,netMovementMinor,generatedAt.
  Centavos como strings canónicos, cuentas enteras no negativas, neto puede ser
  negativo. Comprobar período/coherencia de recibido−gasto=neto con BigInt. Campo
  ausente/contradictorio es error, nunca cero. Cero auténtico del propietario sí
  se muestra como cero. No se suman páginas ni cotizaciones para obtener ingresos.
- La intención financiera de este incremento evita el LLM por completo: parser
  y respuesta deterministas sobre campos comprobados, rotulados como tales.
  Otras preguntas no ofrecen esta herramienta al modelo, de modo que no puede
  inventar su período ni seleccionar una lectura financiera ajena a la consulta.
  Incluye período/moneda/actualización y procedencia Finance, no Operations.
  Movimiento neto no es rentabilidad ni saldo bancario. No es evidencia de
  interpretación financiera generativa ni requiere descargar/calentar modelos.
- Consultas financieras no caen en formato de agenda; importes cotizados,
  facturación fiscal u otros filtros/capacidades aún ausentes se declaran.
  Registrar/pagar/anular/reembolsar/modificar cobros o gastos se rechaza antes
  de LLM/herramientas. Datos de herramientas no amplían autoridad.
- Aceptación: permisos/binding actuales y por llamada; expiración/fallo honesto,
  argumentos cerrados, cantidades grandes/ceros/ausentes y procedencia; contraste
  real por APIs de Finance y pregunta desde el Shell con las mismas cifras.
  No cierre global CU25/CU26 ni cambio de puntuación por una sola herramienta.

## [S3] Out of Scope

CU30 (escrituras), CU31 (administración web de clientes), notificaciones externas, nuevos recursos
cloud, autonomía indefinida de credenciales, calidad diagnóstica del modelo visual e ICONIX.

## Tasks

- [x] T1: evento Outbox → webhook n8n → canal local — acceptance: mismo `eventId` entregado una vez; fallo y recuperación observados (covers: S2.1,S2.2). Evidencia: `docs/evidence/cu28-20261106.md`.
- [x] T2: asistente LLM con herramientas — acceptance: preguntas que combinan consultas, aclaración, denegación por permiso y respuesta honesta ante fallo (covers: S2.3). Evidencia: `docs/evidence/cu25-cu26-shell-20261106.md`.
- [x] T3: reporte narrativo con cálculos deterministas — acceptance: cifras iguales al cálculo, con referencias y procedencia (covers: S2.4).
- [x] T4: BFF GraphQL y UI del Shell — acceptance: asistente y reporte usados desde la interfaz con sesión real (covers: S2.5). Verificado en navegador con siete escenarios.
- [x] T5: trabajo asíncrono con identificador estable — acceptance: creación breve, estado por GraphQL, recarga sin duplicar, documento persistido y token no persistido (covers: S2.6).
- [x] T6: agente en Compose con volumen de trabajos y BFF por red interna — acceptance: reporte terminado legible tras `--force-recreate`, trabajo cortado leído como `INTERRUPTED`, sin puerto del agente publicado y sin modelos nuevos (covers: S2.7).
- [x] T7: smoke desde el Shell contra el agente en contenedor — acceptance: pregunta con herramientas, reporte del modelo, recarga y exportación funcionan sin procesos del host (covers: S2.7).
- [x] T8: catálogo de automatizaciones conciliado — acceptance: solicitud de revisión registrada como adicional, orden finalizada 1/5 en la base y estado posterior de cada flujo respaldado por su propia evidencia (covers: S2.8).
- [x] T9: flujos de CU28 por incrementos — acceptance: cada flujo entregado dispara su evento real, se deduplica por `eventId` y llega al canal local; el resumen semanal publica el documento de CU26 (covers: S2.9, depends: T8).
- [x] T10: autorización de la programación — acceptance: la identidad programada es un empleado activo con roles mínimos, autorizado por cada propietario, sin cuenta técnica privilegiada (covers: S2.10).
- [x] T11: `docs/context/PLAN.md` desde la evidencia — acceptance: cada CU queda separado en implementación, aceptación funcional, calidad visual y despliegue, y ningún CU parcial se cuenta como completo (covers: S2.8).
- [x] T12: cerrar F1–F3 de revisión — acceptance: revocación sólo de ejecución impide leer/repetir reporte guardado; entrega semanal fallida + reinicio + semana siguiente recupera IDs/documento originales; cita concurrente serializada con envío (covers: S2.12).
- [x] T13: aceptar destinatario local inexistente — acceptance: dos 404 reales, auditoría durable sin delivered/efecto ni reversión; matriz ocho pasos/siete excepciones y revisión independiente conforme. Evidencia: `docs/evidence/cu28-recipient-local-20261107.md` (covers: S2.13).
- [x] T14: CU25 resumen financiero real — acceptance: fuente, respuesta y permisos conformes a S2.14 con oráculo Finance, revisión focalizada y publicación independiente (covers: S2.14).
- [ ] T15: CU26 financiero separado — acceptance: contrato/documento/claims monetarios exactos y trabajo autorizado separado de operaciones, fuentes reales, interfaz/filtros/exportación y evidencia; diseñar antes de implementar sin debilitar jobs históricos ni CU28.
