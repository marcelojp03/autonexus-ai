# Continuidad técnica — CU22, Finanzas y ejecución local

Fecha2026-11-08, work/marcelo. No documentación académica ICONIX.

## Publicado y alcance

Última publicación: Finanzas/arranque/documentos `fb27230` y UX operativa
PWA/Flutter `aed5dd9`, revisiones147/149; FF main y push normal main/work/marcelo
con SHA remotos comprobados. Auditorías97/13rutas sin hallazgos. Sólo parcial:
visual/pantalla física de appnueva pendientes, no puntos nuevos. APKnuevo
compilado sin instalar; forward temporal9222retirado, reverses de app conservados.
No pruebas/builds/actores de implementación pendientes. Cuatro archivos ajenos
preservados. Seguir CU25/CU26 por APIs financieras reales sin cerrar UX pendiente.

Core funcionalCU22 publicado en `cc32551`, main/work/marcelo y remotos confirmados,
auditoría36rutas sin hallazgos. Revisión directa focalizada autorizada y declarada
tras revisor cancelado sin dictamen; no independiente. Predicción/revisión
separadas, manual sin IA, fallos/conservación, foto nueva invalida revisión,
recuperación de modelo/worker. Pruebas anteriores conservadas sin repetir por
rutina: Shell42+12, Flutter57/analyze0, Chromium3escenarios y físicoC3 previo1.
PLAN mantiene57/19/26: CU22 global parcial por modelo/licencia y UX nueva abierta.

## Docker y documentos estabilizados

No se reinició Docker Desktop: los dos contenedores atascados desaparecieron y
sonda propia --rm terminó0. Sólo AutoNexus estaba activo. Inventario privado de
Compose/overrides/volúmenes en output/recovery, sin secretos publicados.

Traslado `b427f814-73ba-42ed-97ee-1090709cd852` committed,3documentos/487bytes.
Prepare/commit0; oráculos antes/después de recreación3/3, metadatos/historia/
versiones/SHA/MIME y8tablas monetarias conservadas. Descarga autorizada y
binario BFF con hash idéntico, mecánico403. No se cambiaron IDs para retry.

Finance y proveedor definitivo se recrearon coordinadamente; MinIO usa
`cu16-proof_finance-documents-minio-data`. n8n/publicador restaurados. Se retiró
sólo el contenedor de preparación detenido, sin -v. Volumen histórico
`cu16-proof_finance-documents-data`, perfil anterior y backup privado conservados.
No reinicializar ni borrar bases, documentos, colas o volúmenes.

La firmaS3 tenía MIME duplicado por capitalización/fusión de cabeceras; fix
normaliza cabecera wire después de firmar canónico. Regresión1/10aserciones y
imagen header-fixed0, ya en Finance local. No repetir esa prueba sin tocarla.
Status del traslado usa Finance actual, no el ancla retirada:
`node scripts/finance/relocate-document-storage.mjs status` observó
committed/allNew,3nuevos,0inesperados,cobertura3/3; nueva regresión1/1.
No volver a ejecutar prepare/commit para consultar el resultado final.

## Entrada local y disponibilidad

`infra/local/run.mjs` coordina check/up/status/stop de instalación existente,
default cu16-proof centralizado. Archivos Compose se validan por separado para
plataforma y n8n, pero ambos pertenecen al mismo proyecto. Guardas de ownership,
namespace Finance/MinIO, montajes anónimos heredados y rutas Docker Desktop.

15/15 unidades del coordinador, check real0. Reanudación real por IDs existentes0:
17activos y mismos contenedores/imágenes/montajes/puertos/bytes privados; sin
otra plataforma. No se acredita instalación limpia ni parada/arranque frío.
Env n8n existente preservado en output/stack/n8n.private.env, no regenerado.

Readiness global **no** cerrada: Mongo unhealthy por probes4s; ping autenticado
real pasó con diagnóstico17s total y0escrituras. No se ocultó el estado ni
recreó Mongo. Primeros intentos Compose up/start fallidos no cuentan como PASS.

## UI y trabajo pendiente

### Actualización vigente de continuación

Último estado: web3c6abd4a26b6 construido/servido con manifiesto de esa imagen;
Financece731be00838 y MinIO recreados conservando12digests de tablas, todos los
documentos/metadatos/versiones/historia y4/4bytes/hash available; mismos env/
montajes/volumen, escritores restaurados. Check de entrada oficial actual0 y
servicios con healthcheck healthy. No repetir traslado/firma.

Revisión147 encontró2fallosP2 ahora corregidos: lookup read O write propio
separado del retry write, y recuperación de verificación humana no consumida
para misma persona/vínculo/orden/medio/importe/referencia. PHP3/72PASS; API real
recupera mismo registro/replay, otro importe409 y dinero intacto. React42/42
PASS en Linux aislado/fuentes readonly; Windows startup fallido no es PASS.
Browser del build3c6: gasto real aplicado/respuesta perdida conciliado una vez
con proyección UI read-only controlada (no revocación propietaria real).

PWA: draft-binding-before-served3 reproduce cruce A→B en1440/390; after-served
confirma cancelar conserva A/materiales y descarte explícito limpia antes de B.
Copias locales sintéticas,0mutaciones/0avances en cola, no aceptación propietaria.
Node10regresiones/tipos0. Flutter31tests afectados/análisis0/APKdebug0; no
instalado aún. Revisión149focalizada terminó conforme para publicación parcial,
sin defectos concretos nuevos; ambos hallazgos147cerrados. No comandos de
verificación pendientes. Publicar en incrementos sin cerrar UX global.

Teléfono: app previa abierta sin limpiar datos, login abrió Chrome pero4pestañas
nativas viejas y timeoutCDP impidieron identificar destino visible con seguridad.
No se cerraron pestañas, llenaron credenciales ni usó otro dispositivo. Recorrido
físico nuevo y conformidad visual abiertos. Ver offline-workspace-ux-20261108.
No puntos adicionales ni CU25/CU26 financiero todavía. Párrafos inferiores históricos.

Imagen web783c28903e24 terminó build0, ya servida con overlay/manifiesto de esa
misma imagen; no reconstruir por rutina. `web-ux-deployment.json` registra
contenedores antes/después. Fixture incierto conciliado por la misma intención,
WO-2026-000008. Logs ledger-ux-payment-real/expense-real/denial-real exit0:
5/5/1etapas de cobro íntegro, parcial inline/foco, respuesta aplicada perdida
y retry mismo ID/comprobante, gasto/documento/hash, duplicado explícito y
conciliación entre pestañas. after-served8estados sin pageErrors/overflow;
pwa-ux-after-served2capturas, sin escritura de cola ni servidor.

Node coordinador/preparación/traslado31/31 frescas. React Vitest sigue sin
iniciar worker,0pruebas: no PASS. Revisor independiente del delta activo;
esperar su dictamen y corregir antes de publicar. No pruebas pesadas activas.
Docker actual sin removing/cargas ajenas activas, servicios healthy; config-init
histórico Exited1 conserva su fallo. No reinicio global ni nuevos traslados.

El teléfono autorizado ff77c09b1c12 volvió a aparecer device por adb devices;
otro teléfono no se usó. Herramienta view_image sólo devolvió metadatos: no
conformidad visual. Los párrafos siguientes describen pendientes históricos;
no relanzar build/fixture por ellos. Nuevos riesgos de UX operativa identificados
en fuente, aún sin implementar: borrador/foto compartidos al cambiar trabajo
PWA, preparar ejecución no-in-progress en Flutter y formulario con datos
plausibles precargados. Resolver en incremento separado, sin repetir CU22.

Finanzas: baseline real1440/390,6PNG y validación local, sin mutaciones ni
pageErrors; PNG no inspeccionado visualmente porque view_image sólo devolvió
metadatos y dos modelos de visión fallaron por API. No cerrar UX por DOM/tests.

Cambios preparados: controles44px, contraste primario compartido con Shell,
foco primer error, saldo íntegro inline, IDs de responsable/pago secundarios
sin inventar nombres. Lint/build integrado actual0; Vitest nuevo no inició
worker y no tiene PASS. Imagen web `cu16-proof-web:ledger-ux` en construcción,
log/exit `output/cu27/web-ledger-ux-runtime-image.*`; no relanzarla a ciegas.
Después preparar/stagear Shell y manifiesto offline coincidente con imagen,
verificar guarda y servir esa imagen conservando overlay/modelo autorizado.

Nuevo fixture `--label=ux-20261108` conserva operación/cuerpo en
output/finance/cu19/web-fixture-ux-20261108.json. POST customers tuvo resultado
incierto; conciliar/repetir exactamente esa intención antes de avanzar. No crear
otro fixture ni asumir rechazo. Faltan cobro/gasto del build nuevo y review final.

PWA: overflow390→411 medido, reproducido en HTML/CSS fuente y corregido con
grid minmax/min-width0. Regresión nueva1/1 en320/390/1440, sin repetir CU22 feliz.
Falta antes/después servido e inspección visual; no aprobado por métricas.
Teléfono autorizado ff77c09b1c12 ausente: no usar otros conectados sin permiso,
no limpiar datos/instalar fixtures por rutina. Flutter UX nueva no aceptada.

CU19/CU20/entrada y cambiosUX posteriores a cc32551 siguen sin publicar;
CU25/CU26 ampliados aún no implementados. Sus fuentes financieras son ledger
real payments/expenses/financial-summary, nunca quotes como ingreso. Consultas
administrativas por Empleados; minutos declarados/plan/estimación separados,
no productividad por conteos. Continuar por incrementos y revisar/publicar
normalmente, sin cambios de puntos por capacidades no aceptadas.

## Lectura mínima

- docs/compose/spec/{cu22-local-inspection,financial-ledger,assistant-reports-events}.md.
- docs/evidence/{cu22-local-inspection-20261107,cu19-cu20-20261108,cu25-cu26-acceptance-matrix}.md.
- contracts/rest/financial-ledger.md y contratos GraphQL/AI afectados.
- docs/context/STATUS.md y PLAN.md; conservar archivos ajenos sin trackear.

No repetir CU28 ni sus pruebas de negocio. Sólo regresiones afectadas por
cambios reales; los actores y verificadores fallidos no equivalen a aprobación.
