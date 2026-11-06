---
feature: assistant-reports-events
status: in-progress
updated: 2026-11-06
source: work/marcelo
---

# CU25/CU26/CU28 — asistente con LLM, reporte narrativo y flujo por evento

## Report

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

El BFF expone `assistantAsk` y `operationsReport` en GraphQL y reenvía el token del usuario al
servicio del asistente, que usa ese mismo token contra las APIs (sin acuñar identidades). La UI del
microfrontend de Empleados ofrece ambas funciones con la sesión del Shell.

## [S3] Out of Scope

CU30 (escrituras), CU31 (administración web de clientes), los cuatro flujos restantes de CU28
(ampliaciones), notificaciones externas, programación autónoma y calidad del modelo visual.

## Tasks

- [ ] T1: evento Outbox → webhook n8n → canal local — acceptance: mismo `eventId` entregado una vez; fallo y recuperación observados (covers: S2.1,S2.2).
- [ ] T2: asistente LLM con herramientas — acceptance: dos preguntas distintas que combinan consultas, aclaración, denegación por permiso y respuesta honesta ante fallo (covers: S2.3).
- [ ] T3: reporte narrativo con cálculos deterministas — acceptance: cifras iguales al cálculo, con referencias y procedencia (covers: S2.4).
- [ ] T4: BFF GraphQL y UI del Shell — acceptance: asistente y reporte usados desde la interfaz con sesión real (covers: S2.5).
