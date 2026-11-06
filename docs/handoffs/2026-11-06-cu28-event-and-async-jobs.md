# Continuidad — CU28 evento, contrato asistente/reportes y trabajos asíncronos

Estado al 2026-11-06, HEAD `4cdba69` publicado en `main` y `work/marcelo`. Leer
`docs/evidence/cu25-cu26-cu28-20261106.md` y `docs/compose/spec/assistant-reports-events.md`.

## Orden fijado por el usuario (no volver a elegir entre bloques)

1. **CU28 por evento** — reconstruir/desplegar Operaciones con `V12` verificando la imagen realmente
   ejecutada; activar el workflow con el mecanismo de la versión instalada; definir respuesta
   explícita para duplicados (no dejar al publicador esperando si el dedupe filtra todos los items);
   generar la solicitud de revisión por la API real (nada de SQL); verificar Outbox→publicador→
   webhook→n8n→canal, repetición del mismo `eventId`, fallo, recuperación, respuesta perdida y
   agotamiento de reintentos. No completa los otros flujos de CU28.
2. **Contrato asistente/reportes** — `totalWorks` calculado y coherente con `byStatus`; nunca
   rellenar con cero un campo ausente; verificar el DTO real del servicio a través del BFF.
3. **Operaciones largas** — trabajo con identificador estable + consultas breves de estado/resultado
   por GraphQL (patrón asíncrono), progreso y recuperación tras recargar sin crear otra generación;
   autorización y registro por usuario en cada consulta; sin tokens persistidos en el trabajo.
   El **Shell** es dueño de la renovación; el BFF solo comunica la expiración y no repite una
   generación de 90 s. Distinguir 401 de 403 (no convertir denegación en reintentos de sesión).
4. **Demostración desde el Shell** — pregunta combinada con LLM real, aclaración, denegación, fallo
   honesto, reporte con narrativa **real** de Ollama, y expiración de sesión durante una generación
   con recuperación sin duplicarla.
5. **Fundamentación del reporte** — cada afirmación cuantitativa debe referenciar el indicador y la
   fuente correctos, no solo contener un número permitido; si se usa plantilla, declararlo
   determinista y no contarlo como evidencia generativa.

## Pendientes técnicos conocidos

- `publish:workflow` no activó el workflow en n8n 2.46.6: usar `update:workflow --active=true` o la
  UI y comprobar con `n8n list:workflow --active=true --onlyId`.
- En modo `responseNode`, si el dedupe filtra todos los items no se responde: definir 2xx explícito.
- El servicio del asistente devuelve `figures.byStatus` y `totalWorks` nulo → el BFF falla cerrado.
- Tokens locales de 60 s; `SessionPort.requestBusiness` corta a 15 s.

## Artefactos

`scripts/cu28/{channel.mjs,verify-event-real.mjs}`, `infra/n8n/workflows/execution-review-event.json`,
`services/operations/.../infrastructure/cu28/*`, `integration/agent/src/{assistant,llm,report,server.ts}`,
`contracts/graphql/assistant.graphql`, `integration/bff/src/application/assistant-gateway.ts`,
`web/mf-employees/src/app/features/assistant/*`.
