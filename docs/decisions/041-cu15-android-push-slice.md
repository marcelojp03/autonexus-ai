# 041 — Primer slice de avisos push CU15 para mecánicos Android

Fecha: 2026-11-10. Estado: decisión de implementación acotada; CU15 permanece sujeto a sus criterios de cierre vigentes.

Empleados es propietario del vínculo entre Firebase Installation ID y la identidad humana validada. Cada registro deriva el `sub` del bearer y resuelve un mecánico activo/habilitado en su propia base. Un FID es globalmente único y un upsert transfiere la instalación al subject autenticado vigente; la baja exige el mismo subject. Nunca se devuelve ni registra el FID.

Se reutiliza el Inbox/notificación durable de `order.confirmed`: el worker de push reclama filas únicamente después del commit receptor y realiza la llamada Firebase fuera de las transacciones de negocio. Usa Application Default Credentials, entrega FID por Firebase Admin y conserva idempotencia por evento con reintento acotado. Ausencia de credenciales deshabilita el envío sin afectar startup ni la confirmación CU15; un timeout es incierto y puede causar reentrega.

El mensaje usa texto genérico y solo incluye clase de evento e identificador opaco de asignación. Android vuelve a consultar la agenda autenticada antes de presentar la asignación. No se envía identidad del cliente, vehículo, diagnóstico, evidencia o finanzas.

La configuración cliente `google-services.json` es local e ignorada. El archivo Admin solo debe montarse read-only o ser provisto por ADC en runtime; nunca forma parte de source o imagen. No se creó ni configuró un proyecto Firebase. La entrega real necesita credenciales válidas, proyecto enlazado y dispositivo Android; las pruebas unitarias/fakes no prueban FCM.
