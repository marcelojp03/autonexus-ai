# 023 — CU27: entrada offline del Shell y recuperación durable

Fecha: 2026-11-05. Estado: implementación parcial verificada en work/marcelo, sin integración en main. Alcance autorizado: continuar funcionalidad móvil/PWA sin esperar revisión visual; no ampliar autoridad cloud ni completar CU27 sin evidencia.

## Decisión técnica

- El Shell ofrece offline.html como entrada propia. En arranque sin red no inicia Keycloak ni monta una gestión online como si tuviera sesión; consulta únicamente la copia preparada del usuario local. Al reconectar, descargar/sincronizar requieren PKCE y la identidad vigente. El subject local delimita datos, no concede autorización de servidor.
- El build produce una allowlist versionada con SHA-256. El worker solo captura recursos estáticos propios: documento offline, bundle/CSS, runtime TFJS local, modelo/pesos y manifiestos. Instalación incompleta o integridad fallida no activa la versión nueva. OAuth, GraphQL/APIs, querystrings, Authorization, métodos no-GET y orígenes ajenos pasan sin caché.
- runtime-config.js es generado por el despliegue y no puede validarse con su hash de build. Solo el documento offline sustituye ese script por configuración pública estrictamente same-origin. El index normal mantiene su cargador de configuración.
- IndexedDB conserva trabajos y cola por subject, con Blob/hash/inferencia/revisión y sobres inmutables por etapa. La promesa de escritura espera el commit de la transacción; un enqueue duplicado no reemplaza la operación previa. Un cambio de cuenta oculta la copia anterior; descartarla y cerrar sesión requieren advertencia cuando hay pendientes.
- Una captura del borrador junto a epoch de sesión impide que un cambio de cuenta durante el hash cree silenciosamente una operación sin fotografía o con revisión de otra cuenta. El servidor sigue verificando permiso y registro; no se infiere autorización desde esta comprobación de cliente.
- La web usa los campos GraphQL del BFF para registrar, consultar y empujar MS05. El único transporte fuera de GraphQL es PUT binario con la autorización de Operaciones, sin bearer ni credenciales AWS. El resultado firmado es efímero, y el lookup durable devuelve resultJson saneado y el overlayId original.
- Cada etapa persiste su operationId, overlay y cuerpo antes de la petición. Tras una respuesta perdida se consulta/reanuda el sobre original. Una confirmación usa expectedVersion de la evidencia; no la de ejecución. La cola no se marca aplicada hasta terminar los pasos requeridos. El modelo conserva origen de cliente y revisión humana independiente.
- El modelo de PWA se prepara desde el artefacto local autorizado mediante prepare-offline-model.mjs. Archivos binarios y perfiles no se publican en Git. Sin preparación, el build declara modelReady:false, no una capacidad visual vacía ni validada. Una inferencia real local no demuestra calidad de diagnóstico.
- MS04 ofrece Dockerfile.test y requirements-test.txt como entorno de pruebas limpio compatible con el runtime declarado, separado del venv manual y de pyproject.toml/uv.lock locales preexistentes. No se promete reproducibilidad bit a bit de transitivas o de una imagen base por etiqueta.

## Evidencia y límites

La verificación por superficie se conserva en docs/evidence/cu27-20261105.md. Móvil y PWA probaron login/lectura y persistencia offline con inferencia real. La PWA verificó además pérdida de respuesta de un push real textual y creación única tras reapertura. El envío fotográfico sigue bloqueado por configuración S3 ausente y no acredita persistencia real del análisis en MS04. El rechazo por permiso requiere un setup administrativo reversible aprobado para el realm aislado. La revisión visual comparada permanece diferida.

No se borraron colas, no se reinicializaron bases/volúmenes, no se creó infraestructura AWS y no se integró esta entrega parcial a main.
