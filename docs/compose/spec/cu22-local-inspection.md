---
feature: cu22-local-inspection
status: in-progress
updated: 2026-11-08
source: work/marcelo
---

# CU22 — conciliar recorrido local y cubrir excepciones

## Report

Incremento funcional sobre3f1e61d: revisión manual independiente en PWA/Flutter,
preservación de predicción/revisión, límites y fallos locales, recuperación de
caché y corrección de reemplazo de foto. Revisión directa focalizada declarada
tras cancelación del revisor sin dictamen; no independiente. CoreT1–T6 conforme
contra evidencia; T7 UX permanece abierto. No cierre global de CU22, calidad
visual general, calidad del modelo ni licencia.

Verificación conservada sin repetición: Shell42/42+12/12, tipos/build0; Chromium156
actualización/retry/coldboot3escenarios; Flutter57/57 y analyze0; físico C3
focalizado1/1 y restauración normal0. Detalle y límites en
docs/evidence/cu22-local-inspection-20261107.md.

## [S1] Problem

CU27 ya acredita captura/inferencia/persistencia/sync reales, pero no demuestra las excepciones
de CU22. La revisión estructurada depende de una predicción exitosa y preparar PWA depende del
modelo. Hay huecos de almacenamiento/recursos y documentación TFJS superada, sin calidad validada.

## [S2] Design

### [S2.1] Reutilización y alcance

Conciliar nueve pasos y siete excepciones con referencias de código/evidencia por superficie.
Reutilizar cu27-20261105 y el registro real de conversiones; no repetir toda aceptación CU27.
La selección de orden por trabajo preparado satisface el paso 2, sin inventar un selector nuevo.

### [S2.2] Revisión independiente y manual

Contrato contracts/ai/local-inspection.md: inspectionReview separado de clientInference, disponible
sin modelo, notas humanas explícitas, persistencia y reapertura, sync de avance/foto sin análisis
ficticio. Migrations aditivas preservan datos/copia real v1; predicción/revisión anteriores intactas.
Preparar trabajo y recursos básicos no exige preparar IA. La preparación IA verifica persistencia del modelo en la caché offline,
no sólo su carga en RAM; faltar archivos no se anuncia como preparación exitosa.
Se mantienen Shell y Material 3 existentes, sin rediseño ni nuevas tipografías/movimiento decorativo.
Compose puede montar los artefactos autorizados ya preparados mediante overlay readonly
y guard de hashes frente a la imagen; no se empaquetan pesos ni descargan otros modelos.

### [S2.3] Fallos comprobables

Archivo inválido, resolución insuficiente, cabeceras que superan presupuesto, modelo ausente,
inferencia/alloc fallida, salida bajo umbrales experimentales y falta de espacio. Errores acotados
no dejan éxito falso, no pierden staging/borrador ni duplican el retry. No se simula capacidad
clínica o calibración; no se fuerza agotamiento físico del dispositivo. Puertos inyectables se
usan como dependencias arquitectónicas, no como APIs públicas de fallos de prueba.

### [S2.4] Verificación y cobertura

Primero pruebas estrechas de cada hueco y regresiones existentes de almacenamiento/sync;
después navegador real y Android autorizado si está disponible, sin borrar datos del teléfono.
Se etiqueta qué fallo fue inyectado frente a ejecución real, qué evidencia feliz se reutiliza y
qué queda sin verificar. Aceptación funcional y capacidad diagnóstica se registran separadas;
ningún banner/test funcional autoriza marcar el modelo validated ni cambia puntos por sí solo.

### [S2.5] Bloqueos de revisión C1–C3

Una actualización con modelo incompleto no elimina la última versión preparada usable
ni mezcla index/runtime/pesos de cachés incompatibles. La preparación explícita debe
reintentar atómicamente los recursos del modelo de la versión correspondiente, con
integridad verificada y sin URLs ni credenciales proporcionadas por el cliente.
La instalación básica/manual sigue siendo posible si no hay modelo previo usable.

La revisión humana pertenece a la imagen revisada: adoptar exitosamente otra fotografía
invalida su acknowledgment/etiquetas específicos, pero no borra el texto/minutos. Un
reemplazo rechazado o fallido al guardarse conserva la fotografía y la revisión anterior
completas. Requiere regresión con dos fotos, no sólo fallos sobre una foto inicial.

### [S2.6] Revisión efectiva y UX del recorrido

Si el revisor no devuelve dictamen tras una solicitud de cierre acotada, se realiza
revisión directa focalizada y se declara el método; no se usa indisponibilidad
como aprobación ni bloqueo indefinido. No se repiten pruebas ya aprobadas sin
un cambio afectado. Funcionamiento, calidad visual, calidad del modelo y licencia
se informan por separado.

Inspeccionar en pantallas reales agenda→ejecución→foto/cola de PWA y Flutter, con
evidencia antes/después, escritorio y teléfono. Resolver hallazgos prioritarios
observados de navegación, nombres, teclado/foco, contraste/tacto y estados. No
convertir guardado pending en confirmación del servidor ni usar UUID como etiqueta
principal cuando el propietario publica nombre/número. No borrar datos del móvil.

## [S3] Out of Scope

Reentrenamiento, datos nuevos, métricas nuevas, distribución de pesos restringidos, nuevos CU27
de transporte, rediseño global, cambios académicos ICONIX y promesa de diagnóstico profesional.

## Tasks

- [x] T1: matriz de nueve pasos/excepciones y referencias vigentes — acceptance: trazabilidad por superficie en evidencia CU22 (covers: S2.1).
- [x] T2: PWA manual independiente, fallos y conservación — acceptance: guardado/reapertura sin predicción, cuota real/retry único y preparación recuperable sin perder el modelo anterior (covers: S2.2,S2.3,S2.5).
- [x] T3: Flutter manual independiente, límites y conservación — acceptance: staging/revisión conservados sin éxito falso y acknowledgment invalidado sólo al adoptar otra foto (covers: S2.2,S2.3,S2.5).
- [x] T4: verificación focalizada, evidencia real y revisión — acceptance: resultados por plataforma sin inferir calidad validada ni replicar matriz completa CU27 (covers: S2.4, depends: T5,T6).
- [x] T5: cerrar C1/C2 — acceptance: actualización de caché fallida conserva versión usable y retry explícito misma versión recupera preparación/coldboot (covers: S2.5).
- [x] T6: cerrar C3 — acceptance: fotoB válida requiere revisión nueva; B rechazada/stagingfallido conserva revisiónA y archivo (covers: S2.5).
- [ ] T7: revisión efectiva y UX acotada — acceptance: dictamen explícito y capturas reales inspeccionadas antes/después de los cambios prioritarios; cuatro dimensiones separadas (covers: S2.6).
