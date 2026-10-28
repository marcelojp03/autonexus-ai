import { afterEach, expect, test, vi } from 'vitest';
import { startStandalone } from './standalone.js';

afterEach(() => { document.body.replaceChildren(); });
function setup(authenticated = false) {
  let snapshot = { authenticated, phase: authenticated ? 'authenticated' : 'anonymous', identity: { username: '<synthetic>' } };
  let listener;
  const owner = {
    session: { snapshot: () => snapshot, subscribe: fn => { listener = fn; fn(snapshot); return () => { listener = undefined; }; }, login: vi.fn(), logout: vi.fn() },
    start: vi.fn(async () => {}), dispose: vi.fn(),
  };
  const mount = vi.fn(async () => {});
  const unmount = vi.fn(async () => {});
  const element = document.createElement('div'); document.body.append(element);
  const app = startStandalone({ owner, element, mount, unmount });
  const emit = authenticated => { snapshot = { ...snapshot, authenticated, phase: authenticated ? 'authenticated' : 'error', notice: 'Sesión terminada' }; listener?.(snapshot); };
  return { app, owner, mount, unmount, element, emit };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
test('anonymous entry never mounts business and login requests the owned finance route', async () => {
  const f = setup(); await f.app.ready;
  expect(f.mount).not.toHaveBeenCalled();
  f.element.querySelector('button').click();
  expect(f.owner.session.login).toHaveBeenCalledWith('/finance');
  await f.app.dispose();
});
test('authenticated entry reuses SessionPort and mounts once across refresh notifications', async () => {
  const f = setup(true); await f.app.ready;
  expect(f.mount).toHaveBeenCalledExactlyOnceWith({ domElement: f.element.querySelector('main'), session: f.owner.session, basePath: '/finance', assetBase: '/' });
  expect(f.element.querySelector('[role=status]').textContent).toContain('<synthetic>');
  expect(f.element.querySelector('[role=status] synthetic')).toBeNull();
  f.emit(true); await settle(); expect(f.mount).toHaveBeenCalledTimes(1);
  f.element.querySelectorAll('button')[1].click(); expect(f.owner.session.logout).toHaveBeenCalledTimes(1);
  f.emit(false); expect(f.element.querySelector('main').hidden).toBe(true);
  await settle(); expect(f.unmount).toHaveBeenCalledTimes(1);
  await f.app.dispose(); expect(f.owner.dispose).toHaveBeenCalledTimes(1);
});
test('dispose during mounting waits then tears down without remounting', async () => {
  const f = setup(true); let finish; f.mount.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await settle(); const disposing = f.app.dispose(); finish(); await disposing;
  expect(f.unmount).toHaveBeenCalledTimes(1); expect(f.mount).toHaveBeenCalledTimes(1);
  await f.app.dispose(); expect(f.owner.dispose).toHaveBeenCalledTimes(1);
});
test('mount failure closes the owner without enabling demo or redirect loops', async () => {
  const f = setup(true); f.mount.mockRejectedValue(new Error('private')); await f.app.ready;
  expect(f.owner.dispose).toHaveBeenCalledTimes(1);
  expect(f.element.textContent).toContain('No se pudo iniciar Finanzas');
  expect(f.owner.session.login).not.toHaveBeenCalled();
  await f.app.dispose();
});
