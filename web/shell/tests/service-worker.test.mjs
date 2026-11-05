import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import vm from 'node:vm';
import { buildOfflineManifest } from '../scripts/build-offline-manifest.mjs';

const template = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://offline.example';
const hash = body => createHash('sha256').update(body).digest('hex');
const bodies = { '/offline.html': '<!doctype html>offline', '/assets/main-a.js': 'export {}',
  '/assets/vendor-tfjs.js': 'vendor', '/offline-model/model.json': '{}', '/offline-model/weights.bin': 'weights' };

function harness({ resources = bodies, missing, wrongBody, failWrite = false, manifest: supplied } = {}) {
  const resourcesManifest = Object.entries(resources).map(([url, body]) => ({ url, sha256: hash(body) }));
  const manifest = supplied ?? { version: hash(JSON.stringify(resourcesManifest)), resources: resourcesManifest };
  const maps = new Map([['autonexus-static-old', new Map([['old-resource', new Response('old')]])],
    ['unrelated-cache', new Map()]]);
  const listeners = {};
  const fetched = [];
  let offline = false;
  let claimed = false;
  const fetch = async request => {
    fetched.push(request);
    if (offline) throw new TypeError('offline');
    const path = new URL(request.url).pathname;
    const response = new Response(path === wrongBody ? '<html>SPA fallback</html>' : resources[path] ?? 'missing',
      { status: path === missing || !(path in resources) ? 404 : 200 });
    if (request.integrity) {
      const actual = createHash('sha256').update(await response.clone().text()).digest('base64');
      if (request.integrity !== 'sha256-' + actual) throw new TypeError('integrity mismatch');
    }
    return response;
  };
  const caches = {
    has: async key => maps.has(key),
    keys: async () => [...maps.keys()],
    delete: async key => maps.delete(key),
    open: async key => {
      if (!maps.has(key)) maps.set(key, new Map());
      return {
        match: async url => maps.get(key)?.get(url)?.clone(),
        addAll: async requests => {
          const responses = await Promise.all(requests.map(fetch));
          if (failWrite || responses.some(response => !response.ok)) throw new TypeError('cache batch failed');
          const next = new Map(maps.get(key));
          requests.forEach((request, index) => next.set(request.url, responses[index]));
          maps.set(key, next);
        },
      };
    },
  };
  vm.runInNewContext(template.replace('/* OFFLINE_MANIFEST */ null', JSON.stringify(manifest)), {
    self: { location: { origin }, addEventListener: (type, fn) => { listeners[type] = fn; },
      clients: { claim: async () => { claimed = true; } } },
    caches, fetch, Request, Response, URL, btoa,
  });
  return {
    maps, fetched, manifest,
    cacheName: 'autonexus-static-' + manifest.version,
    setOffline: () => { offline = true; },
    claimed: () => claimed,
    lifecycle(type) {
      let promise;
      listeners[type]({ waitUntil: value => { promise = value; } });
      return promise;
    },
    request(path, { method = 'GET', mode = 'cors', headers = {} } = {}) {
      let response;
      listeners.fetch({ request: { url: new URL(path, origin).href, method, mode, headers: new Headers(headers) },
        respondWith: promise => { response = promise; } });
      return response;
    },
  };
}

test('install caches the full versioned allowlist with integrity and no credentials', async () => {
  const worker = harness();
  await worker.lifecycle('install');
  assert.equal(worker.maps.get(worker.cacheName).size, Object.keys(bodies).length);
  assert.ok(worker.maps.has('autonexus-static-old'));
  assert.ok(worker.fetched.every(request => request.credentials === 'omit' && request.redirect === 'error'
    && request.cache === 'no-store' && request.integrity.startsWith('sha256-')));
  await worker.lifecycle('activate');
  assert.equal(worker.maps.has('autonexus-static-old'), false);
  assert.equal(worker.maps.has('unrelated-cache'), true);
  assert.equal(worker.claimed(), true);
});

for (const failure of [{ missing: '/offline-model/weights.bin' }, { wrongBody: '/assets/main-a.js' }, { failWrite: true }]) {
  test('failed atomic install preserves old caches: ' + JSON.stringify(failure), async () => {
    const worker = harness(failure);
    await assert.rejects(worker.lifecycle('install'));
    assert.deepEqual([...worker.maps.keys()], ['autonexus-static-old', 'unrelated-cache']);
    assert.equal(await worker.maps.get('autonexus-static-old').get('old-resource').text(), 'old');
  });
}

test('failed same-version install preserves the already installed cache', async () => {
  const worker = harness({ missing: '/offline-model/weights.bin' });
  worker.maps.set(worker.cacheName, new Map([['sentinel', new Response('keep')]]));
  await assert.rejects(worker.lifecycle('install'));
  assert.equal(await worker.maps.get(worker.cacheName).get('sentinel').text(), 'keep');
});

test('unbuilt worker refuses install', async () => {
  const worker = harness({ manifest: { version: 'unbuilt', resources: [] } });
  await assert.rejects(worker.lifecycle('install'), /must be generated/);
});

test('protected, signed, querystring, authenticated, nonGET and cross-origin requests bypass', async () => {
  const worker = harness();
  await worker.lifecycle('install');
  worker.setOffline();
  for (const path of ['/identity', '/identity/realms/test', '/auth/callback', '/graphql', '/api/works',
    '/protected/photo.jpg', '/presigned/photo.jpg', '/assets/main-a.js?v=1', '/offline.html?code=private',
    '/photo.jpg?X-Amz-Signature=private', 'https://storage.example/photo.jpg', '/operations/orders', '/', '/index.html']) {
    assert.equal(worker.request(path), undefined, path);
  }
  assert.equal(worker.request('/assets/main-a.js', { headers: { Authorization: 'Bearer private' } }), undefined);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    assert.equal(worker.request('/assets/main-a.js', { method }), undefined);
  }
});

test('protected segments bypass even if mistakenly placed in a manifest', async () => {
  for (const path of ['/api/private.js', '/assets/auth/main.js', '/assets/%61uth/main.js']) {
    const worker = harness({ resources: { ...bodies, [path]: 'private' } });
    await assert.rejects(worker.lifecycle('install'), /Unsafe offline resource/);
    assert.equal(worker.request(path), undefined);
  }
});

test('cold navigation fallback serves only offline.html; assets use the exact static cache', async () => {
  const worker = harness();
  await worker.lifecycle('install');
  worker.setOffline();
  assert.equal(await (await worker.request('/offline.html', { mode: 'navigate' })).text(), bodies['/offline.html']);
  assert.equal(await (await worker.request('/assets/main-a.js')).text(), bodies['/assets/main-a.js']);
  assert.equal(await (await worker.request('/offline-model/weights.bin')).text(), bodies['/offline-model/weights.bin']);
  for (const path of ['/', '/index.html', '/operations/orders', '/assets/main-a.js']) {
    assert.equal(worker.request(path, { mode: 'navigate' }), undefined);
  }
});

async function buildFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'autonexus-offline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = {
    'index.html': '<!doctype html><script src="/runtime-config.js"></script><script type="module" src="/assets/main-a.js"></script>',
    'runtime-config.js': 'window.__AUTONEXUS_CONFIG__ = {};',
    'manifest.webmanifest': '{}', 'favicon.svg': '<svg/>',
    'assets/main-a.js': 'import "./vendor-tfjs.js";', 'assets/vendor-tfjs.js': 'export {};', 'assets/main-a.css': 'body{}',
    'offline-model/tfjs/model.json': JSON.stringify({ weightsManifest: [{ paths: ['weights.bin'], weights: [] }] }),
    'offline-model/tfjs/weights.bin': 'weights', 'offline-model/metadata.json': '{}', 'offline-model/vendor/tf.min.js': 'vendor',
    'offline-model/demo.zip': 'excluded', 'mfs/operations/main.js': 'excluded',
    'assets/demo.zip': 'excluded', 'assets/main-a.js.map': 'excluded', 'api/private.js': 'excluded',
  };
  fixture['offline-model/index.json'] = JSON.stringify({ modelUrl: '/offline-model/tfjs/model.json',
    files: ['tfjs/model.json', 'tfjs/weights.bin', 'vendor/tf.min.js'].map(name => ({ url: '/offline-model/' + name,
      bytes: Buffer.byteLength(fixture['offline-model/' + name]), sha256: hash(fixture['offline-model/' + name]) })) });
  for (const [name, content] of Object.entries(fixture)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}

test('production generator copies offline page, includes JS/CSS/vendor/model and excludes demo graph', async t => {
  const root = await buildFixture(t);
  const first = await buildOfflineManifest(root);
  assert.deepEqual(first.resources.map(resource => resource.url), ['/assets/main-a.css', '/assets/main-a.js',
    '/assets/vendor-tfjs.js', '/favicon.svg', '/manifest.webmanifest', '/offline-model/index.json', '/offline-model/metadata.json',
    '/offline-model/tfjs/model.json', '/offline-model/tfjs/weights.bin', '/offline-model/vendor/tf.min.js', '/offline.html']);
  assert.equal(first.modelReady, true);
  const offlineHtml = await readFile(join(root, 'offline.html'), 'utf8');
  assert.ok(!offlineHtml.includes('src="/runtime-config.js"'));
  assert.ok(offlineHtml.includes('oidcUrl:location.origin+"/identity"'));
  assert.ok((await readFile(join(root, 'index.html'), 'utf8')).includes('src="/runtime-config.js"'));
  assert.equal((await buildOfflineManifest(root)).version, first.version);
  await writeFile(join(root, 'assets/main-a.css'), 'body{color:red}');
  assert.notEqual((await buildOfflineManifest(root)).version, first.version);
  const built = await readFile(join(root, 'sw.js'), 'utf8');
  assert.ok(!built.includes('/* OFFLINE_MANIFEST */ null'));
  assert.ok(built.includes('/offline-model/tfjs/weights.bin'));
});

test('production generator fails for missing weight rather than publishing a partial resource manifest', async t => {
  const root = await buildFixture(t);
  await rm(join(root, 'offline-model/tfjs/weights.bin'));
  await assert.rejects(buildOfflineManifest(root), /Missing or unsafe model weight/);
  await assert.rejects(readFile(join(root, 'offline-resources.json')));
});

test('production generator rejects remote/traversal weight references', async t => {
  const root = await buildFixture(t);
  for (const path of ['../private.bin', '/api/private.bin', 'https://storage.example/weights.bin', 'weights.bin?signature=private']) {
    await writeFile(join(root, 'offline-model/tfjs/model.json'), JSON.stringify({ weightsManifest: [{ paths: [path] }] }));
    await assert.rejects(buildOfflineManifest(root), /Missing or unsafe model weight/);
  }
});

test('clean build without prepared model is explicit modelReady:false; partial models fail', async t => {
  const root = await buildFixture(t);
  await rm(join(root, 'offline-model'), { recursive: true });
  const manifest = await buildOfflineManifest(root);
  assert.equal(manifest.modelReady, false);
  assert.ok(manifest.resources.every(resource => !resource.url.startsWith('/offline-model/')));
  await mkdir(join(root, 'offline-model'));
  await writeFile(join(root, 'offline-model/index.json'), '{}');
  await assert.rejects(buildOfflineManifest(root), /Missing required offline model resource/);
});
