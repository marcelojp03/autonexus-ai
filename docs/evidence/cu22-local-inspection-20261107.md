# CU22 — conciliación local por superficie

Base `24f76a9`, `work/marcelo`. Alcance: nueve pasos y siete excepciones de
`docs/use-cases/CU22.md`; contrato `contracts/ai/local-inspection.md`. No es evaluación
diagnóstica, entrenamiento ni documentación académica ICONIX.

## Evidencia feliz reutilizada

`docs/evidence/cu27-20261105.md` acredita Flutter físico y PWA: trabajo preparado por UI
con sesión real, selección de imagen, inferencia LiteRT/TFJS sin red, cuatro puntajes y
modelVersion, revisión humana independiente, cierre/reapertura, fotografía privada y
sincronización posterior una sola vez con los identificadores originales. No se repite
esa matriz de transporte para cerrar excepciones de CU22. Las comparaciones TFJS Node,
Chromium WebGL y desde foto ya registradas en STATUS acreditan ejecución/equivalencia,
no precisión ni aptitud diagnóstica.

## Nueve pasos

| Paso | Flutter | PWA |
| --- | --- | --- |
| 1. Abrir inspección | WorkPage del trabajo preparado, evidencia CU27 física | `/offline.html`, evidencia CU27 autenticada |
| 2. Elegir vehículo u orden | Orden de PreparedWork autorizado | Selector de trabajo descargado por APIs propietarias |
| 3. Capturar o seleccionar foto | Picker del sistema y archivo privado, CU27 | Input JPEG/PNG y Blob privado, CU27 |
| 4. Verificar entrada | PhotoProcessor: firma, bytes, resolución/cabecera antes de decode; nuevos tests | validatePhoto/imageDimensions antes de cargar modelo; nuevos tests |
| 5. Ejecutar modelo local | LiteRT real físico en CU27 | TFJS real/WebGL/PWA offline en CU27 y comparación existente |
| 6. Anomalías y confianza | Puntajes originales por clase y umbrales experimentales; abstención si ninguno supera | Puntajes originales por clase, sin confianza clínica global; abstención por umbrales |
| 7. Interpretación humana | inspectionReview independiente; humanReview de predicción conserva modelVersion | inspectionReview independiente; corrección no sobrescribe clientInference |
| 8. Guardar local/asociar orden | SQLite esquema aditivo 7 y archivo privado; pruebas de reapertura y rollback | IndexedDB, transacción confirmada antes de resolver; copia v2 preserva lectura de v1 |
| 9. Pendiente offline | Cola pending; servidor confirma únicamente al sincronizar | Cola pending; guardar no significa applied |

## Excepciones y límites del oráculo

| Excepción | Verificación focalizada disponible | Lo que no acredita |
| --- | --- | --- |
| Modelo no disponible | PWA prepareModel 404/manifiesto incompatible; Flutter puerto de carga que falla, revisión manual visible | No se borró un modelo del teléfono ni se alteraron sus pesos |
| Formato incorrecto | Cabeceras inválidas, GIF decodificable rechazado, JPEG/PNG permitidos, más de 5 MiB rechazado antes de decode | No detección exhaustiva de todos los archivos maliciosos |
| Calidad insuficiente | Lado inferior a 32 px rechazado; se ofrece retomar o registrar manualmente | No algoritmo validado de desenfoque, iluminación o encuadre |
| Recursos insuficientes | Cabecera mayor de 8192 px/lado o 24 MP; error de alloc/OOM controlado en puertos; intérprete/tensores liberados al fallar | No se agotó RAM real ni se certifica un mínimo de hardware universal |
| Inferencia fallida | Fallo controlado del clasificador, foto conservada y revisión manual sin puntajes ficticios | No fiabilidad general del modelo |
| Confianza baja | Salida controlada bajo los umbrales reales del manifiesto de prueba; mensaje no concluyente, puntajes intactos | No calibración estadística de confianza ni ausencia de daño |
| Almacenamiento insuficiente | SQLite max_page_count real acotado; trigger SQLITE_FULL y escritura parcial ENOSPC controlados; Chromium con cuota real256KiB antes de abrir IndexedDB rechaza2MiB, conserva registro anterior y permite el mismo ID tras liberar cuota; fallo controlado en UI conserva borrador/foto | No persistencia de un borrador que el disco rechazó ni supervivencia a cierre de datos no guardados |

La alternativa manual existe aun sin foto/modelo/predicción. No crea un análisis MS04,
modelVersion ficticio ni puntajes cero. Usa interpretación explícita y etiquetas humanas,
aparte de cualquier resultado original. El protocolo existente sincroniza texto/foto;
sólo envía client-inference cuando existe una predicción real.

## Verificación observada del delta

Comandos desde la carpeta indicada, sin cambiar SDK/dependencias:

| Carpeta y comando | Resultado | Naturaleza |
| --- | --- | --- |
| Raíz, Node22.22.3 `--experimental-strip-types --test web/shell/tests/*.test.mjs` | **115/115**, exit0 en `cu22-shell-complete-final`; incluye8de workspace y cuota real | IndexedDB Chromium real; protocolo/sesión/puertos controlados identificados en cada test |
| Raíz, mismo Node, `--test --test-name-pattern 'bounded Chromium quota' web/shell/tests/offline-store.test.mjs` | **1/1**, exit0 | Cuota de Chromium real, sin sustituir peticiones IDB |
| `web/shell`, `tsc`, `vite build`, `node scripts/build-offline-manifest.mjs`; imagen web target runtime | exit0; manifiesto13recursos host y runtime nginx verificados | Construcción de fuente actual, modelos no descargados |
| `mobile/autonexus_app`, `flutter test test/inspection_limits_test.dart test/inspection_review_test.dart test/offline_store_test.dart test/sync_service_test.dart` | **52/52**, exit 0 | SQLite FFI real temporal, widgets y fallos controlados; no red propietaria |
| Misma carpeta, `flutter analyze --no-pub` | exit 0, sin incidencias | Análisis estático del delta en ese momento |
| Misma carpeta, `flutter test integration_test/cu22_inspection_test.dart -d <dispositivo> --no-pub --reporter expanded` | **5/5**, exit0, Android físico | Modelo realmente ausente, UI/SQLite nativos; otros fallos/puntajes controlados |
| PWA desplegada, `node output/cu22/pwa-exceptions.mjs` | **5etapas**, exit0/pass=true | Shell/Keycloak/BFF/propietarios reales, ninguna inyección de sesión/IndexedDB; modelo ausente real HTTP404 |
| Mismo script `--prepare`, tras overlay de artefactos autorizados | **4etapas**, exit0/pass=true | Guardado real de8archivos de modelo y conservación tras cierre/reapertura sin red; no validación de capacidad visual |
| `flutter build apk --debug --no-pub -t lib/main.dart`, instalación `adb install -r` y observación de UI | exit0/pass=true | APK operativo normal restaurado, sin clear/uninstall; el fixture no queda como entrypoint instalado |

Logs ignorados `output/cu27/cu22-{shell-fresh,shell-build,flutter-fresh,flutter-analyze}.*`.
PWA: trabajo en ejecución preparado por sus APIs reales sin modelo; JPEG inválido y cabecera
8192×8192 rechazados sin encolar; modelo404 real, foto de39.808bytes, interpretación/etiqueta
humana manual y ningún clientInference. Guardado pending y cierre/reapertura sin red mantienen
el mismo operationId y objeto de revisión. Sin sincronizar ni volver a probar CU27 completo.
La regresión de preparación reprodujo un éxito falso con modelo sólo en RAM y caché ausente:
ahora exige el manifiesto y todos los archivos del modelo cacheados antes de anunciarlo offline.
La preparación básica permanece independiente. Se limpia también el temporizador del wait
del worker al resolver, sin dejar una espera de60s viva tras completar la preparación.
Capturas desktop1440/móvil390 en `output/playwright/cu22/manual-*.png`, identidad enmascarada
y comprobación de no desborde; no equivalen a una conformidad visual general independiente.

Android: cada prueba usa SQLite/fotos temporales propios; nunca abre la base habitual ni
sincroniza. Modelo ausente usa loader real con asset inexistente; las otras salidas/fallos
son puertos inyectados. Se verificó guardado fallido/retry único, separación de predicción
y revisión, archivo conservado, cierre/reapertura y liberación del clasificador.

Los intentos intermedios permanecen en logs, sin contarlos como PASS: cuota fijada después
de abrir IDB no se impuso por el presupuesto del cliente; se fijó antes y pasó. Android
4/5 falló al final por handle de semántica del primer cuadro, sin aserción empresarial
fallida; warmup sin cuadros terminó en timeout. Se habilitaron cuadros live sólo para el
warmup y se restauró la política antes de las pruebas; el leak checker sigue activo y
los cinco escenarios pasaron. Tres avisos de llaves en el fixture se corrigieron y el
análisis final quedó limpio. PWA detectó primero oráculo de bundle local anterior, y
luego una dependencia de agenda503; se corrigió el oráculo y se comprobaron lecturas
propietarias200 antes del reintento exitoso. No se cambió autorización ni se fingieron datos.

Artefactos adicionales: `output/cu27/cu22-{quota-before-client,shell-final,device-live-frame,
analyze-braces,pwa-ready}.*`, `output/cu22/pwa-exceptions.json` (con intento previo) y
`agenda-diagnostic.json`. El ajuste final del campo conserva avance2000/revisión1600;
se comprobó en el smoke `cu22-pwa-final-bundle` (5etapas/exit0) antes del ajuste adicional
de caché. El bundle posterior se comprobó en `cu22-model-cache-real` (4etapas/exit0),
con modelo preparado realmente en caché y conservado al arrancar sin red. No se volvió
a ejecutar la matriz CU27.

El overlay `infra/local/offline-model.compose.yaml` conserva la preparación de modelos
al recrear web: sólo monta en readonly los artefactos ya autorizados, worker y manifiesto.
`scripts/cu22/verify-offline-overlay.mjs cu16-proof-web:cache-ready` pasó antes del montaje:
5recursos básicos iguales a la imagen,8archivos de modelo,10.627.867bytes y0descargas.
No se distribuyen pesos/datasets en Git ni se los incorpora a la imagen.

Tras el test físico se reconstruyó expresamente `lib/main.dart` y se instaló con `-r`,
sin pm clear/uninstall. La observación de restauración verifica entrypoint normal, no
el fixture CU22; el verificador no lee la base habitual ni publica su XML. El XML temporal
propio se retiró, sin tocar fotos/colas. Artefactos `output/cu22/device/restore-app.json`
y `output/cu27/cu22-restore-normal-app.*`. No se afirma una comparación no realizada
de todas las filas de la base del usuario.
La observación final `cu22-observe-normal-gated` terminó0: título/controles normales,
sin fixture y sesión no autenticada, por tanto descarga correctamente oculta. El
chequeo previo exigía erróneamente un botón sólo visible con sesión; se conservó como
fallo del verificador y se corrigió contra la condición real de JourneyHome.

## Cobertura y capacidad

### Reanudación y regresiones C1–C3 (2026-11-08)

Comprobaciones frescas, con Node22.22.3 y SDK Flutter existente:

- Shell: `node --experimental-strip-types --test web/shell/tests/inspection-review.test.mjs web/shell/tests/offline-workspace.test.mjs web/shell/tests/offline-store.test.mjs web/shell/tests/service-worker.test.mjs`: **41/41**, exit0 (`resume-cu22-shell`).
- Flutter: los cuatro archivos focalizados de la tabla anterior: **57/57**, exit0 (`resume-cu22-flutter`); análisis completo sin incidencias, exit0 (`resume-cu22-analyze`).
- Shell: tipos, Vite y manifiesto offline13recursos: exit0 (`resume-cu22-build`).

Se comprobó también el registro físico C3 existente, sin repetirlo: `c3-device-settled`
**1/1**, exit0, reemplazo de foto rechazada conserva revisiónA y adopción deB exige
revisión nueva. `c3-settled-analyze` sin incidencias y `cu22-c3-restore-normal`
pass=true, sin borrar datos de aplicación. No sustituye a las cinco pruebas físicas
anteriores: es una ampliación focalizada.

Aceptación Chromium156.0.8078.4 del worker fuente (`node scripts/cu22/verify-worker-recovery.mjs`,
`resume-cu22-worker-unavailable`, exit0): A instalada/preparada; B corrupta rechazada
por SRI conservando cachés y recursosA sin red; B completa espera el cierre de los
clientesA, se activa y conserva sus recursos después de cerrar/reabrir Chromium;
instalación básica sin modelo anterior, preparación fallida y reintento explícito
sobre el mismo worker, después coldboot sin servidor disponible. Son recursos
sintéticos con hashes conocidos en origen loopback temporal, no inferencia ni
integración de datos empresariales. El servidor de prueba se detiene durante coldboot
porque el modo offline de página no garantizaba cortar las solicitudes del worker.

El primer intento real encontró el guard de credentials=include bloqueando la
navegación pública. Regresión roja/verde y fix: sólo `/offline.html` admite fallback
de navegación; su fetch omite cookies y rechaza redirects. Las rutas protegidas,
cabeceras Authorization, queries y fetches include de assets siguen excluidos.
Se corrigió también que rechazar fotoB cambiaba el motivo de revisiónA en PWA:
regresión de formulario/IndexedDB Chromium real con dos fotos, rojo/verde1/1.
Última comprobación integrada del delta: `cu22-delivery-shell` **42/42**, exit0;
`cu22-delivery-build` tipos/build/manifiesto exit0. Flutter no cambió después de57/57.
Metadatos/inferencia y traslado v1/v2 se comprobaron además en
`cu22-inference-transfer-final`: **12/12**, exit0. Un intento directo previo
agotó20s de consola sin terminar y no se cuenta. La revisión independiente
general-140 se canceló sin dictamen después de solicitudes de cierre acotado;
no se la registra como conformidad ni se publica por esa revisión inconclusa.

**Licencia, separada del funcionamiento:** el artefacto servido conserva el antecedente
CarDD restringido; no se ha acreditado autorización de distribución de sus pesos.
El montaje local readonly no concede esa autorización. El candidato SYNDCAR con
licencia verificable no es el modelo servido ni acredita calidad suficiente. No se
descargaron modelos/datasets, no se publican pesos y no cambian licencia ni métricas
por cerrar el recorrido manual.

### Revisión directa focalizada autorizada (2026-11-08)

Método: revisión directa del delta contra3f1e61d, no independiente. Se revisaron
contrato/modos, validadores y traslado v1/v2; columnas SQLite aditivas y enqueue
transaccional; conservación de staging y adopción de foto; liberación de intérprete
al fallar manifiesto; límites previos a decode, puntajes/umbrales e identidad;
guardar sólo tras commit y retorno null ante fallo; aislamiento por subject y
hash de foto; worker allowlist/SRI/cachés separadas, bloqueo de actualización
incompleta y fallback limitado al documento público sin credenciales.

Cumplimiento coreS2.1–S2.5: conforme con la matriz/evidencia observada. Corrección:
sin críticos encontrados en este alcance focalizado. Consistencia: conserva
protocolos, SQLite/IndexedDB y separación predicción/revisión, sin capas nuevas
de transporte. No se repitieron pruebas aprobadas sólo por revisión.

S2.6/T7 permanece abierto: nuevos recorridos y UX antes/después no se aceptan
por estos tests. PWA baseline medido390→411px; PNG capturado pero herramienta
sin píxeles interpretables y dos intentos de modelo de visión fallaron por API.
Flutter físico no disponible: serial autorizado ausente; no se sustituyó por
otro conectado. Son límites explícitos, no aprobación visual ni del modelo.

La matriz concilia el recorrido y sus excepciones por superficie; el core tiene revisión
directa declarada, y la ampliación UX sigue abierta. CU22 global sigue parcial por capacidad visual; no
se cambian puntos por aprobar estas pruebas. Aunque se cierre funcionalmente el recorrido,
la capacidad visual actual permanece **experimental y no validada**, con los límites del
registro del modelo y de `contracts/ai/cu23-acceptance-criteria.md`. Un aviso experimental,
equivalencia numérica o prueba funcional no sustituye la validación del modelo.
