'use strict';

const manifest = /* OFFLINE_MANIFEST */ null;
const prefix = 'autonexus-static-';
const cacheName = manifest && prefix + manifest.version;
const modelCacheName = cacheName + '-model';
const allowed = new Set(manifest?.resources.map(resource => resource.url) ?? []);
const modelResources = manifest?.resources.filter(resource => resource.url.startsWith('/offline-model/')) ?? [];
let preparing;
let pendingMessages = 0;

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
    if (url.pathname.startsWith('/offline-model/')) continue;
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
  try {
    await prepareModelCache();
  } catch {
    // An older worker is the only compatible resolver for its model. Keep it active.
    for (const key of await caches.keys()) {
      if (key.startsWith(prefix) && key.endsWith('-model') && key !== modelCacheName && await usablePreviousModel(key)) {
        if (!existed) await caches.delete(cacheName);
        throw new Error('MODEL_UPDATE_BLOCKED');
      }
    }
  }
}

async function usablePreviousModel(key) {
  try {
    const cache = await caches.open(key);
    const response = await cache.match(new URL('/offline-model/index.json', self.location.origin).href);
    if (!response?.ok) return false;
    const index = await response.json();
    if (index.schemaVersion !== 1 || typeof index.modelVersion !== 'string' || typeof index.runId !== 'string'
      || index.modelUrl !== '/offline-model/tfjs/model.json' || index.runtime?.url !== '/offline-model/vendor/tf.min.js'
      || !Array.isArray(index.files) || !index.files.length || index.files.length > 64) return false;
    const files = new Map();
    let total = 0;
    for (const file of index.files) {
      if (typeof file.url !== 'string' || !new RegExp('^/offline-model/(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_.-]+$').test(file.url)
        || file.url.includes('..') || files.has(file.url) || !Number.isSafeInteger(file.bytes)
        || file.bytes <= 0 || file.bytes > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256)) return false;
      total += file.bytes;
      if (total > 128 * 1024 * 1024) return false;
      const cached = await cache.match(new URL(file.url, self.location.origin).href);
      if (!cached?.ok) return false;
      const bytes = await cached.clone().arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (bytes.byteLength !== file.bytes || digest !== file.sha256) return false;
      files.set(file.url, cached);
    }
    if ([index.modelUrl, index.runtime.url, '/offline-model/manifest.json', '/offline-model/quality.json'].some(url => !files.has(url))
      || index.files.find(file => file.url === index.runtime.url).sha256 !== index.runtime.sha256) return false;
    const graph = await files.get(index.modelUrl).json();
    if (!Array.isArray(graph.weightsManifest) || !graph.weightsManifest.length) return false;
    for (const group of graph.weightsManifest) {
      if (!Array.isArray(group.paths) || !group.paths.length) return false;
      for (const path of group.paths) {
        if (typeof path !== 'string' || !new RegExp('^[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*[.]bin$').test(path)
          || !files.has('/offline-model/tfjs/' + path)) return false;
      }
    }
    return true;
  } catch { return false; }
}

function modelRequest(resource, signal) {
  const url = new URL(resource.url, self.location.origin);
  if (!safePath(url) || url.pathname !== resource.url || !/^[a-f0-9]{64}$/.test(resource.sha256)) throw new Error('MODEL_MANIFEST_INVALID');
  const hash = btoa(String.fromCharCode(...resource.sha256.match(/../g).map(byte => parseInt(byte, 16))));
  return new Request(url.href, { credentials: 'omit', redirect: 'error', cache: 'no-store',
    integrity: 'sha256-' + hash, signal });
}

async function verifiedModel() {
  if (!modelResources.length || !await caches.has(modelCacheName)) return;
  const cache = await caches.open(modelCacheName);
  const responses = [];
  for (const resource of modelResources) {
    modelRequest(resource);
    const response = await cache.match(new URL(resource.url, self.location.origin).href);
    if (!response?.ok) return;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== resource.sha256) return;
    responses.push(response);
  }
  return responses;
}

function prepareModelCache() {
  if (!preparing) preparing = (async () => {
    if (!manifest || !/^[a-f0-9]{64}$/.test(manifest.version) || !modelResources.length || modelResources.length > 64
      || !modelResources.some(resource => resource.url === '/offline-model/index.json')) throw new Error('MODEL_UNAVAILABLE');
    modelResources.forEach(resource => modelRequest(resource));
    let responses = await verifiedModel();
    if (!responses) {
      const existed = await caches.has(modelCacheName);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const cache = await caches.open(modelCacheName);
        await cache.addAll(modelResources.map(resource => modelRequest(resource, controller.signal)));
        responses = await verifiedModel();
        if (!responses) throw new Error('MODEL_INTEGRITY_FAILED');
      } catch (error) {
        if (!existed) await caches.delete(modelCacheName);
        throw error;
      } finally { clearTimeout(timer); }
    }
    const index = await responses[modelResources.findIndex(resource => resource.url === '/offline-model/index.json')].json();
    if (typeof index.modelVersion !== 'string' || typeof index.runId !== 'string') throw new Error('MODEL_MANIFEST_INVALID');
    return { modelVersion: index.modelVersion, runId: index.runId };
  })().finally(() => { preparing = undefined; });
  return preparing;
}

self.addEventListener('message', event => {
  const port = event.ports?.[0];
  if (!port) return;
  const data = event.data;
  if (event.ports.length !== 1 || !data || Object.keys(data).sort().join(',') !== 'protocol,requestId,type'
    || data.type !== 'AUTONEXUS_PREPARE_MODEL' || data.protocol !== 1
    || typeof data.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(data.requestId)) {
    for (const item of event.ports) item.close();
    return;
  }
  if (pendingMessages >= 8) {
    port.postMessage({ type: 'AUTONEXUS_MODEL_PREPARED', protocol: 1, requestId: data.requestId,
      version: manifest?.version, ok: false, code: 'MODEL_BUSY' });
    port.close(); return;
  }
  pendingMessages++;
  event.waitUntil((async () => {
    const reply = { type: 'AUTONEXUS_MODEL_PREPARED', protocol: 1, requestId: data.requestId, version: manifest?.version };
    try {
      const client = event.source?.id && await self.clients.get(event.source.id);
      if (!client || client.type !== 'window' || new URL(client.url).origin !== self.location.origin) {
        port.postMessage({ ...reply, ok: false, code: 'MODEL_UNAUTHORIZED' }); return;
      }
      const metadata = await prepareModelCache();
      port.postMessage({ ...reply, ok: true, code: 'MODEL_CACHED', ...metadata });
    } catch (error) {
      const code = ['MODEL_UNAVAILABLE', 'MODEL_MANIFEST_INVALID', 'MODEL_INTEGRITY_FAILED'].includes(error?.message)
        ? error.message : 'MODEL_PREPARATION_FAILED';
      port.postMessage({ ...reply, ok: false, code });
    } finally { pendingMessages--; port.close(); }
  })());
});

self.addEventListener('install', event => event.waitUntil(install()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const modelComplete = !!await verifiedModel();
  for (const key of await caches.keys()) {
    if (modelComplete && key.startsWith(prefix) && key !== cacheName && key !== modelCacheName) await caches.delete(key);
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
    // A document navigation carries credentials=include in Chromium. Fetch this one public
    // allowlisted document without cookies; never copy credentials into cache or fallback.
    event.respondWith(fetch(new Request(url.href, { credentials: 'omit', redirect: 'error', cache: 'no-store' })).catch(async () => {
      const cached = await (await caches.open(cacheName)).match(url.href);
      return cached ?? Response.error();
    }));
    return;
  }
  if (request.credentials === 'include') return;
  event.respondWith((async () => {
    if (url.pathname.startsWith('/offline-model/')) {
      const responses = await verifiedModel();
      return responses?.[modelResources.findIndex(resource => resource.url === url.pathname)] ?? Response.error();
    }
    const cached = await (await caches.open(cacheName)).match(url.href);
    return cached ?? fetch(request);
  })());
});
