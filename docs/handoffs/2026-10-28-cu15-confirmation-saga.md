# Traspaso 2026-10-28 — CU15 verificado y revisado

## Estado de código y alcance

Rama personal reutilizada work/marcelo; base publicada 0fc8f7f. Implementación 69de9bd; correcciones verificadas/revisadas bdf75fa5c5beb5be5116a52a0179f719d9b6bfc7. No se creó otra rama ni worktree. Cierre técnico aprobado; integración/push normal de main y work/marcelo autorizados, pendientes de comprobar antes de acreditar publicación.

CU15 online: Operaciones orquesta Saga durable; Empleados reserva/confirma/libera con exclusión y revalidación; Finanzas crea/cancela vínculo durable/versionado conservando cotización y aprobación. Cambio + ledger + auditoría + Outbox por transacción local; RabbitMQ con confirms/mandatory e Inbox deduplicado. BFF delega, no coordina. Aprobar no confirma. Permisos confirmations:read/write, catálogo de 23.

Políticas: mechanicEnabled laboral explícito, default false, sin roles/identidad automáticos; especialidad registrada elegida; intervalo de un día La Paz; vigencia inclusiva al autorizar; sin TTL de reserva. Tokens técnicos/browser solo RAM, iniciador auditado sin token persistido. Timeout/GET404 son incertidumbre, no rechazo.

## Verificación y revisión

- Operaciones: 120 pruebas y package PASS; regresión rojo/verde de normalización/protocolo y proyección.
- Empleados: 144 unidades + 11 HTTP, tipos/build; Finanzas 24 pruebas/113 aserciones y lint29; BFF54+15, tipos/build. Dobles no se usan como evidencia de integración.
- Confirmación Angular45, sesión19 dentro de28Shell; tipos/ESLint/build/staging PASS.
- Navegador feliz6etapas y C2/C3 real6/6: petición abortada antes de registro, reload404, replay manual idéntico, una Saga/efectos, limpieza terminal/logout con wizard desmontado, sin JWT/fallos inesperados.
- Unicode real: NBSP/FEFF/U3000 normalizados antes de freeze, huellas O/E idénticas y Saga confirmed.
- G1 real10/10: revisión financiera contra aprobación/vínculo; reserva/confirmación E contra inhabilitar/desactivar/jornada/ausencia; waiters SQL observados, nueve limpiezas/replays y postcheck íntegro.
- Matriz corregida7/7 + ambos estados de navegador PASS, exit0: concurrencia, rechazo/liberación, respuesta perdida, reinicio, compensación inicialmente fallida/recuperada y Outbox duplicado con efecto único.
- Regresión API/BFF CU01/CU02/CU03/CU04/CU11–14: 10/14/6/11/6 PASS.
- OpenAPI 9/31/7 operaciones, 74/147/53 referencias, PASS; escaneo de publicación sin hallazgos en los dos commits de código, renovable tras cada cierre documental.

Revisión independiente inicial no aprobatoria (C1–C4/G1). Re-revisión de 69de9bd..bdf75fa aprobatoria, objeciones retiradas y sin críticos residuales; no se acredita integración/push por ese dictamen. C4 se verificó con regresión focalizada/código, no con inyección real de protocolo incompatible. Las carreras prueban los intercalados observados, no todos los posibles.

Artefactos ignorados en output/cu15/: review-distributed-real-07.exit=0, distributed-2026-10-29T01-43-46-062Z-295b0153.json, review-distributed-final07.json; review-recovery-web-02.exit=0 y recovery-web-real-2026-10-29T01-39-51-287Z-b671961b.json; g1-boundaries-real-02.exit=0 y boundaries-b0924291-9da3-4031-9b15-2b09c2b89493/{result,postcheck}.json; review-unicode-real.exit=0 y unicode-real-1793237617193.json. Capturas desktop/mobile bajo output/playwright/. Comandos reproducibles y modos de fallo: scripts/cu15/README.md. Fallos inyectados identificados, intentos fallidos previos conservados.

## Runtime local y datos

Al último postcheck: Operaciones PID33240, JDK21/JAR del worktree personal, listener único8081, DIRECT Empleados3002/Finanzas8000 y readiness200UP; flag sintético restaurado. Shell4200/BFF3004/Keycloak8180/RabbitMQ5672 conservados. Los PID son volátiles: validar metadata, CIM y listener antes de detener. No competir con otro proceso.

Migraciones reales aplicadas E1793455200000, F2026_10_28_000002 y O V7. Brokers/identidades técnicas provisionados con privados de raíz, sin reinicializar bases/volúmenes ni regenerar credenciales. No versionar logs, artefactos, .env, .local ni tokens. Sintéticos conservados con historia; compensaciones solo liberan/cancelan recursos propios, no borran aprobaciones.

## Continuidad

Lectura mínima: AGENTS raíz/locales, docs/context/{PROJECT,STATUS,CONTEXT-MAP}.md, docs/compose/spec/cu15-confirmation-saga.md, docs/decisions/016-cu15-confirmation-saga.md, contracts/rest/saga.md, contracts/rest/staffing.md, contracts/events/cu15.v1.md y contratos de órdenes/cotizaciones.

Próximo paso administrativo: FF a main desde raíz, push normal exacto de main y work/marcelo, ls-remote para ambos SHA; después actualizar entrega/publicación y cerrar T8. No force, no --all/--tags, no PR, no borrar ramas/worktrees.

Siguiente entrega funcional: CU05 con órdenes/asignaciones reales e identidad del mecánico. No se implementa ahora ni se acredita su alcance offline/Flutter; tampoco ejecución física, cobros, fotos/S3 o lectura humana de la notificación.
