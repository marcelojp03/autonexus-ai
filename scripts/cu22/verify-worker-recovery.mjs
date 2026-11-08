import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const { chromium } = createRequire(new URL('web/mf-employees/package.json', root))(
  fileURLToPath(new URL('web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright', root)));
const source = readFileSync(new URL('web/shell/public/sw.js', root), 'utf8');
assert.equal(source.split('/* OFFLINE_MANIFEST */ null').length, 2);
const sha = body => createHash('sha256').update(body).digest('hex');
function fixture(version) {
  const bodies = new Map([
    ['/offline.html', '<!doctype html><title>CU22 synthetic ' + version + '</title>'],
    ['/offline-model/vendor/tf.min.js', '/* synthetic runtime ' + version + ' */'],
    ['/offline-model/tfjs/model.json', JSON.stringify({ weightsManifest: [{ paths: ['weights.bin'], weights: [] }] })],
    ['/offline-model/tfjs/weights.bin', 'synthetic weights ' + version],
    ['/offline-model/manifest.json', JSON.stringify({ synthetic: version })],
    ['/offline-model/quality.json', JSON.stringify({ status: 'not_validated', synthetic: version })]
  ].map(([url, body]) => [url, Buffer.from(body)]));
  const files = [...bodies].filter(([url]) => url.startsWith('/offline-model/')).map(([url, body]) => ({ url, bytes: body.length, sha256: sha(body) }));
  bodies.set('/offline-model/index.json', Buffer.from(JSON.stringify({ schemaVersion: 1,
    modelVersion: 'synthetic-' + version, runId: 'synthetic-run-' + version,
    modelUrl: '/offline-model/tfjs/model.json', runtime: { url: '/offline-model/vendor/tf.min.js', sha256: sha(bodies.get('/offline-model/vendor/tf.min.js')) }, files })));
  const resources = [...bodies].map(([url, body]) => ({ url, sha256: sha(body) }));
  const manifest = { version: sha(JSON.stringify(resources)), resources, modelReady: true };
  return { bodies, manifest, worker: source.replace('/* OFFLINE_MANIFEST */ null', JSON.stringify(manifest)) };
}
const a = fixture('A'), b = fixture('B');
let current = a, fault = false;
const requests = [];
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  requests.push(path); response.setHeader('Cache-Control', 'no-store');
  if (path === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(current.worker);
  } else if (path === '/') {
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>CU22 harness</title>');
  } else if (fault && path === '/offline-model/tfjs/weights.bin') {
    // Wrong bytes with HTTP 200 must fail SRI rather than become a prepared model.
    response.end('incomplete synthetic deployment');
  } else if (current.bodies.has(path)) {
    response.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    response.end(current.bodies.get(path));
  } else response.writeHead(404).end();
});
const profiles = mkdtempSync(join(tmpdir(), 'cu22-worker-'));
let context;
const checks = [];
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const launch = (profile, offline = false) => chromium.launchPersistentContext(join(profiles, profile), { headless: true, offline });
async function controlled(page) {
  await page.goto(origin + '/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
}
async function prepare(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const channel = new MessageChannel(), requestId = crypto.randomUUID();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('PREPARATION_TIMEOUT')); }, 35000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
    navigator.serviceWorker.controller.postMessage({ type: 'AUTONEXUS_PREPARE_MODEL', protocol: 1, requestId }, [channel.port2]);
  }));
}
async function verify(page, expected) {
  const result = await page.evaluate(async resources => {
    const hashes = {};
    for (const {url} of resources) {
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) throw new Error('RESOURCE_UNAVAILABLE:' + url);
      hashes[url] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return hashes;
  }, expected.manifest.resources.filter(resource => resource.url !== '/offline.html'));
  for (const [url, hash] of Object.entries(result)) assert.equal(hash, sha(expected.bodies.get(url)), url);
}
async function update(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const terminal = new Promise(resolve => registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      const changed = () => { if (['installed', 'redundant'].includes(worker.state)) resolve(worker.state); };
      worker.addEventListener('statechange', changed); changed();
    }, { once: true }));
    await registration.update(); return terminal;
  });
}
async function coldboot(profile, expected) {
  // Playwright's page offline switch does not consistently cover the worker's own
  // network stack. Stop the private fixture server too, proving no online dependency.
  const port = server.address().port;
  await context.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  context = await launch(profile, true);
  const page = await context.newPage(), before = requests.length;
  await page.goto(origin + '/offline.html');
  assert.equal(await page.title(), 'CU22 synthetic ' + (expected === a ? 'A' : 'B'));
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
  await verify(page, expected);
  assert.equal(requests.length, before, 'cold boot must not contact the fixture server');
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
}
try {
  context = await launch('update');
  let page = await context.newPage(); await controlled(page);
  assert.equal((await prepare(page)).ok, true); await verify(page, a);
  current = b; fault = true;
  assert.equal(await update(page), 'redundant');
  assert.equal((await prepare(page)).version, a.manifest.version);
  assert.deepEqual((await page.evaluate(() => caches.keys())).sort(), ['autonexus-static-' + a.manifest.version, 'autonexus-static-' + a.manifest.version + '-model'].sort());
  await context.setOffline(true); await verify(page, a);
  await page.goto(origin + '/offline.html'); assert.equal(await page.title(), 'CU22 synthetic A');
  checks.push('A installed; incomplete B rejected by SRI; A resources and offline navigation retained');
  await context.setOffline(false); fault = false;
  assert.equal(await update(page), 'installed');
  assert.equal((await prepare(page)).version, a.manifest.version, 'waiting B must not replace the controlling A');
  await page.close(); page = await context.newPage(); await controlled(page);
  const receipt = await prepare(page);
  assert.equal(receipt.ok, true); assert.equal(receipt.version, b.manifest.version); await verify(page, b);
  assert.deepEqual((await page.evaluate(() => caches.keys())).sort(), ['autonexus-static-' + b.manifest.version, 'autonexus-static-' + b.manifest.version + '-model'].sort());
  await coldboot('update', b);
  checks.push('complete B waits for A clients; compatible B activation and offline browser cold boot');
  await context.close(); current = b; fault = true;
  context = await launch('retry'); page = await context.newPage(); await controlled(page);
  await page.evaluate(() => { window.originalWorker = navigator.serviceWorker.controller; });
  const failed = await prepare(page);
  assert.equal(failed.ok, false); assert.equal(failed.code, 'MODEL_PREPARATION_FAILED');
  assert.equal(await page.evaluate(version => caches.has('autonexus-static-' + version + '-model'), b.manifest.version), false);
  fault = false;
  const retry = await prepare(page);
  assert.equal(retry.ok, true); assert.equal(retry.version, b.manifest.version);
  assert.equal(await page.evaluate(() => navigator.serviceWorker.controller === window.originalWorker), true);
  await verify(page, b); await coldboot('retry', b);
  checks.push('basic installation without previous model; preparation failure; explicit same-worker retry; offline browser cold boot');
  console.log(JSON.stringify({ pass: true, chromium: context.browser().version(), checks,
    limitations: ['Synthetic resources only; no real model inference, quality, shared runtime, credentials or backend integration tested.'] }, null, 2));
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  rmSync(profiles, { recursive: true, force: true });
}
