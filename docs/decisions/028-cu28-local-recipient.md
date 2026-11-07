# 028 — CU28: destinatarios explícitos del canal local

Fecha: 2026-11-07. Amplía decisiones 025/027 y especificación S2.13.

El registro local admite `workshop` por defecto y rechaza destinos no configurados antes de
deduplicar. `/channel` conserva compatibilidad con el destino original; los registros
históricos sin destinationId pertenecen a workshop. Las claves nuevas incluyen destino y
evento, sin reescribir el JSONL ni las entregas anteriores.

El receptor sólo acepta un ID local acotado, nunca una URL del emisor. Autentica primero y
comprueba el recibo del canal: estado recorded/duplicate, evento y destino coincidentes.
Un 404 no produce delivered y se conserva como resultado auditado con IDs/código/fecha,
sin cuerpos, cabeceras ni secretos. El workflow puede completar su tratamiento con
success nativo mientras devuelve el rechazo empresarial 404.

La aceptación reutiliza un evento empresarial real ya entregado, no provoca otra reparación
ni modifica su Outbox. Dos rechazos del destino inexistente y dos duplicate del original
conservan canal y estado propietario idénticos. Evidencia y límites:
`docs/evidence/cu28-recipient-local-20261107.md`. Ningún mensaje abandona el entorno local.
