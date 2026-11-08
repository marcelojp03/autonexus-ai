# UX operativa — borrador PWA y preparación/formulario Flutter

Base `cc32551`, work/marcelo; ampliación de `offline-sync` S2.10–S2.12.
No vuelve a aceptar CU22/CU27 ni modifica modelo, licencia o métricas.

## Problemas y cambio acotado

PWA compartía texto/foto/revisión al cambiar el selector de trabajo. Ahora
cancelar conserva selección y borrador; aceptar descarte limpia antes de adoptar
la otra asignación. Un trabajo retirado no transfiere borrador al primero de la
lista. Cambio de selección durante hash no encola bajo otra asignación.

Flutter ofrecía Preparar incluso fuera de in_progress y asumía editable un
status ausente. La UI explica el estado y deshabilita el control; controlador
revalida estado, asignación/orden y cuenta antes de saveWork. No borra copia/cola.
El formulario ya no viene con descripción plausible/15min precargados: errores
inline, primer campo inválido enfocado, teclado numérico y SafeArea. Se conservan
componentes Material y semántica de predicción/revisión existentes.

## Evidencia antes/después, delimitada

- Node22.22.3: nuevas pruebas de selección/hash/cancelar/descarte fallaron antes
  del arreglo; primera reproducción se corrigió para no fallar por DOM doble
  incompleto. Roja final: Missing expected rejection al cambiar trabajo durante
  hash. Diez regresiones afectadas PASS; `tsc --noEmit -p web/shell/tsconfig.json`0.
- `draft-binding-before-served3`: build783c28903e24 anterior, fallo reproducido
  a1440/390: B seleccionado con texto/foto/revisión de A.
- `draft-binding-after-served`: build3c6abd4a26b6 real, a1440/390 cancelar conserva
  A y todos los materiales; aceptar limpia y adopta B. **0mutaciones/0avances
  en cola**. Son copias locales sintéticas en contexto Chromium nuevo y login
  normal; no evidencia de autorización/preparación propietaria nueva. Capturas:
  `output/playwright/draft-binding-{before,after}/work-switch-{1440,390}.png`.
- Fallos del guion conservados: carrera al esperar login; PNG8px rechazado por
  regla existente mínimo32px. Se corrigió el guion (64px), no se relajó validación.
- Flutter `flutter test --no-pub test/preparation_ux_test.dart test/owner_api_test.dart test/inspection_review_test.dart --reporter expanded`: **31/31**, exit0.
  La repetición de pruebas de revisión se justifica sólo por los3fixtures de
  formulario que dependían de los valores precargados eliminados. No matriz
  funcional/modelo CU22 ni CU28. Nuevos tests usan dobles de puertos, no SQLite
  empresarial ni integración real con el propietario. Intentos del actor con
  timeout/fixtures fallidos no se acreditan; resultado fresco en
  `output/cu27/mobile-workspace-ux-tests.*`.
- Análisis Dart focalizado6archivos: No issues found, exit0.
  `flutter build apk --debug --no-pub`: exit0,207.9s; no instalación nueva aún.
- Detector mecánico de fuente (una pasada): warning de img sin src en el preview
  oculto. Falso positivo comprobado en código: permanece hidden sin src, sólo
  se muestra tras validar archivo y crear blob URL, y reset revoca/oculta la
  imagen. Exit2del detector no es fallo de aplicación ni aprobación visual.

## Dispositivo y límites de aceptación

Autorizado ff77c09b1c12 volvió a estar conectado. App anterior abierta y pantalla
inicial Sin sesión inspeccionada semánticamente; sin limpiar/reinstalar datos.
Inicio de sesión abrió navegador; cuatro pestañas nativas previas impidieron
elegir una inequívocamente. Sonda de visibilidad CDP agotó plazo antes de llenar
credenciales; no se cerraron pestañas ni se usó el otro teléfono. Reverses sólo
para4286/8081 y forward CDP del dispositivo autorizado, sin tocar otros proyectos.
El forward temporal9222 creado en esta comprobación se retiró al detener el
diagnóstico; no se borraron datos ni pestañas. Reverses de la app conservados.

No se completó agenda→preparación→formulario en teléfono, ni teclado/foco/insets
reales del APKnuevo. Capturas web guardadas pero canal de imagen devuelve sólo
metadatos, no píxeles interpretables: **no cierre UI/UX por tests/DOM/PNG**.
T13 sigue abierto y no hay nuevos puntos ni declaración visual global. Revisión
independiente149focalizada terminada: sin defectos concretos nuevos, cumplimiento/
corrección/consistencia conformes para publicación parcial, no aceptación visual
ni física. No ejecutó de nuevo pruebas ni abrió artefactos privados. Publicación pendiente.
