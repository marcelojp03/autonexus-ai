import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import vm from 'node:vm';
import { buildOfflineManifest } from '../scripts/build-offline-manifest.mjs';

const template = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://offline.example';
const hash = body => createHash('sha256').update(body).digest('hex');
const bodies = { '/offline.html': '<!doctype html>offline', '/assets/main-a.js': 'export {}',
  '/assets/vendor-tfjs.js': 'vendor', '/offline-model/model.json': '{}', '/offline-model/weights.bin': 'weights',
  '/offline-model/tfjs/model.json': JSON.stringify({weightsManifest:[{paths:['weights.bin']}]}),
  '/offline-model/tfjs/weights.bin': 'graph weights', '/offline-model/vendor/tf.min.js': 'runtime',
  '/offline-model/manifest.json': '{}', '/offline-model/quality.json': '{}' };
bodies['/offline-model/index.json'] = JSON.stringify({schemaVersion:1,
  modelVersion:'automotive-damage-mobilenetv2-v1',runId:'20261101T-with-negatives',
  modelUrl:'/offline-model/tfjs/model.json',runtime:{url:'/offline-model/vendor/tf.min.js',sha256:hash('runtime')},
  files:Object.entries(bodies).filter(([url])=>url.startsWith('/offline-model/')).map(([url,body])=>({url,bytes:Buffer.byteLength(body),sha256:hash(body)}))});

function harness({ resources = bodies, missing, wrongBody, failWrite = false, failModelWrite = false, manifest: supplied, maps: shared } = {}) {
  const resourcesManifest = Object.entries(resources).map(([url, body]) => ({ url, sha256: hash(body) }));
  const manifest = supplied ?? { version: hash(JSON.stringify(resourcesManifest)), resources: resourcesManifest };
  const maps = shared ?? new Map([['autonexus-static-old', new Map([['old-resource', new Response('old')]])],
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
          if (failWrite || (failModelWrite && key.endsWith('-model')) || responses.some(response => !response.ok)) throw new TypeError('cache batch failed');
          const next = new Map(maps.get(key));
          requests.forEach((request, index) => next.set(request.url, responses[index]));
          maps.set(key, next);
        },
      };
    },
  };
  vm.runInNewContext(template.replace('/* OFFLINE_MANIFEST */ null', JSON.stringify(manifest)), {
    self: { location: { origin }, addEventListener: (type, fn) => { listeners[type] = fn; },
      clients: { claim: async () => { claimed = true; }, get: async id => id === 'page' ? { id, url: origin + '/offline.html', type: 'window' } : undefined } },
    caches, fetch, Request, Response, URL, btoa, crypto: webcrypto, AbortController, setTimeout, clearTimeout,
  });
  return {
    maps, fetched, manifest,
    cacheName: 'autonexus-static-' + manifest.version,
    setOffline: () => { offline = true; },
    restore: () => { offline = false; missing = undefined; wrongBody = undefined; failWrite = false; failModelWrite = false; },
    async prepare(data = { type: 'AUTONEXUS_PREPARE_MODEL', protocol: 1, requestId: 'test-1' }, source = { id: 'page' }) {
      let reply; let closed = false; let pending;
      listeners.message?.({ data, source, ports: [{ postMessage: value => { reply = value; }, close: () => { closed = true; } }], waitUntil: value => { pending = value; } });
      await pending; return { reply, closed };
    },
    claimed: () => claimed,
    lifecycle(type) {
      let promise;
      listeners[type]({ waitUntil: value => { promise = value; } });
      return promise;
    },
    request(path, { method = 'GET', mode = 'cors', headers = {}, credentials = 'same-origin' } = {}) {
      let response;
      listeners.fetch({ request: { url: new URL(path, origin).href, method, mode, credentials, headers: new Headers(headers) },
        respondWith: promise => { response = promise; } });
      return response;
    },
  };
}

test('install caches the full versioned allowlist with integrity and no credentials', async () => {
  const worker = harness();
  await worker.lifecycle('install');
  assert.equal(worker.maps.get(worker.cacheName).size + worker.maps.get(worker.cacheName + '-model').size, Object.keys(bodies).length);
  assert.ok(worker.maps.has('autonexus-static-old'));
  assert.ok(worker.fetched.every(request => request.credentials === 'omit' && request.redirect === 'error'
    && request.cache === 'no-store' && request.integrity.startsWith('sha256-')));
  await worker.lifecycle('activate');
  assert.equal(worker.maps.has('autonexus-static-old'), false);
  assert.equal(worker.maps.has('unrelated-cache'), true);
  assert.equal(worker.claimed(), true);
});

for (const failure of [{ wrongBody: '/assets/main-a.js' }, { failWrite: true }]) {
  test('failed atomic install preserves old caches: ' + JSON.stringify(failure), async () => {
    const worker = harness(failure);
    await assert.rejects(worker.lifecycle('install'));
    assert.deepEqual([...worker.maps.keys()], ['autonexus-static-old', 'unrelated-cache']);
    assert.equal(await worker.maps.get('autonexus-static-old').get('old-resource').text(), 'old');
  });
}

test('failed same-version install preserves the already installed cache', async () => {
  const worker = harness({ missing: '/assets/main-a.js' });
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
  assert.equal(worker.request('/assets/main-a.js', { credentials: 'include' }), undefined);
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
  // Chromium uses credentials=include for document navigations, even this public offline entry.
  assert.equal(await (await worker.request('/offline.html', { mode: 'navigate', credentials: 'include' })).text(), bodies['/offline.html']);
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

test('missing or corrupt optional model is atomic but core preparation survives', async () => {
  for (const failure of [{ missing: '/offline-model/weights.bin' }, { wrongBody: '/offline-model/weights.bin' }]) {
    const worker = harness(failure); await worker.lifecycle('install');
    assert.ok(worker.maps.has(worker.cacheName)); assert.equal(worker.maps.has(worker.cacheName + '-model'), false);
    worker.setOffline(); assert.equal((await worker.request('/offline.html', { mode: 'navigate' })).status, 200);
  }
});

test('failed B model install preserves complete A worker/model instead of activating B', async () => {
  const a = harness(); await a.lifecycle('install'); await a.lifecycle('activate');
  const next={...bodies,'/assets/main-a.js':'new core','/offline-model/tfjs/weights.bin':'different B graph weights'};
  const index=JSON.parse(next['/offline-model/index.json']);
  index.files=index.files.map(file=>({...file,bytes:Buffer.byteLength(next[file.url]),sha256:hash(next[file.url])}));
  next['/offline-model/index.json']=JSON.stringify(index);
  const b = harness({maps:a.maps,resources:next,missing:'/offline-model/tfjs/weights.bin'});
  await assert.rejects(b.lifecycle('install'), /MODEL_UPDATE_BLOCKED/);
  assert.ok(a.maps.has(a.cacheName + '-model'));
  a.setOffline();
  assert.equal(await (await a.request('/offline-model/tfjs/weights.bin')).text(), 'graph weights');
});

test('incomplete or corrupt A model remnants do not block B core/manual installation', async () => {
  for(const failure of ['missing','corrupt','index']) {
    const a=harness(); await a.lifecycle('install'); await a.lifecycle('activate');
    const oldModel=a.maps.get(a.cacheName+'-model');
    if(failure==='corrupt')oldModel.set(origin+'/offline-model/tfjs/weights.bin',new Response('corrupt A weights'));
    else if(failure==='index')oldModel.set(origin+'/offline-model/index.json',new Response('{invalid index'));
    else oldModel.delete(origin+'/offline-model/tfjs/weights.bin');
    const b=harness({maps:a.maps,resources:{...bodies,'/assets/main-a.js':'new core'},missing:'/offline-model/weights.bin'});
    await b.lifecycle('install'); await b.lifecycle('activate'); b.setOffline();
    assert.equal(await (await b.request('/offline.html',{mode:'navigate'})).text(),bodies['/offline.html']);
    assert.equal((await b.request('/offline-model/index.json')).type,'error');
    b.restore(); assert.equal((await b.prepare()).reply.ok,true);
  }
});

test('fresh optional failure repairs explicitly on same active worker then survives offline cold use', async () => {
  const worker = harness({missing:'/offline-model/weights.bin'});
  await worker.lifecycle('install'); await worker.lifecycle('activate');
  assert.equal((await worker.prepare()).reply?.ok, false);
  worker.restore();
  const {reply,closed} = await worker.prepare();
  assert.equal(reply?.ok,true); assert.equal(closed,true);
  assert.equal(reply.version, worker.manifest.version);
  assert.equal(reply.modelVersion,'automotive-damage-mobilenetv2-v1');
  const cold = harness({maps:worker.maps}); cold.setOffline();
  for(const path of Object.keys(bodies).filter(path=>path.startsWith('/offline-model/')))
    assert.equal(await (await cold.request(path)).text(),bodies[path]);
});

test('storage failure retries on same worker; concurrent bounded requests share one atomic download', async () => {
  const worker = harness({failModelWrite:true}); await worker.lifecycle('install'); await worker.lifecycle('activate');
  assert.equal((await worker.prepare()).reply.code,'MODEL_PREPARATION_FAILED');
  worker.restore(); const before=worker.fetched.length;
  const replies=await Promise.all(Array.from({length:12},(_,i)=>worker.prepare({type:'AUTONEXUS_PREPARE_MODEL',protocol:1,requestId:'request-'+i})));
  assert.equal(replies.filter(result=>result.reply?.ok).length,8);
  assert.equal(replies.filter(result=>result.reply?.code==='MODEL_BUSY').length,4);
  assert.ok(replies.every(result=>result.closed));
  assert.equal(worker.fetched.length-before,Object.keys(bodies).filter(path=>path.startsWith('/offline-model/')).length);
});

test('incomplete/corrupt model cache never mixes cached index with network weights and can repair', async () => {
  const worker=harness(); await worker.lifecycle('install');
  const model=worker.maps.get(worker.cacheName+'-model');
  model.set(origin+'/offline-model/weights.bin',new Response('incompatible weights'));
  const before=worker.fetched.length;
  assert.equal((await worker.request('/offline-model/index.json')).type,'error');
  assert.equal(worker.fetched.length,before);
  assert.equal((await worker.prepare()).reply.ok,true);
  worker.maps.get(worker.cacheName+'-model').delete(origin+'/offline-model/weights.bin');
  assert.equal((await worker.request('/offline-model/model.json')).type,'error');
  assert.equal((await worker.prepare()).reply.ok,true);
});

test('preparation rejects untrusted sources and caller URLs without fetching them', async () => {
  const worker = harness(); await worker.lifecycle('install');
  const before=worker.fetched.length;
  for(const [data,source] of [
    [{type:'AUTONEXUS_PREPARE_MODEL',protocol:1,requestId:'x',url:'/api/private'}, {id:'page'}],
    [{type:'AUTONEXUS_PREPARE_MODEL',protocol:1,requestId:'x'}, {id:'foreign'}],
  ]) {
    const result=await worker.prepare(data,source);
    assert.notEqual(result.reply?.ok,true); assert.equal(result.closed,true);
  }
  assert.equal(worker.fetched.length,before);
});
