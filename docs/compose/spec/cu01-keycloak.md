---
feature: cu01-keycloak
status: in-progress
updated: 2026-10-25
branch: feat/cu01-keycloak
commits: ""
---

# CU01 web — Keycloak, sesión compartida y APIs protegidas

## Report

## [S1] Problema y precondiciones

Backend-foundation fue integrado localmente en main por fast-forward a3bbf499; la ubicación definitiva de esa base es la raíz, registrada en1963ce3. Se conservaron rama/worktree, volumen y credenciales originales. Desde main se recompilaron12testsJava+13unitarias/3HTTPNest, aislamiento/historial y caída/restauración reales. El contenedor posee ahora bind/config/ownership de la raíz; el verificador antiguo rechaza actuar. Sin push ni ramas eliminadas.

Falta CU01: la web usa auth demo y las APIs aún no validan access tokens. La entrega requiere autenticación web OIDC real, SSO entre módulos y autorización servidor, sin adelantar CU02/CRUD/Saga ni simular BFF.

Workspace elegido según compose-next: .worktrees/cu01-keycloak, rama feat/cu01-keycloak, base main1963ce3. Los worktrees anteriores se mantienen. Las dos configuraciones privadas de servicios se copiaron desde main con comparación de bytes, sin regeneración. El PostgreSQL de Operaciones/Empleados sigue administrándose desde main; no cambiar sus contraseñas o volumen al ejecutar código CU01 en esta rama. Las ubicaciones runtime y de ownership se documentarán explícitamente; nunca usar el verificador del worktree antiguo para parar un recurso de la raíz.

## [S2] Identidad, infraestructura y contratos

### IdP y persistencia

- Keycloak **26.8.1**, release oficial estable no-prerelease y manifest Docker verificados. Adapter oficial **keycloak-js26.2.4**, JOSE Node **6.2.13**; versiones reales consultadas, no asumir que server/adapter deben tener igual minor. Mantener Boot4.1.2, Nest12.2.0, Angular22/Delon y Node22.22.3/pnpm12.6.0.
- Infraestructura propia en infra/keycloak, proyecto Docker exclusivo autonexus-keycloak-dev. Keycloak en127.0.0.1:8180, puerto comprobado libre. HTTP loopback es desarrollo local explícito; producción requerirá HTTPS/gestión de secretos distinta, no se acredita.
- PostgreSQL17.11 propio del IdP, base/rol y volumen separados; no usar ninguna base, usuario o volumen de Operaciones/Empleados. Sin puerto PostgreSQL IdP expuesto al host si no hace falta. Las cuentas/roles de autenticación y sesiones se persisten solo allí.
- Configuración pública reproducible de realm/clientes/roles, sin usuarios/passwords reales en Git. Inicializador crea secretos nuevos únicamente del IdP y cuentas locales sintéticas en .env/.local ignorados; nunca imprime passwords/tokens ni sobrescribe configuración existente. El bootstrap administrativo opera por API autenticada con valores en memoria, no secrets en argumentos. No borrar volúmenes ni reinicializar las credenciales base.

### Vocabulario y acceso técnico

Cinco roles humanos respaldados por los documentos. Se proponen identificadores técnicos para esta entrega, no una matriz empresarial nueva:

| Actor funcional | Rol realm Keycloak |
| --- | --- |
| Administrador | administrador |
| Recepcionista | recepcionista |
| Mecánico | mecanico |
| Jefe de taller | jefe_taller |
| Responsable financiero | responsable_financiero |

Una identidad puede acumular roles. No crear user/admin/cliente/superadmin como roles del taller ni asumir herencia del Administrador para todas las funciones. Semilla de roles/clientes/cuentas prueba no implementa CU02 ni CRUD de empleados. El administrador operativo de Keycloak es una identidad de infraestructura distinta del Administrador del taller.

Se admite acceso a los **contenedores y diagnósticos técnicos** a cualquiera de esos cinco roles; sin rol reconocido no hay módulos autorizados y se muestra acceso insuficiente, no bucle de login. Esto no concede permisos de CRUD ni sobre registros. GET/technical/admin requiere únicamente administrador como comprobación RBAC; no administra roles ni recursos empresariales.

### Clientes, issuer y audiencias

- Realm autonexus; issuer exacto `http://127.0.0.1:8180/realms/autonexus`.
- Clientes públicos: autonexus-shell (4200), autonexus-mf-employees (4201) y autonexus-mf-operations (4202). Solo Authorization Code/flowstandard, PKCE S256 obligatorio en cliente y servidor; implicit/password grants/service accounts de estos clientes deshabilitados, sin clientsecret.
- Redirect URI exacta por cliente: `http://127.0.0.1:<puerto>/auth/callback`; post-logout exacto `http://127.0.0.1:<puerto>/`. Web origin exacto por puerto, sin comodines ni origin-reflection. Elegir siempre127.0.0.1 en instrucciones; localhost no es alias autorizado implícito.
- Recursos/audiencias: autonexus-operations-api y autonexus-employees-api. Mappers añaden ambas audiencias a **access tokens**, no a IDtokens. Claims realm_access.roles. Publicar contratos versionados en contracts/auth y recurso REST técnico, sin lógica de dominio/ORM compartido.

## [S3] Sesión web y modos de frontend

### Sesión integrada

- Un solo adapter/refresh en el Shell por documento. Los MFs integrados no instancian Keycloak ni inician otro login. single-spa arranca/monta rutas protegidas solo después de resolver sesión/permisos; falta de prop de sesión falla cerrado, nunca deriva silenciosamente a demo.
- Contrato compartido SessionPort: modo explícito oidc/demo, snapshot de identidad/roles/estado sin tokens, subscribe/unsubscribe, login(returnTo), logout y requestTechnical(service,session/admin). No entregar refresh/IDtokens a los MFs ni introducir un getter global/debug de JWT. El transporte técnico inyecta bearer solo a los dos destinos/rutas allowlisted; credenciales de cookies omitidas en APIs.
- Un helper browser común puede recibir una instancia del SDK oficial para reutilizar ciclo de sesión en Shell/standalone. No implementa criptografía/OIDC propios, no es una nueva app ni traslada lógica al contrato. SDKs se importan/instancian únicamente en entradas propietarias; integrado recibe el puerto del Shell.
- Tokens access/refresh/ID solo en memoria del adapter. No localStorage/sessionStorage/IndexedDB para tokens ni logs/HAR/trazas con Authorization. El adapter mantiene estado/nonce/verificador PKCE transitorios de la transacción, consumidos al callback; no son persistencia de sesión ni fallback autenticado. El destino de retorno solo almacena ruta interna no secreta validada.
- Callback fijo con responseMode fragment, nonce/state/PKCE del SDK; limpiar parámetros OAuth antes de montar vistas o registrar resultados. Validar retorno mismo origen y prefijos propios, rechazar URLs externas/script/backslashes y parámetros de token/callback. Entrada desde /employees/... o /operations/... vuelve a esa ruta, conservando parámetros no sensibles.
- Reload pierde tokens en memoria: nueva autorización de código usando cookie SSO del IdP, sin pedir credenciales otra vez mientras siga la sesión. No reconstruir tokens desde almacenamiento del navegador.
- Access token local60s para prueba; reloj tolerado5s en APIs; refresh central periódico y antes de diagnósticos, con cola del SDK para evitar carreras. Renovación real contra token endpoint, no modificación artificial de exp. Si renovar falla: borrar estado cliente, desmontar módulos, bloquear peticiones y mostrar recuperación segura; no fallback a demo/offline ni loops de redirección.
- Logout global mediante endpoint OIDC del IdP y POST soportado por el adapter, sin JWTs en querystring de logout. Invalidar inmediatamente el puerto/estado visible, desmontar consumidores y limpiar tokens/timer sin disparar un nuevo login requerido. No usar localStorage.clear().

### Standalone y demo explícitos

- Entradas standalone OIDC propias con sus clientes4201/4202 y configuración de desarrollo explícita. Son sesiones de cliente independientes solo cuando se ejecutan fuera del Shell; no compiten al montar integrado.
- Conservar layout completo standalone. En OIDC no se montan Passport/callback/refresh ficticios de NG-ALAIN ni guards basados en token demo. Logout standalone usa IdP. Usuarios/ACL de presentación proceden de la sesión, no de Admin estático o setFull(true).
- Modo standalone-demo solo por configuración/script explícito, banner inequívoco, datos sintéticos y sin acceso a APIs protegidas. Un error OIDC no activa demo. Delon usa almacenamiento en memoria, incluso para sus datos auth de demostración; nunca copiar JWT real al tokenService legacy. La carga integrada normal es oidc, no auth simulada.
- Conservar world/layout NG-ZORRO existente; añadir controles/estado de sesión con texto claro, foco, loading/error/forbidden y responsive. Los gráficos/datos del template permanecen identificados como ejemplos, no como negocio implementado.

## [S4] APIs y frontera con BFF

- Spring: starter Resource Server gestionado por BOM, Nimbus/Spring Security; Nest: JOSE6.2.13 y guards/adaptadores explícitos. No verificación criptográfica casera ni confiar en claims enviados por MF sin validar firma.
- Validar RS256 con JWKS del issuer configurado y confiable, issuer exacto, audience del propio servicio, exp obligatorio y expiración/nbf con tolerancia5s. Rechazar IDtokens, algnone/HS alternativo, firma alterada, issuer/audience incorrectos y claims críticos ausentes. Timeouts/cache/rotación de JWKS con fallo cerrado; no leer jku/issuer no confiable del token para elegir destino.
- Auth stateless bearer, sin sesión/cookie de API ni credenciales recibidas por querystring. CORS exacto4200/4201/4202 para las comprobaciones, métodos/headers mínimos y sin credentialed cookies. Respuestas401/403 genéricas sin token, claims completos, stack o detalles internos.
- Endpoints de liveness/readiness permanecen públicos y con PostgreSQL real. Recursos mínimos: GET/technical/session requiere JWT válido y algún rol reconocido; GET/technical/admin requiere administrador. Respuestas técnicas contienen servicio/identidad mínima/roles o confirmación de acceso, nunca token. Denegar por defecto futuros recursos sin política explícita.
- El Shell/MFs llaman REST solo para estos diagnósticos técnicos permitidos por la entrega. **Funciones empresariales web continúan reservadas a GraphQL mediante BFF; servicios mantienen REST.** No generar BFF/CRUD ni presentar mock como integración real. Contrato requerido al participante2 para el futuro BFF: forwarding/validación bearer, issuer/audiences acordadas, roles/acción/registro y campos GraphQL por CU; su implementación no bloquea la prueba técnica CU01 y no se acredita aquí.

### Tokens después de logout

El logout invalida sesión IdP/renovación y estado local. Una API que valida JWT offline no revoca mágicamente access tokens ya emitidos: uno aún válido puede seguir aceptado hasta exp+tolerancia5s. Documentar/probar esa ventana con el token real en RAM, y luego su401 por expiración. No prometer revocación inmediata ni agregar blacklist/introspección por petición sin otro contrato. Deshabilitar usuario/retirar roles también tiene ventana de tokens ya emitidos; nuevas autorizaciones/refresh aplican estado IdP.

## [S5] Verificación, revisión y cierre

- Baseline main ya integrado y verificado, con mismo volumen/credenciales, ownership raíz y worktree antiguo conservado. CU01 usa las mismas conexiones de datos; se pueden agregar solo variables OIDC públicas a configuración privada preservando DB_* y sin regenerar passwords.
- Tests de límites de autorización/redirect/storage y claims; fakes de SDK/JWKS solo como unidades, nunca evidencia de SSO. Compilar/probar ambos servicios, Shell y Angular integrado/standalone con comandos reales. Conservar advertencias conocidas sin ocultarlas; no actualizar frameworks por suposición.
- IdP real con sus volúmenes: bootstrap idempotente, discovery/JWKS, clientes redirect/origins/PKCE inspeccionados sin credenciales y persistencia tras restart del contenedor. Verificar datos base intactos. No usar K8s ni recursos de otros proyectos.
- Navegador con cuentas privadas: ruta protegida→IdP→retorno exacto, credenciales erróneas y cuenta deshabilitada, navegación Empleados↔Operaciones sin otro login, reload SSO, renovación real, logout y nuevo acceso pidiendo login. Probar standalone OIDC y modo demo explícito sin llamadas bearer a recursos. Login no modifica empleados ni asignaciones.
- API real: sin token401, malformado/firma alterada401, IDtoken/audience incorrecta401, staff200 y recurso admin403 con no-administrador/200 con administrador, token real emitido que expira401. Validaciones aisladas de issuer/audience/exp/alg con RSA y JWKS de prueba se etiquetan como unidad; no confundirlas con Keycloak real.
- Capturar credenciales/tokens solo en memoria de los verificadores; nunca enviarlos como literales a herramientas ni imprimir bodies de tokenendpoint/headers, URLs con code/session_code o excepciones que revelen valores. Artefactos/capturas sanitizados en output ignorado. No añadir endpoints/hooks de producción para facilitar tests.
- Después de todas las verificaciones, un revisor fresco inspecciona el diff completo con resumen PASS/FAIL/PRE-EXISTING y sin repetir suites aprobadas por rutina; revisión estrictamente secuencial. Corregir críticos, re-verificar y re-revisar área afectada.
- README, decisión005, STATUS, contratos y esta especificación finalizada con evidencias/commits locales revisados. Reportar qué quedó en main (base) y dónde queda CU01. Sin push, force/reset, borrado de ramas/worktrees ni merge automático de CU01.

## [S6] Fuera de alcance

CU02 funcional, CRUD empleados/clientes/órdenes, Saga, permisos empresariales por registro aún sin CU, Flutter, offline autorizado/CU27, BFF implementado, Finanzas/Inteligencia/Sincronización/MCP, Kubernetes, producción pública/TLS externo y revocación instantánea de JWT emitido. El cliente no recibe cuenta del taller en el MVP.

## Tasks

- [x] T0: Fijar contratos de claims/roles/SessionPort y recurso técnico — acceptance: contratos de tipos/REST versionados, sin tokens ni lógica de negocio, como prerequisite real de consumidores paralelos (covers: S2,S3,S4).
- [ ] T1: Configurar IdP/datos privados y contratos de identidad — acceptance: Keycloak26.8.1 real persistente, clientes PKCE/redirect/origins exactos, cinco roles y cuentas privadas, datos base conservados (covers: S2,S4; depends: T0).
- [ ] T2: Sesión única Shell y helper browser — acceptance: código+PKCE, retorno validado, memoria/refresh/logout real y SessionPort sin exponer tokens a MFs; pruebas de límites (covers: S3; depends: T0).
- [ ] T3: Adaptar ambos Angular integrado/standalone/demo explícito — acceptance: una sesión en integrado, OIDC independiente configurado, ningún fallback demo ni JWT en Delon/storage; builds y pruebas (covers: S3; depends: T2).
- [ ] T4: Proteger Operaciones y Empleados — acceptance: firma/iss/aud/exp/roles validados,401/403 genéricos, salud real preservada y recursos técnicos sin CRUD (covers: S4; depends: T0).
- [ ] T5: Verificación real de CU01 y regresión — acceptance: navegador y APIs cumplen escenarios, refresh/logout/expiración observados y datos/ownership/puertos conservados (covers: S2,S3,S4,S5; depends: T2,T3,T4).
- [ ] T6: Revisión independiente y cierre local — acceptance: cero críticos pendientes, contratos/docs/STATUS/resultados y spec delivered con rango revisado; sin merge/push automático (covers: S5; depends: T5).
