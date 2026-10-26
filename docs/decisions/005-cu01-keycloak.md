# 005 — CU01 web: Keycloak, sesión única y recursos técnicos

Fecha: 2026-10-26. Diseño aprobado por Marcelo mediante compose-next en la especificación cu01-keycloak. Implementación local en feat/cu01-keycloak, base main1963ce3; no implica merge, push ni despliegue productivo. Los resultados completos y el rango revisado se registran en la especificación y STATUS al cerrar.

## Identidad y aislamiento

Keycloak26.8.1 estable verificado con release oficial, manifest e imagen runtime. PostgreSQL17.11-bookworm del IdP tiene proyecto, red, rol y volumen propios; no usa bases ni credenciales de Operaciones/Empleados. El único bind del IdP al host es127.0.0.1:8180. start-dev/HTTP loopback es exclusivamente desarrollo local: no acredita producción segura ni HTTPS. Los scripts comprueban ownership antes de modificar recursos y preservan secretos/IDs al repetir la provisión. El init SQL conserva LF mediante atributos locales.

El PostgreSQL de la base integrada sigue administrado desde infra/compose de la raíz principal, con su volumen y credenciales originales. CU01 ejecuta código desde su worktree y reutiliza únicamente las conexiones propietarias ya existentes; no se reinicializa el servidor. Las ubicaciones runtime deben mantenerse explícitas para evitar que el verificador de un worktree antiguo pare un recurso ajeno.

Realm autonexus e issuer exacto http://127.0.0.1:8180/realms/autonexus. Roles realm: administrador, recepcionista, mecanico, jefe_taller, responsable_financiero. Son identificadores técnicos de los cinco actores funcionales; no crean herencia universal del Administrador ni una matriz de permisos empresariales. Las siete cuentas sintéticas de prueba y el administrador de infraestructura se guardan en archivos privados ignorados. Su semilla no implementa CU02 ni crea empleados del negocio.

## Composición web

Tres clientes públicos: autonexus-shell4200 y autonexus-mf-employees4201/autonexus-mf-operations4202. Authorization Code, PKCE S256 exigido por servidor y SDK, nonce/state y responseMode fragment. Redirección exacta por origen /auth/callback y post-logout exacto /, sin comodines, client secret ni password/implicit/service-account grants. Se usa127.0.0.1 de forma consistente: localhost no es alias autorizado.

Shell es el único propietario del SDK/renovación en integrado. Entrega SessionPort por props single-spa, no tokens. Los MFs consumen identidad/estado, suscripción, acciones de ingreso/salida y diagnósticos allowlisted. No crean clientes OIDC al montarse ni cierran la sesión global al desmontarse. Se mantiene la cabecera única del Shell, ShadowRoot/CSS/assets por módulo y navegación history integrada.

Cada entrada standalone crea su propio propietario explícito, conserva su layout completo y rutas hash. El demo solo se activa mediante su configuración/entrada dedicada; nunca por fallo de OIDC ni ausencia accidental de props. Delon utiliza almacenamiento en memoria y no recibe JWT reales. Passport/refresh ficticios y ACL completa no participan del modo OIDC. Menús/gráficos siguen identificados como datos del template, sin funcionalidad empresarial ni BFF integrado.

Access/refresh/ID tokens solo en memoria del adapter oficial keycloak-js26.2.4. No se exige igualdad artificial de minor con el servidor26.8.1: se verificaron paquetes y comportamiento por separado. El SDK usa metadata transitoria de la transacción OIDC; solo la ruta interna validada se conserva como retorno no secreto. Se limpia el callback antes de publicar identidad/montar vistas. El destino no admite URLs externas, escapes de ruta ni parámetros sensibles.

Recargar pierde tokens en RAM y realiza otra autorización Code usando la cookie SSO del IdP. Renovación central cada10s y antes del diagnóstico, updateToken(30) y cola oficial del SDK. Un fallo invalida el puerto, cancela peticiones y desmonta/bloquea las vistas; no activa demo/offline. Logout invalida primero estado/montajes y usa el POST oficial; conserva temporalmente el ID token en RAM hasta que el formulario lo captura. No se pasa JWT en URL ni se usa localStorage.clear().

## Ciclo de vida del gráfico de ejemplo

La verificación real encontró ObjectUnsubscribedError al cambiar rápidamente de módulo. El stack compilado identificó G2Service.libLoad de @delon/chart22.1.1: la promesa de carga resolvía después de ngOnDestroy/Subject.unsubscribe. No era un error de OIDC, transporte ni TitleService. Se adopta un parche pnpm pequeño, versionado y fijado por hash para impedir cargas/emisiones después de destrucción sin cambiar la versión ni acceder a campos privados desde código de aplicación. Se exige regresión red→green con el servicio real y loader diferido sintético, más repetición real del navegador. No se oculta console.error ni se espera artificialmente antes de navegar. La carga CDN de gráficos demo no acredita funcionamiento offline de esas vistas.

## APIs y BFF

Operaciones incorpora el starter oficial spring-boot-starter-security-oauth2-resource-server del BOM Boot4.1.2, Spring Security7.1.2/Nimbus10.9.1. Empleados usa jose6.2.13 exacto, jwtVerify/createRemoteJWKSet y guard global con política explícita. No se introduce criptografía propia ni se mueven framework/persistencia a los casos puros de disponibilidad.

Se validan RS256, issuer exacto, audiencia propia, exp obligatorio, sub y typ=Bearer; nbf/exp con tolerancia5s. JWKS procede solo del issuer configurado, nunca de jku/claims del token; caché/rotación y timeout2s fallan cerrados. Audiencias autonexus-operations-api/autonexus-employees-api se añaden a access tokens, no ID tokens. Las claves cacheadas pueden validar JWT vigentes durante caída del IdP; no equivalen a revocación online.

Salud permanece pública, con readiness PostgreSQL real. GET/technical/session exige token válido y un rol reconocido; GET/technical/admin exige administrador. DTOs mínimos, errores401/403 genéricos, stateless/Bearer-only y sin autenticación por cookie/query/form. CORS restringe orígenes locales explícitos, GET/OPTIONS y headers mínimos, sin cookies. Otros recursos se deniegan por defecto.

Estos diagnósticos REST no sustituyen GraphQL/BFF para funciones empresariales web. El BFF del participante2 deberá acordar audiencia/forwarding o exchange autorizado y controles rol/acción/registro por campo y CU. No se implementa ni se presenta una simulación de esa integración.

## Logout y límites

Access token local60s y tolerancia servidor5s. Logout termina sesión/renovación en Keycloak y estado local, pero JWT emitidos pueden seguir aceptados por APIs offline hasta exp+5s. Se comprobó con tokens reales en RAM: refresh rechazado tras logout, access todavía200 y posterior401 al vencer. No se promete revocación instantánea; deshabilitar cuenta/cambiar roles tiene una ventana equivalente para tokens ya emitidos. Blacklist/introspección requieren un contrato posterior.

Esta entrega es CU01 web local. No cubre Flutter, autorización offline, CU02 funcional, CRUD, Saga, permisos empresariales por registro, otros participantes, producción pública/TLS ni Kubernetes. Pruebas de RSA/JWKS o SDK falsos son unidades y no acreditan SSO real; la evidencia navegador, API e infraestructura se distingue en el cierre.

## Fuentes primarias

- https://github.com/keycloak/keycloak/releases/tag/26.8.1
- https://www.keycloak.org/securing-apps/javascript-adapter
- https://github.com/keycloak/keycloak-js/blob/main/docs/guides/securing-apps/javascript-adapter.adoc
- https://www.keycloak.org/server/containers
- https://www.keycloak.org/docs/latest/server_admin/index.html
- https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html
- https://github.com/panva/jose
- Paquetes reales fijados en POM/BOM y pnpm-lock.yaml; contratos locales en contracts/auth y contracts/rest/technical-auth.openapi.yaml.
