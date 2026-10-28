import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { bootstrap, mount, unmount } from './spa';

// Isolate lifecycle ownership; the separate browser verifier uses the real UI,
// real SessionPort, Keycloak, BFF and owner databases without this test double.
vi.mock('./integrated/IntegratedApp.jsx', () => ({ default: ({ basePath }) => <p data-testid="surface">{basePath}</p> }));
const session = { snapshot: () => ({ mode: 'oidc', authenticated: true }) };
let host;
afterEach(async () => { await act(() => unmount()); host?.remove(); });
describe('single-spa React ownership', () => {
  it('exports promise lifecycles and rejects a missing host or session', async () => {
    await expect(bootstrap()).resolves.toBeUndefined();
    await expect(mount({})).rejects.toThrow('SessionPort');
    host = document.createElement('section');
    await expect(mount({ domElement: host })).rejects.toThrow('SessionPort');
    await expect(mount({ domElement: host, session: { snapshot: () => ({ mode: 'demo', authenticated: true }) } })).rejects.toThrow('SessionPort');
  });
  it('mounts in the received host, isolates template CSS, destroys and remounts', async () => {
    host = document.createElement('section'); document.body.append(host);
    const props = { domElement: host, session, basePath: '/finance', assetBase: '/mfs/finance/' };
    const headStyles = document.head.querySelectorAll('style').length;
    await act(() => mount(props));
    expect(host.shadowRoot.querySelector('[data-testid="surface"]').textContent).toBe('/finance');
    expect([...host.shadowRoot.querySelectorAll('style')].some(style => style.textContent.includes(':host'))).toBe(true);
    expect(document.head.querySelectorAll('style').length).toBe(headStyles);
    expect(host.childElementCount).toBe(0);
    await expect(mount(props)).rejects.toThrow('already mounted');
    await act(() => unmount());
    expect(host.shadowRoot.childElementCount).toBe(0);
    await act(() => mount(props));
    expect(host.shadowRoot.querySelector('[data-testid="surface"]')).not.toBeNull();
    await act(() => unmount());
    await act(() => unmount());
  });
});
