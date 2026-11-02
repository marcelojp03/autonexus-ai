---
feature: offline-sync
status: proposed
updated: 2026-11-02
source: work/marcelo
---

# Recorrido offline y sincronización (MS05 / DynamoDB) — propuesta

> **Estado: propuesta, nada implementado.** `services/sync` sólo contiene `README.md` y `AGENTS.md`, y
> `contracts/sync/README.md` no define el contrato de sobres. No hay evidencia que presentar todavía;
> este documento fija el alcance para no confundir «compila» con «funciona sin conexión».

## Recorrido objetivo (el que se debe poder demostrar)

1. **En línea**: el mecánico descarga un trabajo autorizado (asignación + orden + checklist) y el
   artefacto del modelo; ambos quedan en almacenamiento local.
2. **Sin conexión**: cerrar y reabrir la app; el trabajo sigue consultable, se captura o elige una
   imagen, se infiere localmente y se guarda un **avance pendiente** con su `operationId` y hash de
   la imagen.
3. **Reconexión**: el pendiente se sincroniza por MS05 hacia Operaciones (avance/evidencia) y el
   resultado de inferencia hacia Inteligencia, con estados visibles (`pending`, `sending`, `acked`,
   `rejected`, `conflict`).
4. **Reintento sin duplicación**: reenviar el mismo `operationId` no crea un segundo avance.
5. **Conflicto real**: si el trabajo fue reasignado, cerrado o la versión cambió, el servidor responde
   `409` con código y la app muestra el rechazo y conserva el pendiente para decisión humana.

## Lo que falta, por orden

| Paso | Qué implica | Depende de |
| --- | --- | --- |
| 1 | Contrato `contracts/sync/overlay.md`: sobre (`overlayId`), operaciones, cursor, versión base, códigos (`SYNC_ALREADY_APPLIED`, `SYNC_VERSION_CONFLICT`, `SYNC_REJECTED_BY_OWNER`) | — |
| 2 | MS05 `services/sync` (NestJS + DynamoDB): tabla por usuario, `overlayId` idempotente, reenvío al propietario con su token, resultado por operación | 1 |
| 3 | App Flutter: SQLite (trabajos, avances pendientes, resultados), cola con estados y reintento, indicador de conectividad | 1 |
| 4 | Recorrido real en dispositivo: preparar, cortar red, capturar, inferir, guardar, reconectar, sincronizar, repetir envío, forzar conflicto | 3 |
| 5 | Evidencia saneada: `output/cu-sync/*.json` con estados y códigos, sin datos privados | 4 |

## Reglas que no se negocian

- **Nada de confirmaciones optimistas**: una reserva de horario, una confirmación o un cobro requieren
  validación en línea; el avance offline es un pendiente, no un hecho aceptado.
- Cada operación pendiente conserva `operationId`, versión base, dependencias y el hash de la imagen;
  reenviar es seguro por diseño del propietario, no por suerte.
- El modelo es el mismo artefacto experimental: la inferencia local no cambia su estado de calidad ni
  autoriza distribución.
- La app no guarda tokens de refresco en disco; la cola guarda operaciones, no credenciales.

## Estimación honesta

Los pasos 1–2 son un bloque de servicio con base propia; 3–4, un bloque de app más la matriz en
dispositivo. Ninguno se puede declarar hecho sin el recorrido real del punto 4 con red cortada y
verificación de duplicación y conflicto.
