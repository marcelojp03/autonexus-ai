# 040 — Solicitudes de cita MCP pendientes de revisión

**Estado:** acordado para la implementación de CU30  
**Fecha:** 2026-11-10

Una operación MCP `solicitar_cita` crea una solicitud `PENDING_REVIEW`, no una cita confirmada
ni una reserva del horario. La solicitud usa `operationId` estable y referencias existentes de
cliente, vehículo y servicio. Operaciones valida que el vehículo pertenezca al cliente cuando
acepta/revisa la solicitud. La aprobación debe volver a validar disponibilidad y crear la cita
mediante el caso de uso propietario; el rechazo requiere motivo. Una respuesta perdida es estado
desconocido y se reconcilia por la misma operación, nunca se interpreta como rechazo ni provoca
una segunda cita.

El cliente externo nunca recibe autoridad para confirmar citas directamente. El tool scope MCP
`mcp:appointments:request` se combina con `appointments:write` delegado al propietario.
CU25 continúa independiente del servidor MCP.

**Implementación local en curso (2026-11-10):** se añadieron solicitud persistida y revisión en
Operaciones, el tool MCP y la administración CU31 en BFF/MFEs. La consulta de reconciliación
verifica además firma interna y restringe la lectura al mismo clientId y subject que originaron la
solicitud. El alcance continúa sin aceptación integral hasta completar pruebas de Operaciones y
aceptación OAuth/HTTPS real con ChatGPT.
