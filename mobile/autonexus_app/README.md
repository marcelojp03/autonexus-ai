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
| Ejecución en Android | **Pendiente**: el teléfono conectado (`RZCTA127N1F`) está sin autorizar y el emulador no llega a `online` en este entorno |
| Equivalencia numérica del artefacto | Verificada fuera del dispositivo: LiteRT 3e-06 y TFJS en navegador 2e-06 |

Compilar no es ejecutar: la inferencia en dispositivo hay que correrla con el comando de arriba
cuando haya un teléfono autorizado o un emulador operativo.