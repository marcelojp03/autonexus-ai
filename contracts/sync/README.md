# contracts/sync
Sobres offline, versiones, dependencias, cursores y estados.
Estado: contrato aprobado en `overlay.md`; MS05 implementa sobre, estados, dependencias y reenvío por propietario. La carga S3 real y los recorridos físicos Flutter/PWA se verifican aparte y no se deducen de compilar el cliente.

Continuación 2026-11-05: PWA verificó la fotografía original pendiente mediante S3 real, confirmación propietaria y persistencia de inferencia de cliente en MS04; reapertura offline y segundo intento no crearon efectos adicionales. No traslada esa aceptación a Android ni acredita por sí sola rechazo por permiso. Ver `docs/evidence/cu27-20261105.md` desde la raíz.

La continuación física del A3 verificó independientemente foto/S3/MS04, pérdida de respuesta después de aceptación y reintento único, y rechazo propietario403 con fotografía conservada/restauración/fresh PKCE. La aceptación móvil no se deriva de las pruebas PWA.

Replay: un sobre ya existente puede responder `replayed:true` con `replayedOperations:[]`. La lista vacía no significa que deba crearse otro sobre. Un push de operaciones terminales puede enumerar IDs aplicados sin repetir sus cuerpos en `results`. Si una etapa dependiente necesita el ID propietario, consultar la operación original y usar `lastBody` solo con estado `applied`. Mantener el sobre/cuerpo/operationId/versiones guardados; nunca generar otra intención para suplir una respuesta perdida.

El traslado de origen usa exportación/importación explícita de una copia privada versionada, sin tokens ni URLs firmadas: mismo subject autenticado, destino vacío, validación cerrada de campos, hash/bytes de archivos, modelos y cuerpos inmutables por etapa. Importar no revalida permisos ni marca operaciones aplicadas; el servidor vuelve a autorizar al sincronizar. La copia de origen no se elimina.

