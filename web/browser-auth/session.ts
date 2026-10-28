import type { BusinessFailure, BusinessResult, SessionPort, SessionSnapshot, TechnicalResult, WorkshopRole } from '../../contracts/auth/session.ts';

export type BrowserApplication = 'shell' | 'employees' | 'operations' | 'finance';
export interface BrowserOidcAdapter {
  init(options: { flow: 'standard'; pkceMethod: 'S256'; useNonce: boolean; responseMode: 'fragment'; checkLoginIframe: boolean; enableLogging: boolean; redirectUri: string; logoutMethod: 'POST' }): Promise<boolean>;
  login(options: { redirectUri: string }): Promise<void>;
  logout(options: { redirectUri: string; logoutMethod: 'POST' }): Promise<void>;
  updateToken(minValidity: number): Promise<boolean>;
  clearToken(): void;
  authenticated?: boolean;
  token?: string;
  tokenParsed?: { sub?: string; preferred_username?: string; realm_access?: { roles: string[] } };
  onAuthLogout?: () => void;
  onAuthRefreshError?: () => void;
  onTokenExpired?: () => void;
}
export interface BrowserSessionOwner { session: SessionPort; start(): Promise<void>; dispose(): void; }
export const workshopRoles: readonly WorkshopRole[] = Object.freeze(['administrador', 'recepcionista', 'mecanico', 'jefe_taller', 'responsable_financiero']);
export function browserOidcConfig(application: BrowserApplication) {
  return { url: 'http://127.0.0.1:8180', realm: 'autonexus', clientId: application === 'shell' ? 'autonexus-shell' : `autonexus-mf-${application}` };
}
export function safeReturnTo(value: unknown, application: BrowserApplication): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\u0000-\u0020]/.test(value)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  if (/[\\%\u0000-\u0020]/.test(decoded) || /%2f|%3f|%23/i.test(value.split(/[?#]/)[0]!) || /(?:^|\/)\.{1,2}(?:\/|[?#]|$)/.test(decoded)) return null;
  if (/(?:[?&#])(?:code|state|session_state|iss|error|error_description|access_token|id_token|refresh_token|token|session_code|nonce|redirect_uri|client_id|response_type|response_mode)(?:=|&|$)/i.test(decoded)) return null;
  if (application === 'shell') return /^\/(employees|operations|finance)(?:\/|[?]|$)/.test(decoded) && !decoded.includes('#') ? value : null;
  if (application === 'finance') return (decoded === '/finance' || decoded.startsWith('/finance/') || decoded.startsWith('/finance?')) && !decoded.includes('#') ? value : null;
  return /^\/#\/(?:widgets|dashboard(?:\/[^?#]*)?|exception(?:\/[^?#]*)?)(?:[?].*)?$/.test(decoded) ? value : null;
}

/** Accepts only the BFF contract shape; arbitrary bodies never reach a component. */
function parseBusinessResult(value: unknown): BusinessResult {
  if (!value || typeof value !== 'object') throw new Error('Respuesta empresarial inválida.');
  const body = value as { data?: unknown; errors?: unknown };
  if (Array.isArray(body.errors) && body.errors.length) {
    const errors: BusinessFailure[] = body.errors.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object') throw new Error('Respuesta empresarial inválida.');
      const entry = raw as { message?: unknown; extensions?: { code?: unknown; statusCode?: unknown } };
      const code = entry.extensions?.code;
      const statusCode = entry.extensions?.statusCode;
      if (typeof code !== 'string' || typeof statusCode !== 'number' || typeof entry.message !== 'string') throw new Error('Respuesta empresarial inválida.');
      return Object.freeze({ code, statusCode, message: entry.message });
    });
    return Object.freeze({ errors: Object.freeze(errors) });
  }
  if (body.data && typeof body.data === 'object') return Object.freeze({ data: body.data });
  throw new Error('Respuesta empresarial inválida.');
}

export function createBrowserSession(sdk: BrowserOidcAdapter, options: { origin: string; application: BrowserApplication }): BrowserSessionOwner {
  const { origin, application } = options;
  const callback = origin + '/auth/callback';
  const defaultRoute = application === 'shell' ? '/employees' : application === 'finance' ? '/finance' : '/#/widgets';
  const storageKey = `autonexus:returnTo:${application}`;
  let current: Readonly<SessionSnapshot> = Object.freeze({ mode: 'oidc', phase: 'initializing', authenticated: false, identity: null });
  let epoch = 0;
  let disposed = false;
  let started = false;
  let loggingOut = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<(snapshot: Readonly<SessionSnapshot>) => void>();
  const requests = new Set<AbortController>();
  function publish(phase: SessionSnapshot['phase'], notice?: string) {
    const claims = sdk.tokenParsed;
    const identity = phase === 'authenticated' && typeof claims?.sub === 'string' && claims.sub.length > 0 ? Object.freeze({ subject: claims.sub, username: typeof claims.preferred_username === 'string' ? claims.preferred_username : claims.sub, roles: Object.freeze(workshopRoles.filter(role => Array.isArray(claims.realm_access?.roles) && claims.realm_access.roles.includes(role))) }) : null;
    current = Object.freeze({ mode: 'oidc', phase, authenticated: !!identity, identity, ...(notice ? { notice } : {}) });
    for (const listener of listeners) listener(current);
  }
  function stop() {
    epoch++;
    clearInterval(timer);
    timer = undefined;
    for (const request of requests) request.abort();
    requests.clear();
  }
  function fail() {
    if (disposed || current.phase === 'anonymous' || current.phase === 'error') return;
    stop();
    publish('error', 'La sesión terminó o no pudo renovarse. Ingresa nuevamente.');
    sdk.clearToken();
  }
  async function refresh() {
    const version = epoch;
    if (disposed || !current.authenticated) throw new Error('Sesión no disponible.');
    try { await sdk.updateToken(30); } catch { if (version === epoch) fail(); throw new Error('No se pudo renovar la sesión.'); }
    if (disposed || version !== epoch) { if (!loggingOut) sdk.clearToken(); throw new Error('Sesión no disponible.'); }
    if (!sdk.authenticated || !sdk.token) { fail(); throw new Error('Sesión no disponible.'); }
    publish('authenticated');
    if (disposed || version !== epoch || !current.authenticated) throw new Error('Sesión no disponible.');
  }
  sdk.onAuthLogout = fail;
  sdk.onAuthRefreshError = fail;
  sdk.onTokenExpired = () => { void refresh().catch(() => {}); };
  const session: SessionPort = {
    snapshot: () => current,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(current);
      return () => { listeners.delete(listener); };
    },
    async login(returnTo = defaultRoute) {
      if (disposed) return;
      const target = safeReturnTo(returnTo, application) ?? defaultRoute;
      publish('initializing');
      try {
        sessionStorage.setItem(storageKey, target);
        await sdk.login({ redirectUri: callback });
      } catch { fail(); }
    },
    async logout() {
      if (disposed || current.phase === 'anonymous') return;
      loggingOut = true;
      stop();
      publish('anonymous');
      try { sessionStorage.removeItem(storageKey); } catch {}
      try {
        // POST construction must capture the RAM-only ID token before clearToken.
        await sdk.logout({ redirectUri: origin + '/', logoutMethod: 'POST' });
      } catch { publish('error', 'No se pudo completar la salida del proveedor. Intenta ingresar nuevamente.'); }
      finally { loggingOut = false; sdk.clearToken(); }
    },
    async requestTechnical(service, resource): Promise<TechnicalResult> {
      if ((service !== 'employees' && service !== 'operations') || (resource !== 'session' && resource !== 'admin')) throw new Error('Recurso técnico no permitido.');
      await refresh();
      const version = epoch;
      const controller = new AbortController();
      requests.add(controller);
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`http://127.0.0.1:${service === 'employees' ? '3002' : '8081'}/technical/${resource}`, { method: 'GET', headers: { Authorization: `Bearer ${sdk.token}` }, credentials: 'omit', redirect: 'error', signal: controller.signal });
        if (disposed || version !== epoch) throw new Error('Sesión no disponible.');
        if (response.status === 401) { fail(); throw new Error('Sesión rechazada (401). Ingresa nuevamente.'); }
        if (response.status === 403) throw new Error('Acceso insuficiente (403). Este recurso requiere el rol autorizado en el servidor.');
        if (!response.ok) throw new Error('El servicio técnico no está disponible.');
        const data: unknown = await response.json();
        if (disposed || version !== epoch) throw new Error('Sesión no disponible.');
        if (!data || typeof data !== 'object' || !('service' in data) || data.service !== service || !('resource' in data) || data.resource !== resource) throw new Error('Respuesta técnica inválida.');
        if (resource === 'admin' && 'authorized' in data && data.authorized === true) return Object.freeze({ resource, service, authorized: true });
        if (resource === 'session' && 'subject' in data && typeof data.subject === 'string' && 'roles' in data && Array.isArray(data.roles) && data.roles.every(role => workshopRoles.includes(role))) return Object.freeze({ resource, service, subject: data.subject, roles: Object.freeze([...data.roles]) });
        throw new Error('Respuesta técnica inválida.');
      } catch (error) {
        if (error instanceof Error && ['Sesión no disponible.', 'Sesión rechazada (401). Ingresa nuevamente.', 'Acceso insuficiente (403). Este recurso requiere el rol autorizado en el servidor.', 'El servicio técnico no está disponible.', 'Respuesta técnica inválida.'].includes(error.message)) throw error;
        throw new Error('No se pudo contactar al servicio técnico. Reintenta la comprobación.');
      } finally { clearTimeout(timeout); requests.delete(controller); }
    },
    async requestBusiness(query, variables): Promise<BusinessResult> {
      if (typeof query !== 'string' || !query.trim() || query.length > 4000) throw new Error('Solicitud empresarial inválida.');
      if (variables !== undefined && (typeof variables !== 'object' || variables === null || Array.isArray(variables))) throw new Error('Solicitud empresarial inválida.');
      await refresh();
      const version = epoch;
      const controller = new AbortController();
      requests.add(controller);
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch('http://127.0.0.1:3004/graphql', {
          method: 'POST',
          headers: { Authorization: `Bearer ${sdk.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, ...(variables === undefined ? {} : { variables }) }),
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        });
        if (disposed || version !== epoch) throw new Error('Sesión no disponible.');
        if (response.status === 401) { fail(); throw new Error('Sesión rechazada (401). Ingresa nuevamente.'); }
        if (response.status === 403) return Object.freeze({ errors: Object.freeze([Object.freeze({ code: 'FORBIDDEN', statusCode: 403, message: 'Acceso insuficiente (403). Esta operación requiere el rol administrador.' })]) });
        if (!response.ok) throw new Error('El servicio empresarial no está disponible.');
        const data: unknown = await response.json();
        if (disposed || version !== epoch) throw new Error('Sesión no disponible.');
        return parseBusinessResult(data);
      } catch (error) {
        if (error instanceof Error && ['Sesión no disponible.', 'Sesión rechazada (401). Ingresa nuevamente.', 'El servicio empresarial no está disponible.', 'Respuesta empresarial inválida.', 'Solicitud empresarial inválida.'].includes(error.message)) throw error;
        throw new Error('No se pudo contactar al servicio empresarial. Reintenta.');
      } finally { clearTimeout(timeout); requests.delete(controller); }
    },
  };
  return { session,
    async start() {
      if (started || disposed) return;
      started = true;
      const version = epoch;
      const isCallback = location.pathname === '/auth/callback';
      const route = location.pathname + location.search + location.hash;
      try {
        const authenticated = await sdk.init({ flow: 'standard', pkceMethod: 'S256', useNonce: true, responseMode: 'fragment', checkLoginIframe: false, enableLogging: false, redirectUri: callback, logoutMethod: 'POST' });
        if (disposed || version !== epoch) { sdk.clearToken(); return; }
        if (isCallback) {
          let target = defaultRoute;
          try { target = safeReturnTo(sessionStorage.getItem(storageKey), application) ?? defaultRoute; sessionStorage.removeItem(storageKey); } catch {}
          history.replaceState(null, '', authenticated ? target : '/');
        }
        if (authenticated && sdk.tokenParsed?.sub) {
          publish('authenticated');
          if (disposed || version !== epoch) return;
          if (!current.authenticated) { fail(); return; }
          timer = setInterval(() => { void refresh().catch(() => {}); }, 10000);
        } else {
          publish('anonymous');
          if (!isCallback && safeReturnTo(route, application)) await session.login(route);
        }
      } catch {
        if (isCallback) history.replaceState(null, '', '/');
        if (!disposed && version === epoch) fail();
      }
    },
    dispose() { disposed = true; stop(); publish('anonymous'); listeners.clear(); sdk.onAuthLogout = undefined; sdk.onAuthRefreshError = undefined; sdk.onTokenExpired = undefined; sdk.clearToken(); },
  };
}
