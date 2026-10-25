import './style.css';
import { addErrorHandler, getAppStatus, MOUNTED, navigateToUrl, registerApplication, start } from 'single-spa';
import type { AppProps, LifeCycles } from 'single-spa';
import { matchesModule, moduleForPath, modules } from './routes';
import type { ModuleId } from './routes';

type IntegrationProps = { domElement: HTMLElement; basePath: string; assetBase: string };
type Props = AppProps & IntegrationProps;
type Lifecycle = (props: Props) => Promise<unknown>;
type Remote = Record<'bootstrap' | 'mount' | 'unmount', Lifecycle | Lifecycle[]>;
const status = document.querySelector<HTMLElement>('#load-status')!;
const errors = new Map<string, string>();
const hosts = Object.fromEntries(modules.map((module) => [module, document.getElementById('mf-' + module)!])) as Record<ModuleId, HTMLElement>;

function renderNavigation(): void {
  const module = moduleForPath(location.pathname);
  document.title = (module === 'employees' ? 'Empleados' : module === 'operations' ? 'Operaciones' : 'Ruta no encontrada') + ' · AutoNexus · Demo';
  document.getElementById('route-error')!.hidden = !!module;
  for (const id of modules) hosts[id].hidden = id !== module;
  document.querySelectorAll<HTMLAnchorElement>('[data-module]').forEach((link) => {
    if (link.dataset.module === module) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll<HTMLAnchorElement>('[data-page]').forEach((link) => {
    link.hidden = !module;
    if (!module) return;
    link.href = '/' + module + '/' + link.dataset.page;
    if (location.pathname === new URL(link.href).pathname) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const name = '@autonexus/' + module;
  const message = module ? errors.get(name) : undefined;
  status.textContent = !module ? '' : message ?? (getAppStatus(name) === MOUNTED ? '' : 'Cargando demostración…');
  status.hidden = !status.textContent;
  if (module) hosts[module].setAttribute('aria-busy', String(!message && getAppStatus(name) !== MOUNTED));
}

function instrument(app: string, remote: Remote): LifeCycles<IntegrationProps> {
  const wrap = (phase: 'bootstrap' | 'mount' | 'unmount') => async (props: Props) => {
    window.dispatchEvent(new CustomEvent('autonexus:lifecycle', { detail: { app, phase: phase + ':start' } }));
    try {
      const steps = remote[phase];
      for (const step of Array.isArray(steps) ? steps : [steps]) await step(props);
      if (phase === 'mount') errors.delete(app);
      window.dispatchEvent(new CustomEvent('autonexus:lifecycle', { detail: { app, phase: phase + ':end' } }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('autonexus:lifecycle', { detail: { app, phase: phase + ':error' } }));
      throw error;
    }
  };
  return { bootstrap: wrap('bootstrap'), mount: wrap('mount'), unmount: wrap('unmount') };
}

if (location.pathname === '/') history.replaceState(history.state, '', '/employees' + location.search + location.hash);
for (const module of modules) {
  const name = '@autonexus/' + module;
  registerApplication<IntegrationProps>({
    name,
    app: async () => {
      errors.delete(name);
      renderNavigation();
      const source = '/mfs/' + module + '/main.js';
      const remote: Remote = await import(/* @vite-ignore */ source);
      return instrument(name, remote);
    },
    activeWhen: (url) => matchesModule(url.pathname, module),
    customProps: { domElement: hosts[module], basePath: '/' + module, assetBase: '/mfs/' + module + '/' },
  });
}
document.querySelectorAll<HTMLAnchorElement>('[data-shell-link]').forEach((link) => {
  link.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateToUrl(link.href);
  });
});
addErrorHandler((error) => {
  errors.set(error.appOrParcelName, 'No se pudo cargar esta demostración. Puedes navegar al otro módulo.');
  console.error(error);
  renderNavigation();
});
window.addEventListener('single-spa:before-routing-event', renderNavigation);
window.addEventListener('single-spa:routing-event', renderNavigation);
renderNavigation();
start({ urlRerouteOnly: true });
