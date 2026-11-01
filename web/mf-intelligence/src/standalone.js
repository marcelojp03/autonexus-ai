export function startStandalone({ owner, element, mount, unmount }) {
  const header = document.createElement('header');
  const title = document.createElement('h1');
  title.textContent = 'AutoNexus · Inteligencia';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const login = document.createElement('button');
  login.textContent = 'Ingresar';
  login.onclick = () => { void owner.session.login('/intelligence'); };
  const logout = document.createElement('button');
  logout.textContent = 'Cerrar sesión';
  logout.onclick = () => { void owner.session.logout(); };
  const surface = document.createElement('main');
  surface.id = 'mf-intelligence';
  header.append(title, status, login, logout);
  element.replaceChildren(header, surface);
  let mounted = false;
  let disposed = false;
  let failed = false;
  let pending = Promise.resolve();
  function reconcile() {
    pending = pending.then(async () => {
      const authenticated = !disposed && !failed && owner.session.snapshot().authenticated;
      if (mounted && !authenticated) {
        await unmount();
        mounted = false;
      } else if (!mounted && authenticated) {
        await mount({ domElement: surface, session: owner.session, basePath: '/intelligence', assetBase: '/' });
        mounted = true;
      }
    }).catch(async error => {
      console.error('No se pudo iniciar Inteligencia:', error);
      failed = true;
      await unmount();
      mounted = false;
      owner.dispose();
      status.textContent = 'No se pudo iniciar Inteligencia. Recarga para reintentar.';
      login.hidden = true;
      logout.hidden = true;
    });
    return pending;
  }
  const unsubscribe = owner.session.subscribe(snapshot => {
    status.textContent = snapshot.authenticated
      ? 'Sesión: ' + snapshot.identity.username
      : snapshot.notice ?? (snapshot.phase === 'initializing' ? 'Iniciando sesión…' : 'Ingresa para consultar los análisis.');
    login.hidden = snapshot.authenticated || snapshot.phase === 'initializing';
    logout.hidden = !snapshot.authenticated;
    surface.hidden = !snapshot.authenticated;
    void reconcile();
  });
  const ready = owner.start().then(() => pending);
  return {
    ready,
    async dispose() {
      if (disposed) return pending;
      disposed = true;
      unsubscribe();
      surface.hidden = true;
      owner.dispose();
      return reconcile();
    },
  };
}
