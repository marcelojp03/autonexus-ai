import './style.css';
import { addErrorHandler, getAppStatus, MOUNTED, navigateToUrl, registerApplication, start, triggerAppChange } from 'single-spa';
import Keycloak from 'keycloak-js';
import { browserOidcConfig, createBrowserSession } from '../../browser-auth/session';
import type { IntegratedProps } from '../../../contracts/auth/session';
import type { AppProps, LifeCycles } from 'single-spa';
import { matchesModule, moduleForPath, moduleProps, modules } from './routes';
import type { ModuleId } from './routes';

type IntegrationProps = IntegratedProps;
type Props = AppProps & IntegrationProps;
type Lifecycle = (props: Props) => Promise<unknown>;
type Remote = Record<'bootstrap' | 'mount' | 'unmount', Lifecycle | Lifecycle[]>;
const status = document.querySelector<HTMLElement>('#load-status')!;
const errors = new Map<string, string>();
const hosts = Object.fromEntries(modules.map((module) => [module, document.getElementById('mf-' + module)!])) as Record<ModuleId, HTMLElement>;
const sdk = new Keycloak(browserOidcConfig('shell'));
const logoutFromProvider = sdk.logout.bind(sdk);
sdk.logout = async options => { await triggerAppChange(); await logoutFromProvider(options); };
const owner = createBrowserSession(sdk, { origin: location.origin, application: 'shell' });
const session = owner.session;
const canMount = () => session.snapshot().authenticated && !!session.snapshot().identity?.roles.length;
const loginButton = document.querySelector<HTMLButtonElement>('#session-login')!;
const logoutButton = document.querySelector<HTMLButtonElement>('#session-logout')!;
const technicalOutput = document.querySelector<HTMLElement>('#technical-result')!;
let diagnosticEpoch = 0;
let permissionSubject: string | undefined;
let navigationPermissions: readonly string[] = [];
let permissionEpoch = 0;
let financeAccess: 'loading' | 'allowed' | 'forbidden' | 'unavailable' = 'loading';
const canAccess = (module: ModuleId) => canMount() && (module !== 'finance' || financeAccess === 'allowed');
async function loadModuleAccess(subject: string): Promise<void> {
  const epoch = ++permissionEpoch;
  try {
    const result = await session.requestBusiness('query ModuleAccess { securityCatalog { effective } }');
    if (permissionSubject !== subject || epoch !== permissionEpoch) return;
    const data = result.data as { securityCatalog?: { effective?: string[] } } | undefined;
    navigationPermissions = !result.errors?.length && Array.isArray(data?.securityCatalog?.effective) ? data.securityCatalog.effective : [];
    financeAccess = !result.errors?.length && Array.isArray(data?.securityCatalog?.effective)
      ? data.securityCatalog.effective.includes('quotes:read') ? 'allowed' : 'forbidden'
      : 'unavailable';
  } catch { if (permissionSubject !== subject || epoch !== permissionEpoch) return; financeAccess = 'unavailable'; }
  renderNavigation();
  await triggerAppChange();
}

function renderNavigation(): void {
  const module = moduleForPath(location.pathname);
  const snapshot = session.snapshot();
  const allowed = canMount();
  document.title = (module === 'employees' ? 'Empleados' : module === 'operations' ? 'Operaciones' : module === 'finance' ? 'Finanzas' : 'Sesión') + ' · AutoNexus';
  document.getElementById('route-error')!.hidden = !allowed || !!module;
  for (const id of modules) hosts[id].hidden = !canAccess(id) || id !== module;
  const accessNotice = document.querySelector<HTMLElement>('#module-access')!;
  accessNotice.hidden = !allowed || module !== 'finance' || financeAccess === 'allowed';
  accessNotice.textContent = financeAccess === 'forbidden' ? 'Acceso insuficiente: no tenés permiso para consultar cotizaciones.' : financeAccess === 'unavailable' ? 'No se pudieron verificar los permisos de Finanzas. Recargá para reintentar.' : 'Comprobando permisos de Finanzas…';
  document.querySelector<HTMLElement>('#session-identity')!.textContent = snapshot.identity ? snapshot.identity.username + ' · ' + snapshot.identity.roles.join(', ') : '';
  document.querySelector<HTMLElement>('#session-status')!.textContent = snapshot.notice ?? (snapshot.phase === 'initializing' ? 'Comprobando sesión…' : snapshot.authenticated ? allowed ? 'Sesión iniciada.' : 'Acceso insuficiente: la cuenta no tiene un rol del taller. Cierra sesión para cambiar de cuenta.' : 'Ingresa para acceder a los módulos del taller.');
  loginButton.hidden = snapshot.authenticated || snapshot.phase === 'initializing';
  logoutButton.hidden = !snapshot.authenticated;
  document.querySelector<HTMLElement>('#technical-controls')!.hidden = !allowed;
  document.querySelectorAll<HTMLAnchorElement>('[data-module]').forEach((link) => {
    if (link.dataset.module === module) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll<HTMLElement>('[data-employee-link]').forEach((link) => {
    link.hidden = !allowed || module !== 'employees' || (!!link.dataset.permission && !navigationPermissions.includes(link.dataset.permission));
  });
  document.querySelectorAll<HTMLElement>('[data-operations-link]').forEach((link) => {
    link.hidden = !allowed || module !== 'operations';
  });
  document.querySelectorAll<HTMLElement>('[data-finance-link]').forEach((link) => { link.hidden = !allowed || module !== 'finance'; });
  document.querySelectorAll<HTMLAnchorElement>('[data-page]').forEach((link) => {
    link.hidden = !module || !allowed || module === 'finance';
    if (!module) return;
    link.href = '/' + module + '/' + link.dataset.page;
    if (location.pathname === new URL(link.href).pathname) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const name = '@autonexus/' + module;
  const message = module ? errors.get(name) : undefined;
  status.textContent = !module || !canAccess(module) ? '' : message ?? (getAppStatus(name) === MOUNTED ? '' : 'Cargando módulo…');
  status.hidden = !status.textContent;
  if (module) hosts[module].setAttribute('aria-busy', String(!message && getAppStatus(name) !== MOUNTED));
}

function instrument(app: string, remote: Remote): LifeCycles<IntegrationProps> {
  let mounted = false;
  const wrap = (phase: 'bootstrap' | 'mount' | 'unmount') => async (props: Props) => {
    window.dispatchEvent(new CustomEvent('autonexus:lifecycle', { detail: { app, phase: phase + ':start', host: props.domElement?.id, connected: props.domElement?.isConnected, basePath: props.basePath } }));
    try {
      if (phase === 'mount' && !canMount()) return;
      if (phase === 'unmount' && !mounted) return;
      const steps = remote[phase];
      for (const step of Array.isArray(steps) ? steps : [steps]) await step(props);
      if (phase === 'mount') mounted = true;
      if (phase === 'unmount') mounted = false;
      if (phase === 'mount' && !canMount()) {
        const cleanup = remote.unmount;
        for (const step of Array.isArray(cleanup) ? cleanup : [cleanup]) await step(props);
        mounted = false;
      }
      if (phase === 'mount') errors.delete(app);
      window.dispatchEvent(new CustomEvent('autonexus:lifecycle', { detail: { app, phase: phase + ':end' } }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('autonexus:lifecycle', { detail: { app, phase: phase + ':error' } }));
      throw error;
    }
  };
  return { bootstrap: wrap('bootstrap'), mount: wrap('mount'), unmount: wrap('unmount') };
}

for (const module of modules) {
  const name = '@autonexus/' + module;
  registerApplication<IntegrationProps>({
    name,
    app: async () => {
      errors.delete(name);
      renderNavigation();
      const source = '/mfs/' + module + '/main.js';
      const remote: Remote = await import(/* @vite-ignore */ source);
      for (const phase of ['bootstrap', 'mount', 'unmount'] as const) {
        const steps = remote[phase];
        if (!(typeof steps === 'function' || (Array.isArray(steps) && steps.length && steps.every(step => typeof step === 'function')))) throw new Error('El módulo ' + module + ' no exporta el ciclo ' + phase);
      }
      return instrument(name, remote);
    },
    activeWhen: (url) => canAccess(module) && matchesModule(url.pathname, module),
    customProps: { domElement: hosts[module], ...moduleProps(module), session },
  });
}
document.querySelectorAll<HTMLAnchorElement>('[data-shell-link]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!session.snapshot().authenticated) { void session.login(new URL(link.href).pathname); return; }
    navigateToUrl(link.href);
  });
});
addErrorHandler((error) => {
  console.error('Error al cargar el microfrontend:', error);
  errors.set(error.appOrParcelName, 'No se pudo cargar el módulo. Podés navegar a otro módulo o recargar para reintentar.');
  renderNavigation();
});
window.addEventListener('single-spa:before-routing-event', renderNavigation);
window.addEventListener('single-spa:routing-event', renderNavigation);
loginButton.addEventListener('click', () => { loginButton.disabled = true; void session.login().finally(() => { loginButton.disabled = false; }); });
logoutButton.addEventListener('click', () => { void session.logout(); });
document.querySelectorAll<HTMLButtonElement>('[data-technical-service]').forEach(button => {
  button.addEventListener('click', async () => {
    const version = diagnosticEpoch;
    button.disabled = true;
    technicalOutput.textContent = 'Comprobando acceso en el servidor…';
    try {
      const result = await session.requestTechnical(button.dataset.technicalService as 'employees' | 'operations', button.dataset.technicalResource as 'session' | 'admin');
      if (version === diagnosticEpoch) technicalOutput.textContent = result.resource === 'admin' ? 'Acceso administrativo confirmado por ' + result.service + '.' : 'Sesión confirmada por ' + result.service + ': ' + result.subject + ' · ' + result.roles.join(', ');
    } catch (error) {
      if (version === diagnosticEpoch) technicalOutput.textContent = error instanceof Error ? error.message : 'No se pudo completar la comprobación técnica.';
    } finally { button.disabled = false; }
  });
});
session.subscribe(() => {
  const subject = session.snapshot().identity?.subject;
  if (subject !== permissionSubject) {
    permissionEpoch++;
    permissionSubject = subject;
    financeAccess = 'loading';
    navigationPermissions = [];
    if (subject) void loadModuleAccess(subject);
  }
  if (!session.snapshot().authenticated) { diagnosticEpoch++; technicalOutput.textContent = ''; }
  renderNavigation();
  void triggerAppChange();
});
await owner.start();
renderNavigation();
start({ urlRerouteOnly: true });
// A cached document resumes without evaluating this module again. pagehide has
// disposed its session owner; reload only BFCache restores to obtain a fresh one.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
window.addEventListener('pagehide', () => owner.dispose(), { once: true });
