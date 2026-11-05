# CU27 — aceptación funcional PWA/Android/S3; cierre y continuidad

Rama personal `work/marcelo`, worktree existente `.worktrees/work-marcelo`, base/HEAD
`ec43d635812715d86682c45809bfcc9b7253f72d`; incremento aún sin commit/integración/publicación.
Main conserva su estado anterior. Mantener cambios locales ajenos (pyproject/uv.lock, diagnóstico
Java y probe Android), privados y todos los volúmenes. No crear otra rama/worktree.

## Observado

- S3 CU16 recuperado: perfil local personal `default`, bucket `autonexus-ai-evidencias`, `us-east-1`,
  montaje de credenciales solo en Operaciones y solo lectura. Sin cambio CORS ni recursos cloud.
- Origen canónico actual `http://127.0.0.1:4286`, issuer `/identity/realms/autonexus`, redirects
  Shell y configuración de consumidores coherentes, secretos/subjects preservados y respaldo privado.
- Exportación UI4285/importación UI4286 con mismo perfil y cuenta, sin sembrar IndexedDB.
  Foto original `703a26f5-5c52-4500-88c4-4dc41ebae813` aplicada: S3 real, evidencia disponible,
  análisis cliente MS04 y revisión humana preservada. Reapertura offline/segundo sync sin efectos.
- Nueva foto PWA `ecdf5f47-7c49-4e0f-aaf4-6c6de659a7d4` rechazada por owner403 dentro de push
  exitoso, retenida. Rutina real restauró mecánico y retiró asignación auxiliar en finally, con
  PKCE nuevo y recuperación comprobada. Rol auxiliar de fixture quedó sin asignación.
- Expiración AWS403, `needs-reupload` por objeto ausente y misma evidencia disponible en intento3
  se registran separadamente. El verificador inicial falló por `headersJson`/`headers`; el resumer
  reprodujo causa y completó PUT200/confirmación sin nuevo avance/evidencia. No fusionar los reportes.
- Shell104 PASS, tipos/build de imagen exit0; tooling50 PASS. APK público issuer4286 build exit0,
  no instalado. Carrera de cambio de cuenta al importar reproducida en rojo y corregida.
- Smoke final del bundle/worker actuales exit0: cuatro filas y ambas fotos intactas al reabrir
  offline, cero llamadas identidad/API. Revisión independiente focalizada general-78 sin defectos
  accionables confirmados en el delta parcial; no certifica runtime/AWS ni CU27 completo.

Evidencia y límites completos: `docs/evidence/cu27-20261105.md`; spec vigente
`docs/compose/spec/offline-sync.md`, decisión024 y `contracts/sync/README.md`.

## Continuación física completada

El usuario liberó el A3. Foto/S3/MS04, respuesta aceptada perdida y rechazo403/restauración se
completaron por UI real. La recuperación de resultado en Flutter requirió un fix con dos
regresiones rojas/verdes; Flutter39 PASS, analyze/build/install conformes; herramientas66 PASS.
Reportes principales: `mobile-photo.json` PASS y `mobile-device-recovery-ui.json` pass=true;
los informes iniciales parciales/fallidos se preservan y explican en la evidencia.
Red y roles restaurados; forward9222 retirado. No hace falta más interacción con el A3 para
estos criterios. La revisión visual comparada sigue diferida.

Revisión final general-81 concluida sin defectos accionables confirmados; spec finalizada.
Próximo: commit, auditoría de publicación, FF a main y push normal exacto de main/work/marcelo, confirmando SHA remoto.
Luego iniciar MCP de consulta y n8n sobre órdenes/agenda/avances, sin esperar cobros/indicadores.

## Historial del bloqueo inicial (ya superado)

Esperar que el teléfono esté libre en AutoNexus. Se pausaron acciones táctiles al observar otra
aplicación en primer plano; no tomar control de ella. Dispositivo Mi A3 `ff77c09b1c12`, paquete
`bo.edu.uagrm.autonexus.autonexus_mobile`. Cuando esté disponible: instalar APK actualizado sin
borrar datos, configurar reverse4286 y conservar reverse8081/3005, PKCE nuevo; completar foto
desde UI, pérdida de respuesta después de aceptación real y rechazo propietario con restauración.
`scripts/cu27/mobile-loss-proxy.mjs --force-stop` exige UUID real creado por UI y verifica MS05
y exactamente un avance propietario antes de cortar; restaurar reverse3005 original y comprobar
reapertura/reintento. No acreditar ejecución del harness solo por sus cinco tests puros.

La fixture sintética administrativa está en `output/cu27/fixture/` (privada, no imprimir). Renovar
`provision-test-admin.mjs --verify` antes de otra revocación, porque la restauración creó una nueva
asignación. No usar el preflight viejo ni credenciales personales como autoridad.

Runtime Compose pertenece al proyecto `cu16-proof` y conserva la ruta raíz como
`--project-directory`. Sus overrides privados existentes son
`output/stack/cu16-compose-s3.yaml` (montaje AWS solo Operaciones) y
`output/cu27/runtime-verification.private.yaml` (modelo local solo lectura en web), con
`output/stack/cu16-s3.private.env` y `WEB_PORT=4286`. No sustituirlos con defaults de otro origen
ni ejecutar `--remove-orphans`: MS05/emulador existen en el proyecto aunque el Compose de main
anterior aún no los enumera. No recrear Operaciones sin preservar el override S3.

No repetir `resume-pwa-photo.mjs --verify` después de la prueba de rechazo: sus cuatro fases
originales verifican exactamente tres filas y el perfil tiene ahora cuatro. No ejecutar un sync
general para probar el arranque offline. Mantener todos los informes parciales/fallidos.

La integración/push normal main+work/marcelo se realiza solo después de aceptación funcional
completa (ya observada) y revisión focalizada final. Luego seguir con MCP de
consulta/n8n sobre órdenes, agenda y avances, sin esperar cobros ni indicadores.
