# 025 — Publicación CU28 por evento: transporte, presupuesto e idempotencia observada

Fecha: 2026-11-06. Rama `work/marcelo`. Alcance: Operaciones (Outbox y publicador), workflow n8n
`cu28ExecutionReview` y el verificador `scripts/cu28/verify-event-business.mjs`.

## Contexto

El flujo por evento de CU28 (una solicitud de revisión de CU17 que se publica a n8n y termina en el
canal local) existía como código y como workflow, pero ninguna entrega real llegaba al canal. Las 10
tentativas de la primera solicitud real terminaron `CU28_WEBHOOK_UNAVAILABLE` y la fila quedó
abandonada. La lectura previa de la evidencia confundió dos sondas sintéticas del webhook con dos
eventos de negocio entregados.

## Decisiones

1. **Fijar el cliente HTTP del publicador a `HTTP_1_1`.** n8n 2.46.6 acepta el `upgrade` a HTTP/2 en
   claro del cliente JDK y no responde nunca: la misma petición se colgaba hasta el timeout del
   cliente con la versión por omisión y respondía en 1,4–2,6 s con `HTTP_1_1`. Es un único POST
   pequeño, así que no se pierde nada por no negociar HTTP/2. Se agrega una prueba que fija la
   versión para que la regresión no vuelva.
2. **Presupuesto de entrega configurable y mayor que el receptor en frío.** `CU28_WEBHOOK_TIMEOUT_SECONDS`
   (15 s por omisión, rango 2–60, valor inválido impide arrancar). El receptor medido costaba 7,33 s
   la primera ejecución y 0,85–0,91 s en caliente, por lo que 5 s convertían toda entrega legítima en
   una caída falsa. Un timeout **no** se trata como rechazo: la fila queda pendiente y se reintenta.
3. **La verificación trabaja sobre la línea base.** El verificador lee el estado existente (canal,
   Outbox, memoria durable de n8n), no exige un entorno vacío y no renombra, archiva ni borra
   registros para «limpiar». Archivar el canal destruyó en su momento la única prueba de una entrega
   ya realizada (`da4d75f9…`), y esa evidencia rotada se conserva y se cita como tal.
4. **Toda la evidencia se filtra por identificador**, nunca por el conteo global del canal:
   `recordsFor(eventId)`, fila de Outbox por `event_id`, memoria del receptor por `eventId`. Se
   distingue una transición distinta (otra versión y otro `causationId`) de una repetición del mismo
   evento.
5. **Reutilizar el `eventId` existente y, solo si no queda ninguno sin efecto, generar uno por el
   flujo real.** Reclamar una fila del Outbox es una acción de operación sobre el Outbox: no cambia
   estado de negocio y no crea eventos. Cuando el inventario ya no conservaba ningún evento sin
   efecto, el verificador produjo una solicitud de revisión por la API real de CU17 (devolución,
   avance, evidencia privada en S3, confirmación, checklist, `request-review`), sin SQL de negocio.
6. **El agotamiento se reproduce, no se simula.** Con el canal caído la misma fila llega a
   `MAX_ATTEMPTS`, queda abandonada con `CU28_DELIVERY_ATTEMPTS_EXHAUSTED`, conserva el payload y no
   produce efecto; el tratamiento documentado es reclamar la misma fila cuando el receptor vuelve.
7. **Preflight de resolución del destino.** Si el host del webhook resuelve a *loopback* dentro del
   contenedor del publicador, el verificador se detiene con el motivo explícito: un residuo en
   `/etc/hosts` produjo exactamente ese fallo y no debe confundirse con un defecto del flujo.

## Consecuencias

- Operaciones **201/201** pruebas; CU28 **9/9**. Corrida de verificación `pass: true` con las cinco
  observaciones sobre una sola `eventId`.
- El canal es un sumidero JSONL en *loopback* y n8n no persiste ejecuciones exitosas: la prueba del
  lado receptor es el estado durable del workflow más el 2xx previo a marcar la fila entregada.
- CU28 sigue **parcial**: un flujo de los cinco acordados y sin el resumen semanal de CU26.
