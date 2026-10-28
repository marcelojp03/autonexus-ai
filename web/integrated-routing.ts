/** Shell history is authoritative; no second history entry or routing owner. */
interface IntegratedRouter {
  readonly url: string;
  currentNavigation(): { extractedUrl: { toString(): string } } | null;
  navigateByUrl(url: string, options: { replaceUrl: boolean }): Promise<boolean>;
}
interface RoutingWindow extends EventTarget {
  readonly location: Pick<Location, 'pathname' | 'search' | 'hash'>;
}
export function connectIntegratedRouter(router: IntegratedRouter, basePath: '/employees' | '/operations', browser: RoutingWindow = window): () => void {
  const synchronize = () => {
    const { pathname, search, hash } = browser.location;
    if (pathname !== basePath && !pathname.startsWith(basePath + '/')) return;
    const target = (pathname.slice(basePath.length) || '/') + search + hash;
    if (router.url === target || router.currentNavigation()?.extractedUrl.toString() === target) return;
    // single-spa-angular 22 + noop can discard a synthetic popstate after
    // Angular replaces an unchanged URL. Reconcile only a demonstrably stale
    // router after single-spa finishes, using its public API and own base path.
    void router.navigateByUrl(target, { replaceUrl: true }).catch(error => console.error('No se pudo sincronizar la ruta del módulo:', error));
  };
  browser.addEventListener('single-spa:routing-event', synchronize);
  return () => browser.removeEventListener('single-spa:routing-event', synchronize);
}
