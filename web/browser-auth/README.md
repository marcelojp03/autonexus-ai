# Propietario de sesión browser CU01

Helper TypeScript sin dependencias runtime. Contrato de tipos: ../../contracts/auth/session.ts. No es una aplicación ni importa Keycloak en runtime; cada entrada propietaria construye el adapter oficial.

~~~typescript
import Keycloak from 'keycloak-js';
import { browserOidcConfig, createBrowserSession } from '../browser-auth/session';
const owner = createBrowserSession(new Keycloak(browserOidcConfig('employees')), {
  origin: location.origin, application: 'employees'
});
await owner.start();
// La vista consume owner.session; al destruir el propietario: owner.dispose().
~~~

Exports: createBrowserSession(sdk: BrowserOidcAdapter, options: {origin: string; application: 'shell' | 'employees' | 'operations'}): BrowserSessionOwner; BrowserSessionOwner contiene session: SessionPort, start(): Promise<void>, dispose(): void. BrowserOidcAdapter es estructural y compatible con keycloak-js26.2.4. browserOidcConfig devuelve url/realm/clientId públicos. workshopRoles y safeReturnTo son ayudas opcionales. Integrado no crea un owner: recibe exclusivamente SessionPort del Shell.

Solo tokens RAM del SDK, sin getters/globales ni copia a Delon. El SDK conserva su propia transacción PKCE/nonce/state temporal. sessionStorage contiene exclusivamente autonexus:returnTo:<application>, una ruta interna validada también al leer. Shell acepta /employees y /operations; standalone /#/widgets, /#/dashboard/... y /#/exception/.... Callback fijo /auth/callback con fragment, limpio antes de publicar identidad/montar. La raíz anónima no dispara login; una ruta protegida inicia nueva autorización, que reutiliza la cookie SSO del IdP cuando existe.

Refresh cada10s y updateToken(30) antes de cada diagnóstico; el SDK oficial serializa renovaciones concurrentes. Errores limpian SDK/estado/timer y no redirigen en bucle. Epoch bloquea resultados tardíos después de logout/dispose. Logout publica anónimo inmediatamente; POST del SDK captura id_token_hint en formulario antes de clearToken. dispose cancela timers, requests y suscripciones sin cerrar sesión IdP. El access token ya emitido puede seguir aceptado por APIs offline hasta60s+5s de tolerancia; no se promete revocación inmediata.

Transporte restringido a127.0.0.1:8081/3002 y GET/technical/session|admin. Cookies omitidas, redirects prohibidos, timeout10s, DTO validado y copiado sin campos extra. 403 conserva sesión y explica falta de autorización;401 invalida; error de red no revela errores del SDK ni bodies. No implementa GraphQL/CRUD ni modo demo; un consumidor demo no debe llamar estas APIs.

Pruebas unitarias ejecutables desde ../shell con pnpm test (fake SDK/fetch, no evidencia SSO). El typecheck del Shell comprueba compatibilidad estructural con el SDK real instalado. Integración IdP/navegador se acredita separadamente.
