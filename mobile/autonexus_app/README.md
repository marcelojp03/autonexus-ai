# Aplicación Android
Tecnología prevista: Flutter.
Persistencia: SQLite y archivos privados.
Responsabilidad: Bloque 1 base; bloque 2 offline/IA local; bloque 3 modelo.
Alcance: Agenda, inspecciones, avances, evidencias, LiteRT local y sincronización posterior.
## Estado
Carpeta reservada. Aplicación todavía no generada. Leer el AGENTS raíz y local antes de inicializar. Los comandos para instalar, ejecutar y verificar se añadirán después de comprobarlos en el proyecto real.
## Estado real (2026-11-02)

Proyecto Flutter Android generado en esta carpeta (`flutter create --platforms=android .`) con
inferencia LiteRT de extremo a extremo implementada:

- `lib/inference/damage_classifier.dart`: carga `assets/models/model.tflite` (artefacto de CU23,
  `runId 20261101T-with-negatives`), preprocesa con las mismas reglas que el entrenamiento (RGB,
  redimensionado bilineal a 224×224, escala [-1, 1]) y ejecuta la interpretación en el dispositivo.
- `lib/main.dart`: pantalla que muestra **primero** el aviso de capacidad experimental con el
  `runId`, y después las puntuaciones; el modelo se marca como experimental en el propio manifiesto.
- `integration_test/inference_test.dart`: compara las puntuaciones del dispositivo contra la
  referencia del servidor para la misma imagen (`assets/samples/reference.json`, tolerancia 0,05 para
  absorber la diferencia entre el redimensionado del paquete `image` y el de TensorFlow).

Comandos comprobados:

```sh
cd mobile/autonexus_app
node scripts/prepare-assets.mjs                   # copia modelo, manifiesto y muestra (no versionados)
flutter pub get
flutter analyze                                  # sin hallazgos
flutter build apk --debug                        # APK generado (compila tflite_flutter)
flutter test integration_test/inference_test.dart -d <dispositivo>
```

Evidencia y límites:

| Comprobación | Resultado |
| --- | --- |
| `flutter analyze` | Sin hallazgos |
| `flutter build apk --debug` | APK construido (`build/app/outputs/flutter-apk/app-debug.apk`) |
| Ejecución manual Android | Samsung SM-G990B2 abrió la app y ejecutó la muestra LiteRT desde la interfaz (195 ms). No se verificó `GET /agenda/me`, cámara, PUT/confirmación S3 ni el recorrido offline completo; ADB ahora no muestra un dispositivo conectado. |
| Equivalencia numérica del artefacto | Verificada fuera del dispositivo: LiteRT 3e-06 y TFJS en navegador 2e-06 |

Compilar no es ejecutar: la inferencia en dispositivo hay que correrla con el comando de arriba
cuando haya un teléfono autorizado o un emulador operativo.

## Configuración local de AutoNexus

La app lee `assets/config/.env` con `flutter_dotenv` antes de iniciar. El archivo está ignorado
por Git; para crear uno en una instalación limpia, copiá `assets/config/.env.example` a
`assets/config/.env`. Si no existe, se usan los defaults locales de `lib/config.dart`. Solo contiene valores
**públicos** (issuer, URLs y el ID público del cliente): no pongas secretos, tokens ni credenciales S3.

En el teléfono conectado por USB, el entorno local usa `adb reverse` para que las URLs `127.0.0.1`
lleguen al laptop; no cambies el issuer a la IP del laptop. Desde esta carpeta se inicia con:

```sh
adb -s <serial> reverse tcp:4285 tcp:4285
adb -s <serial> reverse tcp:8081 tcp:8081
adb -s <serial> reverse tcp:3005 tcp:3005
flutter run -d <serial>
```

## Evidencia fotográfica offline

### Verificación funcional más reciente (2026-11-05)

Continuación física concluida en Mi A3 con issuer local4286 (valor público en el asset privado de
configuración). Instalación sin borrar datos, captura/inferencia sin red y reapertura, avance
real aceptado antes de cortar su respuesta, recuperación con el mismo UUID, evidencia disponible
en S3 y análisis cliente MS04. Segundo sync no cambió IDs/conteos/versión. Un pendiente diferente
recibió403 propietario y quedó rechazado con foto; finally restauró el rol y un PKCE nuevo/lectura
de agenda en la UI confirmaron recuperación. Evidencia por separado en
`docs/evidence/cu27-20261105.md`, desde la raíz.

Se corrigió el replay del mismo sobre (`replayed:true` puede tener `replayedOperations:[]`) y la
recuperación de `lastBody.advance.id` cuando el push terminal omite cuerpos. Dos regresiones
SQLite close/reopen fallaban antes del fix y pasan después. Suite final39 PASS, analyze sin
problemas, build/install APK conformes. La prueba de configuración usa valores públicos en
memoria y no depende del .env local. Revisión visual comparada sigue diferida; modelo NO validado.

El puerto4285 del ejemplo es un default de desarrollo. Para el runtime de aceptación actual,
configurar públicamente issuer4286, reconstruir APK y usar reverse4286/8081/3005; no cambiar
audiencia, credenciales ni issuer para sortear un error de login.

#### Historial anterior a la continuación fotográfica

En Mi A3 se observó login real, retorno automático, agenda protegida y preparación del trabajo del
6 de noviembre mediante el selector de día. Con modo avión y sin túneles USB de API, trabajo, foto,
cola y revisión humana persistieron tras dos arranques en frío. Interrumpir un envío dejó sending
durable; al reabrir se recuperó pending y el servidor devolvió un conflicto real sin borrar evidencia.
Un avance textual nuevo fue aplicado una sola vez; un segundo sync no cambió conteo ni versión.

SQLite usa esquema 6, incluidos los sobres de petición inmutables de cada etapa. La confirmación
usa la versión de la evidencia; no la de ejecución. flutter analyze --no-pub terminó con exit 0
sin hallazgos y la suite pasó 36/36. Hay pruebas nuevas de versiones diferentes y recuperación del
overlay original, además del entorno limpio MS04 documentado en services/intelligence/README.md.

No se declara aceptación fotográfica completa: S3 no está configurado en Operaciones y todavía
no se observó foto disponible ni análisis cliente real. Rechazo por permiso y revisión visual
comparada permanecen separados. Evidencia detallada: docs/evidence/cu27-20261105.md desde la raíz.

Desde un trabajo preparado se puede tomar una foto o elegirla de la galería. El selector del sistema
puede reiniciar `MainActivity`; la app persiste antes la asignación y recupera el resultado perdido al
iniciar. Normaliza la foto con orientación EXIF, la mantiene como JPEG privado de hasta 5 MiB, calcula
el hash de esos mismos bytes y ejecuta LiteRT local. Android Auto Backup está deshabilitado para evitar
copiar evidencia a respaldos del dispositivo. La pantalla conserva el aviso de capacidad visual
no validada y permite guardar aparte una revisión humana sin sobrescribir la predicción.

Al sincronizar, MS05 registra el avance, Operaciones autoriza la evidencia, el teléfono carga el
binario por PUT prefirmado sin bearer y luego confirma la evidencia. Solo tras la confirmación se
envía la inferencia del cliente a MS04. Una operación no aparece como confirmada antes de que el
propietario lo responda.

Verificación local ejecutada en `work/marcelo`:

```sh
flutter test --no-pub
flutter build apk --debug --no-pub
```

El test de protocolo usa transporte controlado; no prueba S3 real. La aceptación en dispositivo
requiere un teléfono autorizado, una sesión vigente, un trabajo asignado y almacenamiento S3
configurado. La revisión visual del nuevo flujo queda pendiente.
