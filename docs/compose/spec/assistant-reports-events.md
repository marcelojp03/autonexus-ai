---
feature: assistant-reports-events
status: partial
updated: 2026-11-06
source: work/marcelo
---

# CU25/CU26/CU28 — asistente con LLM, reporte narrativo y flujo por evento

## Report

Estado al `73faf56`, verificado en navegador real. Detalle y límites en
`docs/evidence/cu25-cu26-shell-20261106.md` (asistente y reporte) y `docs/evidence/cu28-20261106.md`
(evento por evento).

| Diseño | Estado |
| --- | --- |
| S2.1 evento desde Outbox | **entregado** para un flujo (solicitud de revisión de CU17), tras corregir dos defectos de transporte: el cliente JDK se colgaba en el `upgrade` a HTTP/2 y el presupuesto de 5 s era menor que el receptor en frío |
| S2.2 deduplicación y canal local | **entregado**: mismo `eventId` entregado una vez, más reentrega, fallo, recuperación, respuesta perdida y agotamiento observados |
| S2.3 asistente con LLM real | **entregado**: Ollama `qwen3.5:4b`, catálogo cerrado por token, pasada de seguridad previa y respuesta con fuentes, procedencia y límites. La traza de razonamiento está desactivada por medición: con ella el modelo devolvía texto vacío en 99 s; sin ella responde en 20 s |
| S2.4 reporte con cálculo separado | **entregado**: cifras deterministas coherentes (`totalWorks` = suma de `byStatus` = `perWork`), afirmaciones ligadas a su indicador, período y fuente; la narración del modelo se acepta solo si cada cifra queda vinculada y, si no, se publica la plantilla rotulada `deterministic` |
| S2.5 integración web | **entregado**: `assistantAnswer`, `operationsReport`, `startOperationsReport` y `operationsReportJob` en GraphQL, con la página del microfrontend de Empleados sobre la sesión del Shell |
| S2.6 generación asíncrona (añadido al diseñar S2.5) | **entregado**: la creación responde en milisegundos con el `operationId` del cliente, el estado se consulta por GraphQL, recargar retoma el mismo trabajo y el documento terminado se persiste; el token nunca se escribe |

Pendiente de este recorte: los otros cuatro flujos de CU28, la programación con identidad técnica, los
avisos externos y el asistente como componente desplegado (hoy es un proceso local en el *loopback*).

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

## [S3] Out of Scope

CU30 (escrituras), CU31 (administración web de clientes), los cuatro flujos restantes de CU28
(ampliaciones), notificaciones externas, programación autónoma y calidad del modelo visual.

## Tasks

- [x] T1: evento Outbox → webhook n8n → canal local — acceptance: mismo `eventId` entregado una vez; fallo y recuperación observados (covers: S2.1,S2.2). Evidencia: `docs/evidence/cu28-20261106.md`.
- [x] T2: asistente LLM con herramientas — acceptance: preguntas que combinan consultas, aclaración, denegación por permiso y respuesta honesta ante fallo (covers: S2.3). Evidencia: `docs/evidence/cu25-cu26-shell-20261106.md`.
- [x] T3: reporte narrativo con cálculos deterministas — acceptance: cifras iguales al cálculo, con referencias y procedencia (covers: S2.4).
- [x] T4: BFF GraphQL y UI del Shell — acceptance: asistente y reporte usados desde la interfaz con sesión real (covers: S2.5). Verificado en navegador con siete escenarios.
- [x] T5: trabajo asíncrono con identificador estable — acceptance: creación breve, estado por GraphQL, recarga sin duplicar, documento persistido y token no persistido (covers: S2.6).
