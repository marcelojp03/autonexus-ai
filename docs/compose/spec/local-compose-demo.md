---
feature: local-compose-demo
status: designed
updated: 2026-10-29
source: work/marcelo
---

# Entorno local reproducible — Docker Compose, demo y README público

## Report

## [S1] Problem

El repositorio funcional hasta CU15 depende de herramientas/artefactos del host y tres Compose locales separados; el README raíz contiene estados históricos e instrucciones para agentes. El Dockerfile heredado de React usa npm/package-lock y un dist distinto al actual pnpm/integrated. Un compañero no puede reproducir todo desde una copia limpia solo con Docker/Compose.

Diseño y políticas aprobados explícitamente por el usuario en esta sesión; implementación secuenciada después de CU05 y su recorrido real. No pedir nuevas confirmaciones para decisiones rutinarias cubiertas. T25 se implementa en la rama personal/worktree work/marcelo existente, preservando CU05 (T24) y entornos/credenciales/volúmenes actuales. Base df91374. No crear rama por tarea ni ejecutar los scripts locales de ownership/provisión contra los recursos actuales como sustituto del nuevo entorno aislado.

## [S2] Design

### [S2.1] Superficie pública del README

README raíz de producto: AutoNexus AI, propósito real de gestión de un taller, UAGRM, Ingeniería de Software II y Grupo26. Confirmado expresamente por el usuario: no publicar carrera (equipo multicarrera) ni integrantes. Nombre de docente no suministrado: no inventarlo. Presentación cuidada con título/subtítulo, badges de tecnologías realmente incluidas, recorrido de uso, diagrama compacto si ayuda y enlaces a guías. No badges ficticios de CI/cobertura/producción ni capacidades IA/offline no entregadas.

Fuente explícita de esta sesión, respuesta a la pregunta de datos del README:

> Carrera no pongas ya que somos de carreras diferentes. Somos el grupo 26. No pongas integrantes. UAGRM está bien, Ingeniera de software II esta bien.

La aprobación posterior exige usar esos datos solo con confirmación expresa; la cita anterior es esa confirmación. No deducir datos desde otros proyectos, el username Git o el reparto anónimo.

Características implementadas y stack vigente, requisitos Docker/Compose, preparación mínima, acceso web/cuentas privadas, inicio/parada segura y límites. Retirar de la portada estados históricos, commits, resultados de pruebas e instrucciones para agentes. Conservar el README anterior como antecedente técnico claramente marcado en docs/archive/ y enlazar la documentación técnica pertinente, sin presentar sus instrucciones antiguas como vigentes. Redactar comandos públicos únicamente después de observarlos funcionar.

### [S2.2] Topología aislada y entrada raíz

Crear compose.yaml y .dockerignore raíz. Nombre de proyecto configurable, redes/volúmenes project-scoped, sin container_name ni nombres globales de volumen que reutilicen accidentalmente los existentes. Propuesta de nombre local distinto a los tres entornos actuales; aceptación con identificador independiente. No detener, reconfigurar ni borrar recursos ajenos. Ningún down -v, reset, purge o prune al arrancar.

Servicios reales: PostgreSQL de aplicaciones con bases/roles separados O/E/F; PostgreSQL de IdP; Keycloak; RabbitMQ; Operaciones; Empleados; Finanzas; publisher financiero; BFF; web Shell con los tres MF implementados. One-shots reales de preparación/migración/provisión y perfil demo/test explícitos. No contenedores ficticios de Inteligencia, Sincronización, MCP, n8n o MF04.

Por defecto publicar solo web por loopback/puerto configurable. APIs, bases, broker y health/administración permanecen internos; exposición diagnóstica opcional y explícita. La aceptación usa un puerto libre diferente de los actuales. Preparación/servicios no deben requerir Git, Java, Node, PHP ni builds en el host; origen del código por copia/clone/archivo, no inferir rutas con Git en runtime.

### [S2.3] Configuración pública, DNS e identidad

Un único acceso web. Keycloak público bajo /identity, conservando /auth/callback para PKCE del Shell y evitando colisión de rutas. Propuesta: PUBLIC_ORIGIN validado o calculado desde host/puerto públicos; WEB_PORT configurable sin editar código. Nginx enruta /identity, /graphql y APIs necesarias con prefijos explícitos, preservando rutas/headers/redirects; DNS interno de servicios Compose, sin network_mode:host.

Issuer público único y exacto = PUBLIC_ORIGIN/identity/realms/autonexus. Keycloak26.8.1 con hostname/relative path/proxy-headers configurados de acuerdo con su documentación; management health con ruta propia explícita, no expuesta por el proxy público. APIs verifican iss exacto, firma RS256, audiencia propia, exp/nbf/sub/typ y scopes según contratos. JWKS interno independiente configurado de forma confiable para contenedores; nunca derivado de claims/token/usuario. No desactivar autenticación, hostname/issuer validation ni usar CORS comodín para resolver DNS.

Separar URL IdP administrativa/token interna, issuer navegable y redirects/logout/origins exactos. Mantener clientIds/audiencias/scopes actuales; coordinador CU15 separado con siete scopes E/F y sin realm-management. El cliente de gestión IdP de Empleados sigue separado y no se comparte con navegador/BFF/coordinador.

Configuración pública runtime central para Shell/Angular/React: solo endpoints públicos y datos OIDC no secretos, cargados antes de la sesión. Conservar defaults de desarrollo existentes cuando no se proporciona configuración; las nuevas URLs/orígenes deben validarse explícitamente, sin aceptar credenciales/fragmentos ni valores procedentes de la petición. Binds de contenedor configurables a 0.0.0.0, con exposición host loopback; conservar defaults locales actuales. Contratos GraphQL dentro de la imagen BFF, incluida agenda CU05.

### [S2.4] Builds multietapa reproducibles

Dockerfiles de O/E/F/BFF/web con contexto raíz donde importaciones compartidas lo requieren. Fijar imágenes compatibles verificadas y registrar sus versiones/digests reales; no inventar tags. Usar versiones/lockfiles existentes: Node22.22.3/pnpm12.6.0; Maven Wrapper3.10.0/Java21; composer.lock Laravel12.70.2/php-amqplib3.7.4 y PHP compatible ya probado. No actualizar dependencias para facilitar Docker sin causa y prueba.

Instalaciones frozen de pnpm y Composer bloqueado, preservando .npmrc/workspaces/patches de Angular. Resolver el Dockerfile React heredado: pnpm y salidas standalone/integrated correctas, no asumir npm ci compatible ni copiar dist equivocadamente. El build integral compila ambos Angular integrados, React integrado y Shell/staging dentro de Docker, manteniendo single-spa, bases/assets, MIME, rutas y sesión. No copiar dependencias/builds del host.

Runtime separado de compilación: solo artefactos y dependencias productivas necesarias, migraciones/contratos requeridos y entrypoints; nada de .git, .worktrees, .env reales, .local, outputs, dumps, datasets ni secretos en contexto/capas. Publicar solo recetas/targets que se verifiquen y documentar qué modos fueron comprobados. Imágenes finales con usuarios/permisos adecuados y señales/ciclo de vida correctos.

### [S2.5] Secretos, bootstrap, migraciones y provisión

Generar configuración privada una sola vez en volúmenes/archivos privados fuera de capas. Separar por propietario/consumidor: runtime de cada servicio solo monta sus secretos; web/BFF no acceden a credenciales de bases ni administración IdP/broker. Bootstrap confiable one-shot accede a lo necesario para preparar; no montar socket Docker en las aplicaciones. Reejecución verifica/preserva secretos, nunca los regenera ni imprime. Exportación de cuentas a archivo privado ignorado explícita y no sobrescrita silenciosamente.

Orden: configuración privada → PostgreSQL/IdP DB/broker saludables → bases/roles propietarios → Keycloak realm/clientes/audiencias/usuarios de preparación e identidades técnicas → topología Rabbit/identidades por productor → migraciones E/F y Flyway O → APIs/workers → BFF/web → demo opt-in. depends_on con condiciones reales de salud/finalización y reintentos acotados; nada de sleeps como evidencia de readiness.

Migraciones son propias y repetibles, sin synchronize/fresh/reset/clean destructivo. Bootstrap de bases no inserta estados de negocio. Si un proveedor remoto ya aprovisiona bases/roles, separar esa precondición administrativa de migraciones de runtime y no usar superusuario en aplicaciones. Los entornos locales antiguos no se copian ni se migran implícitamente.

### [S2.6] Procesos y salud CU15

O ejecuta worker Saga y publisher/consumer al habilitar CU15; E publisher/consumer en lifecycle; F tiene publisher separado con la misma imagen y comando cu15:publish-outbox --loop. F no consume CU15: no añadir un Inbox ficticio. Todos usan endpoints/secrets internos correctos y proceso recuperable; broker provisiona colas/exchange/DLX/bindings/permisos necesarios.

Healthchecks distinguen vida/disponibilidad SQL y conexión de dependencias; no afirmar que HTTP200/BFF ready demuestra entrega de eventos. Verificar workers por efectos reales Outbox/Inbox y un smoke de recuperación después de reiniciar el coordinador del proyecto aislado. Mantener configuración de reintentos/leases/fencing y semántica de timeout; no rehacer Saga ni repetir su matriz completa sin cambios de lógica. Si el cambio toca el protocolo/algoritmo, ampliar proporcionalmente la verificación y declararlo.

### [S2.7] Seeds demo explícitos y conservadores

Separar migraciones/bootstrap, seed demo y fixtures de pruebas. Demo solo con perfil/modo local explícito y guard de ejecución; el arranque vacío no crea datos de muestra. Cuenta administrativa inicial/configuración privada para preparar el modo vacío; las cuentas demo se documentan por rol/etiqueta y se exportan en privado, no como contraseñas públicas. Ninguna credencial cambia al repetir o reiniciar.

Manifest/ledger durable del escenario con claves y operationIds estables, comandos de creación congelados y lookup/replay antes de efectos. Relaciones coherentes por APIs: empleados/identidades/roles/jornadas; cliente/vehículo/catálogo; recepción/orden; cotización/decisión; confirmación por CU15 real. Dos mecánicos distintos y un jefe vinculados sirven también para aceptar CU05; no usar un solo token por rol como sustituto de dos subjects.

No insertar confirmed/reserved/approved entre bases para aparentar Saga. No sobrescribir ediciones de negocios, roles/contraseñas o fechas al repetir; comprobar existencia por referencias propias/resultado idempotente y releer estado actual. Si hay drift relevante, fallar explícitamente antes de resetear o recrear. Fechas iniciales relativas a preparación quedan congeladas; al vencer el escenario no retimarlo silenciosamente: versión nueva explícita y conservar historia.

Repetir seed/preparación no duplica entidades, decisiones, vínculos, asignaciones ni notificaciones, y preserva una edición de negocio hecha después de sembrar. Guardar cuentas/manifest fuera del repositorio y excluirlos del build; aceptación comprueba igualdad de credenciales en memoria sin mostrarlas.

### [S2.8] Aceptación desde copia limpia y medición

Construir y arrancar desde copia pública limpia sin .git/dependencias/artefactos/secretos del host. Usar proyecto Compose independiente, volúmenes/red propios y puertos libres. Obtener imágenes/bases/paquetes según recetas reproducibles; registrar si hubo caché de Docker y no llamar cold a una reconstrucción caliente. Mantener recursos existentes sin paradas.

| Escenario | Evidencia exigida |
| --- | --- |
| Build y arranque | Imagen/lock/versiones, todos los pasos terminados/salud real, sin Java/Node/PHP o builds del host |
| Login/navegación | PKCE/issuer/audiencias reales, Angular↔React y deep-link/reload por Shell, sin tokens persistidos ni auth relajada |
| Recorrido | Datos demo relacionados por APIs y Saga global confirmed con vínculos/asignación en tres bases y eventos recibidos |
| CU05 | A/B/jefe, agenda propia/equipo/detalle/ataques/vacío/error/fechas según su especificación, sin datos ajenos |
| Repetición | Segundo bootstrap/demo, misma credencial y cuentas/entidades sin duplicación ni sobrescritura de edición |
| Reinicio | Persistencia de datos/credenciales y worker operativo tras stop/start de recursos exclusivamente propios |
| Recuperación | Una Saga pendiente y reinicio de O del proyecto aislado → misma intención recuperada, notificación/Outbox observadas, inyecciones identificadas |
| Métricas | Tiempo primer build/preparación y consumo aproximado pico/steady state, tamaño de imágenes y entorno/plataforma, sin métricas inventadas |

Pruebas unitarias/focales de cambios de configuración/auth/health/seeds y regresiones de fronteras; test runner/browser puede ejecutarse en contenedor. No usar mocks como aceptación final ni el runtime antiguo como prueba del nuevo Compose. Cualquier control Docker del harness valida nombre/labels/rutas del proyecto aislado; no detener por nombre genérico ni purgar colas/volúmenes.

### [S2.9] Preparación remota sin despliegue

Parametrizar endpoints/puerto/base/usuario/secreto/TLS/CA de PostgreSQL por propietario; mantener esquema/roles aislados y validar configuración. Templates de PostgreSQL administrado y guía de preprovisión si no permite crear bases/roles. No afirmar handshake remoto verificado sin endpoint/autoridad real; esta entrega no contrata recursos.

Atlas y DynamoDB AWS: documentación/plantillas de configuración futura (URI privada, región, identidad mínima, TLS/red y nombres sujetos a contratos). Inteligencia/Sincronización no están generadas: no añadir clientes/servicios ficticios ni declarar integración por tener variables. No crear tablas/colecciones/índices arbitrarios ni usar credenciales cloud.

Documento AWS/Azure/GCP distingue portabilidad de contenedores/PostgreSQL de multinube operativa. Describir opciones de cómputo/DB, Keycloak/broker, secretos/observabilidad y dependencias AWS específicas (DynamoDB/S3), latencia/egress/IAM/TLS y trabajo de adaptación. Atlas puede alojarse en distintos proveedores; DynamoDB no se convierte en equivalente de otro producto por cambiar URL. Propuestas, no decisiones de contratación, equivalencias drop-in ni despliegues ejecutados.

### [S2.10] Revisión y publicación

Verificaciones y revisión independientes secuenciales, sin reviewer en paralelo con build/pruebas pesadas. Evaluar cumplimiento, corrección, seguridad de configuración/secretos/ownership e idempotencia y consistencia. Resolver hallazgos y preservar los resultados fallidos. README solo con comandos comprobados y características reales; STATUS, contratos afectados, decisiones y handoff técnicos conservan evidencia/detalles, no la portada pública.

FF a main y push normal exacto de main/work/marcelo ya autorizados por el usuario; verificar refs remotas, no force/--all/tags/PR, conservar ramas/worktrees. CU05 y esta infraestructura pueden cerrarse por entregables verificados sin ocultar pendientes del otro.

## [S3] Out of Scope

Cloud contratado/desplegado, producción/HA certificada, servicios IA/MS05/MF04/MCP/n8n aparentes, offline/Flutter/CU16/CU17, reiniciar recursos actuales ajenos, rotación/reset de datos/credenciales, métricas comerciales/cobertura ficticias o una migración masiva de herramientas globales.

## Tasks

- [ ] T1: Configuración/topología y recetas — acceptance: imágenes/versiones comprobadas, Dockerfiles/ignore/Compose sin artefactos host ni colisión con entornos previos (covers: S2.2–S2.4).
- [ ] T2: Portabilidad de transporte/auth/DB — acceptance: DNS/binds/origins/issuer/JWKS/runtime config/TLS explícitos con tests y defaults locales conservados (depends: T1; covers: S2.3, S2.9).
- [ ] T3: Bootstrap/migraciones/provisión — acceptance: arranque ordenado idempotente por propietario y secretos preservados fuera de imágenes (depends: T1, T2; covers: S2.5, S2.6).
- [ ] T4: Demo conservadora — acceptance: cuentas privadas, escenario relacionado por APIs/Saga y repetición sin duplicados/ediciones/credenciales cambiadas (depends: T3; covers: S2.7).
- [ ] T5: Aceptación aislada limpia y medidas — acceptance: matriz S2.8 con recursos reales, reinicio/recuperación y métricas observadas (depends: T1, T2, T3, T4; covers: S2.8).
- [ ] T6: README/guías y revisión — acceptance: portada con datos confirmados/badges reales/comandos comprobados; propuesta cloud y revisión resuelta, evidencia técnica separada (depends: T5; covers: S2.1, S2.9, S2.10).
- [ ] T7: Cierre/publicación — acceptance: STATUS/decisiones/traspaso actualizados, FF y ambas refs remotas verificadas tras push normal (depends: T6; covers: S2.10).

## Journey log
