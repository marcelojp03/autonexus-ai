# Traspaso — entorno reproducible local (2026-10-29)

T25 verificado y revisado en la rama personal `work/marcelo`, base de integración `df91374`, correcciones finales `71108ad`. Sin otra rama/worktree. El cierre FF/push autorizado y sus referencias observadas se registran en STATUS después de ejecutarlo.

## Entrega

Compose raíz con servicios reales O/E/F/BFF/web, PostgreSQL por propietario/IdP y RabbitMQ; solo web en loopback. Builds dentro de Docker con versiones/digests/locks, bootstrap/migraciones propios, secretos por consumidor y demo opt-in con ledger conservador. Identidad pública exacta bajo `/identity`, JWKS/admin internos separados y GraphQL único sin abrir REST empresarial. README público y guías local/cloud con límites honestos; ningún recurso cloud desplegado.

Guía vigente: [Docker Compose](../deployment/local-compose.md). Decisión: [018](../decisions/018-local-compose-demo.md). Especificación: [local-compose-demo](../compose/spec/local-compose-demo.md). Evidencia técnica: [STATUS](../context/STATUS.md). No exportar cuentas ni estado privado a estos documentos.

## Evidencia

- Copia pública fuente21bbcd8, sin herramientas/builds/secretos host; proyecto `autonexus-clean-verified`, puerto4282, volúmenes nuevos. Arranque/demo PASS en320,363s con caché, no build en frío.
- Chromium real A/B/jefe y Angular→React→Angular PASS, cero consola/página/red/HTTP/transporte. Repetición tras editar cliente, reinicio de diez contenedores y recuperación de la misma Saga PASS; credenciales y efectos únicos preservados.
- Siete archivos `infra/local/*.test.mjs`: 46 PASS, 2 omitidas en Windows, 0 FAIL. Regresión del contexto Docker real rojo→verde con archivos sintéticos. Empleados188+86, BFF141+34, Finanzas5HTTP/46aserciones PASS en regresión previa; Compose config y diff --check PASS.
- Diez contenedores: muestra estable1457MiB/24,76%CPU; máximo observado1836MiB/522,95%CPU sobre26muestras en89,366s con reinicio O; salud final restaurada. Excluye daemon/build/otros proyectos y no garantiza máximo absoluto.
- Revisión independiente general-50 detectó C1/C2/N1; re-revisión independiente general-51 aceptó sus correcciones, sin nuevos bloqueantes. Fallos históricos y datos saneados conservados en `output/stack` (ignorado), no copiados a Git.

## Continuidad y límites

**CU05 G2 visual sigue bloqueado.** Ningún canal entregó píxeles inspeccionables al modelo; mensajes de apertura y capturas generadas no acreditan contraste, recortes o foco visible. Las capturas enmascaradas1440/390 están en `output/stack/t25-browser-fresh-01-evidence/`; requieren revisión humana o canal visual real. Ver [traspaso CU05](2026-10-29-cu05-review.md). No declarar CU05 completo ni cerrar T24.6/T24.6.3 por el cierre de T25.

El entorno de aceptación con puerto4282 continúa saludable; se conserva también el primer proyecto de prueba y los entornos legacy. No eliminar volúmenes, rotar credenciales ni ejecutar down -v/prune. Las fechas demo son la fecha inicial de La Paz+7 congelada: seleccionar ese día, no reprogramar silenciosamente. No se acredita offline, Flutter, IA, CU16/CU17, lectura humana de notificaciones, producción/HA ni conexión remota administrada.
