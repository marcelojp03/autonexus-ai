# 022 — CU27 móvil: evidencia fotográfica offline

Fecha: 2026-11-04
Estado original: implementación aplicada en `work/marcelo`; la aceptación real se observó en la continuación del 2026-11-05, documentada al final.

## Contexto

Flutter ya guardaba avances en SQLite y ejecutaba LiteRT local, pero la fotografía de inspección no estaba enlazada con el trabajo ni con la cola. MS05 y Operaciones ya publican el protocolo de autorización, PUT prefirmado y confirmación de evidencia; MS04 ya recibe inferencias del cliente. Faltaban captura móvil, persistencia de etapa, revisión humana separada y adaptación del consumidor.

## Decisión de implementación

- La cámara y la galería se abren con el selector Android del sistema. Antes de abrirlo se guarda el `subject` y `assignmentId`; `retrieveLostData()` recupera la foto si Android destruye la actividad. Si no existe contexto de trabajo, la imagen recuperada se descarta.
- La imagen se orienta y normaliza como JPEG privado, máximo 1920 px y 5 MiB. LiteRT analiza esos mismos bytes; su SHA-256 identifica el archivo que se subirá. El archivo nunca se copia a la galería y Android Auto Backup queda deshabilitado para no replicar evidencia fuera del dispositivo.
- La cola de SQLite conserva por separado los puntajes del modelo (`runId`, `modelVersion`, etiquetas) y la revisión humana (`humanReviewLabels`, hora local). La revisión no altera las etiquetas predichas. El servidor registra `humanReview` por separado y pone su propia hora de registro.
- El cliente conserva IDs y avance de cada etapa y envía en orden `advance` → `evidence-authorize` → PUT binario sin bearer → `evidence-confirm` → `client-inference`. Un reintento reutiliza el operationId de la etapa, el `evidenceId` y los bytes; después de una respuesta PUT perdida, primero confirma la misma evidencia antes de solicitar otro intento.
- La URL prefirmada y sus cabeceras viven solo en memoria durante el PUT. MS05 persiste metadatos y resultados saneados; los bytes van únicamente a S3 por el URL emitido por Operaciones.
- Los registros de inferencia del servidor y del cliente comparten `vision_analyses`, pero la clave de idempotencia incluye `origin`. La corrección humana se mantiene separada de la predicción y ligada al mismo modelVersion.
- La UI conserva la identidad Material 3 actual de AutoNexus. La aplicación Geofence fue revisada como referencia de componentes Android, no se copiaron su paleta ni su temática. La revisión visual comparada queda para la siguiente sesión con el usuario.

## Continuación 2026-11-05 — aplicación del contrato de replay

La aceptación física descubrió que el replay del mismo sobre devuelve `replayed:true` con lista de
operaciones vacía y que un push terminal no repite necesariamente el body. Flutter usa ambos
indicadores y consulta la operación durable para recuperar `lastBody.advance.id` antes de avanzar
con la foto; no crea otra intención ni modifica versiones/cuerpos guardados. Dos regresiones
SQLite con cierre/reapertura reprodujeron el defecto antes del cambio.

El Mi A3 completó foto/S3/MS04 después de perder una respuesta de avance ya aceptado, y otro
sync conservó IDs/conteos/versión. Otro pendiente fotográfico recibió403 real del propietario,
con foto preservada; finally restauró la asignación y PKCE fresco recuperó la lectura en UI.
Detalles y fallos intermedios conservados en `docs/evidence/cu27-20261105.md`. La comparación
visual sigue diferida y la capacidad del modelo permanece NO validada.

## Límites de verificación originales

Pruebas locales del flujo cliente y build APK no prueban que las cabeceras firmadas coincidan con S3 ni que Operaciones, MS05, MS04 y la cámara trabajen juntos en el teléfono. ADB no muestra ahora un dispositivo conectado y no se observó el PUT/confirmación real. La capacidad del modelo continúa marcada como NO validada. No se declara CU27 completo ni S3 real probado.
