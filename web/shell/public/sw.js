'use strict';

const manifest = /* OFFLINE_MANIFEST */ null;
const prefix = 'autonexus-static-';
const cacheName = manifest && prefix + manifest.version;
const allowed = new Set(manifest?.resources.map(resource => resource.url) ?? []);

function safePath(url) {
  if (url.origin !== self.location.origin || url.search || url.hash || url.username || url.password) return false;
  let path;
  try { path = decodeURIComponent(url.pathname).toLowerCase(); } catch { return false; }
  if (path.includes('%') || path.includes(String.fromCharCode(92))
    || path.split('/').some(segment => ['identity', 'auth', 'graphql', 'api', 'protected', 'presigned'].includes(segment))) return false;
  return allowed.has(url.pathname);
}

async function install() {
  if (!manifest || !/^[a-f0-9]{64}$/.test(manifest.version) || !allowed.has('/offline.html')) {
    throw new Error('Offline manifest must be generated after the production build');
  }
  const requests = [];
  for (const resource of manifest.resources) {
    const url = new URL(resource.url, self.location.origin);
    if (!safePath(url)) throw new Error('Unsafe offline resource');
    if (!/^[a-f0-9]{64}$/.test(resource.sha256)) throw new Error('Invalid offline resource digest');
    const hash = btoa(String.fromCharCode(...resource.sha256.match(/../g).map(byte => parseInt(byte, 16))));
    requests.push(new Request(url.href, {
      credentials: 'omit', redirect: 'error', cache: 'no-store', integrity: 'sha256-' + hash,
    }));
  }
  const existed = await caches.has(cacheName);
  const cache = await caches.open(cacheName);
  try {
    // Cache.addAll commits one atomic batch; SRI also rejects a missing file served as SPA HTML.
    await cache.addAll(requests);
  } catch (error) {
    if (!existed) await caches.delete(cacheName);
    throw error;
  }
}

self.addEventListener('install', event => event.waitUntil(install()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
  }
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('Authorization') || !safePath(url)) return;
  // Only the dedicated offline document gets navigation fallback, never an authenticated SPA route.
  if (request.mode === 'navigate') {
    if (url.pathname !== '/offline.html') return;
    event.respondWith(fetch(request).catch(async () => {
      const cached = await (await caches.open(cacheName)).match(url.href);
      return cached ?? Response.error();
    }));
    return;
  }
  event.respondWith((async () => {
    const cached = await (await caches.open(cacheName)).match(url.href);
    return cached ?? fetch(request);
  })());
});
