# 030 — CU19/CU20: dinero recibido y gastos propietarios

Fecha: 2026-11-08. Especificación `docs/compose/spec/financial-ledger.md`.

- Primer incremento FULL_AFTER_COMPLETION_V1: cobro íntegro tras finalización y Saga
  global confirmada. Restricción conservadora, no aprobación de abonos/anticipos.
- Cotización aprobada/vínculo no son ingresos. Finance usa el DECIMAL de la versión
  exacta pactada, su vínculo activo y contexto mínimo actual de Operaciones por API.
- MonedaBOB e importes string-centavos con cálculo entero propietario. Cambios,
  operación idempotente, recibo interno no fiscal y audit atómicos, bloqueo local y
  comprobación de replay antes de versión. Rechazos válidos durables; timeout incierto.
- Comprobación de referencias no efectivas es humana, registrada por Finance y
  vinculada a actor/orden/importe/medio; no un flag del formulario ni verificación bancaria.
  Una nueva solicitud coincidente recupera la comprobación original sólo si está
  sin consumir y coincide también el vínculo laboral/referencia canónica; se
  audita sin alterar nota/fecha/ID. No habilita otro actor, otra orden ni doble uso.
- Gastos append-only con categorías, responsable servidor y exclusión de posible
  duplicado por contenido/hash documental. Otro gasto requiere motivo e intención nueva.
- Cada propietario reautoriza vínculo/permiso actual. Contexto de cobro no abre
  permisos generales de Saga. El escritor original puede conciliar su intención aunque
  no tenga lectura general del módulo; la UI no debe ocultar ese acceso permitido.
- Metadata/grants por GraphQL. Binario por BFF sin JWT/cookies, ruta fija,5MiB y
  deadlines absolutos. Finance posee archivos/metadata/perfil; versiones/checksum/firma
  antes de available; grants de256bits sólo hash persistido y120s, nunca en resultados.
- S3-compatible local opcional e independiente para aceptación: sidecar/volumen propio,
  sólo red compartida con Finance para loopback, sin puerto host ni Docker socket.
  No nuevo recurso AWS ni perfil de Operaciones. Sin configuración se responde503.
- Evidencia/limitaciones en `docs/evidence/cu19-cu20-20261108.md`: carreras PostgreSQL
  reales y respuestas perdidas recuperadas, sin borrar ni revertir historia. No se
  atribuyen a mocks la integración real, a netMovement rentabilidad, ni a un recibo una factura.
