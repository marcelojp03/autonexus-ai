# 027 — CU28: propietarios del catálogo y delegación programada limitada

Fecha: 2026-11-07. Alcance técnico autorizado en `assistant-reports-events.md` S2.9–S2.11.

## Decisión

- Asignación definitiva se emite en Operaciones al cierre global de CU15, junto a estado y
  Outbox locales; una reserva/confirmación aislada de Empleados no significa éxito de la Saga.
- Operaciones posee selección y revalidación de citas. Finanzas posee selección, estado,
  migración y Outbox de cotizaciones. n8n sólo activa APIs autorizadas y no consulta sus bases.
  IDs estables por tipo/agregado/versión; obsoleto se conserva como `suppressed`, no `delivered`.
- Programaciones en `America/La_Paz`: recordatorio diario 09:00 para mañana, cotizaciones cada
  hora (24 h pendientes por defecto), reporte lunes 09:00 para semana civil anterior. La política
  local de un minuto sólo acorta la aceptación financiera y no altera timestamps empresariales.
- Resumen consume CU26 mediante trabajo idempotente por período; conserva documento, procedencia
  y rotulado LLM/plantilla. Reintenta la misma entrega y no revive trabajos terminales.
- Identidad programada = empleado sintético activo con cinco permisos mínimos de lectura,
  Code+PKCE y refresh cifrado en n8n. Cada propietario reautoriza; no existe bypass técnico.
  El reporte guardado también exige autorización actual en Operaciones en cada lectura/replay.
- Una agenda vigente no autoriza por sí sola un documento agregado: el agente comprueba ambos
  permisos actuales en Empleados y cada ejecución representada, también en replay tras un await.
- Pending semanal y copia inmutable del reporte pertenecen al ledger del agente, no al static data
  de una ejecución fallida de n8n. Se recupera la intención anterior antes de seleccionar semana;
  sólo el ACK del recibo registrado/duplicado la cierra. El snapshot no sigue el TTL de trabajos.
- El recordatorio bloquea cita → Outbox durante decisión final, POST acotado y registro. Una
  cancelación/reprogramación concurrente espera esa transacción o gana antes y suprime el aviso.
- La espera legítima del envío es incompatible con el socketTimeout JDBC global de 2 s. Sólo
  cancelación/reprogramación amplían temporalmente su conexión a timeout HTTP + 5 s y toman
  fila de cita antes del bloqueo global de slots; restauran el valor al salir. Salud/lecturas
  y propiedades globales conservan sus límites cortos. No se oculta un timeout como rechazo.
- Cadencia abreviada sólo en copias `Proof`; las exportaciones normales se versionan inactivas.
  Restablecer la sesión es operación explícita, no autonomía indefinida.

## Consecuencias y evidencia

Precisa la decisión 025: el HTTP sigue ocurriendo después del commit del productor y de la
reclamación corta. La comprobación final de entrega usa ahora otra transacción que conserva
los bloqueos de cita/Outbox durante el POST acotado; no se incluye la reparación original ni
se revierte ésta si el aviso falla. Es el costo explícito de serializar el aviso con la mutación.

Fallo del aviso no revierte reparaciones ni cotizaciones confirmadas. Se conservan intenciones,
versiones, intentos, supresión y agotamiento. La reclamación de un Outbox agotado es intervención
operativa sobre esa fila identificada; no reescribe negocio. No se añaden mensajes externos.

Evidencia y limitaciones: `docs/evidence/cu28-catalogue-20261107.md`. La conciliación funcional
del asistente/reportes queda en su matriz; ni la dependencia externa configurable Ollama ni la
programación de CU28 se usan para negar una generación CU26 ya demostrada.
