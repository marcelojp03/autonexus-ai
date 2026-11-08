import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { createOfflineCopy, decodeOfflineCopy, validateOfflineRecords } from '../src/offline/transfer.ts';

const subject = 'mechanic-test';
const assignmentId = '22222222-2222-4222-8222-222222222222';
const operationId = '11111111-1111-4111-8111-111111111111';
const orderId = '33333333-3333-4333-8333-333333333333';
const createdAt = '2026-11-01T00:00:00.000Z';
const sourceOrigin = 'http://localhost:4285';
const work = { subject, assignmentId, orderId, orderNumber: 'OT-test', version: 3, preparedAt: createdAt,
  expiresAt: '2026-11-08T00:00:00.000Z' };
const item = { subject, assignmentId, operationId, baseVersion: 3, description: 'Test inspection',
  minutesWorked: 15, createdAt, state: 'sending' };
const operation = { operationId, entity: 'advance', target: { assignmentId }, baseVersion: 3, dependsOn: [],
  payload: { operationId, expectedVersion: 3, description: item.description, minutesWorked: 15 } };
const progress = { steps: { [operationId]: { input: { overlayId: orderId, deviceId: 'shell-offline',
  createdAt, operationsJson: JSON.stringify([operation]) }, registered: true } } };
const bytes = Uint8Array.from([255, 216, 255, 224, 0, 2, 255, 217]);
const photoSha256 = createHash('sha256').update(bytes).digest('hex');
const clientInference = { runId: 'test-run', modelVersion: 'test-model', imageSha256: photoSha256,
  labels: [{ name: 'dent', score: 0.75 }], humanReview: { modelVersion: 'test-model', labels: ['scratch'] } };
const raw = () => ({ version: 1, subject, sourceOrigin, createdAt, works: [structuredClone(work)],
  queue: [{ ...structuredClone(item), progress: structuredClone(progress), photoSha256, clientInference: structuredClone(clientInference),
    photo: { mime: 'image/jpeg', base64: Buffer.from(bytes).toString('base64') } }] });
const jsonBlob = value => new Blob([JSON.stringify(value)], { type: 'application/json' });

test('deterministic version-one JSON restores exact IDs, photo bytes, inference, progress and sending state', async () => {
  const decoded = await decodeOfflineCopy(jsonBlob(raw()), subject);
  assert.deepEqual(decoded.works, [work]);
  const saved = decoded.queue[0];
  assert.deepEqual(new Uint8Array(await saved.photo.arrayBuffer()), bytes);
  assert.equal(saved.photo.type, 'image/jpeg');
  assert.deepEqual({ ...saved, photo: undefined }, { ...raw().queue[0], photo: undefined });
  for (const state of ['pending', 'sending', 'applied', 'conflict', 'rejected', 'needs-reupload']) {
    const copy = raw(); copy.queue[0].state = state;
    assert.equal((await decodeOfflineCopy(jsonBlob(copy), subject)).queue[0].state, state);
  }
});

test('export is JSON only, does not mutate source, and contains only the explicit local records', async () => {
  const decoded = await decodeOfflineCopy(jsonBlob(raw()), subject);
  const before = structuredClone(decoded);
  const store = { works: async who => { assert.equal(who, subject); return decoded.works; },
    queue: async who => { assert.equal(who, subject); return decoded.queue; } };
  const blob = await createOfflineCopy(store, subject, sourceOrigin);
  assert.equal(blob.type, 'application/json');
  const serialized = JSON.parse(await blob.text());
  assert.deepEqual(Object.keys(serialized), ['version', 'subject', 'sourceOrigin', 'createdAt', 'works', 'queue']);
  assert.deepEqual(serialized.queue, raw().queue);
  assert.deepEqual(decoded, before);
  assert.deepEqual(await decodeOfflineCopy(blob, subject), before);
});

test('wrong subjects, unknown keys at every level, serialized credentials and prototype pointers are refused', async () => {
  await assert.rejects(decodeOfflineCopy(jsonBlob(raw()), 'another-subject'), /SUBJECT/);
  const mutations = [
    copy => { copy.version = 3; },
    copy => { copy.authState = {}; },
    copy => { copy.works[0].runtime = {}; },
    copy => { copy.queue[0].cache = {}; },
    copy => { copy.queue[0]['photo?'] = {}; },
    copy => { copy.queue[0].photo.url = 'not-allowed'; },
    copy => { copy.queue[0].clientInference.labels[0].url = 'not-allowed'; },
    copy => { copy.queue[0].clientInference.humanReview.bearer = 'private'; },
    copy => { copy.queue[0].progress.authorization = 'private'; },
    copy => { copy.queue[0].progress.steps[operationId].input.operationsJson = JSON.stringify([{ ...operation, payload: { ...operation.payload, accessToken: 'private' } }]); },
    copy => { copy.queue[0].progress.steps[operationId].input.operationsJson = JSON.stringify([{ ...operation, target: { assignmentId, url: 'not-allowed' } }]); },
    copy => { copy.queue[0].progress.steps[operationId].input.url = 'not-allowed'; },
    copy => { copy.queue[0].progress.steps[operationId].registered = 'true'; },
    copy => { copy.queue[0].progress.steps[operationId].input.operationsJson = '{}'; },
    copy => { copy.queue[0].progress = JSON.parse('{"__proto__":{"polluted":true}}'); },
    copy => { copy.queue[0].subject = 'another-subject'; },
    copy => { copy.works[0].assignmentId = 'not-a-uuid'; },
    copy => { copy.queue[0].operationId = 'not-a-uuid'; },
    copy => { copy.sourceOrigin = sourceOrigin + '/path'; },
    copy => { copy.queue[0].progress.steps[operationId].input.deviceId = 'https://untrusted.invalid'; },
  ];
  for (const mutate of mutations) {
    const copy = raw(); mutate(copy);
    await assert.rejects(decodeOfflineCopy(jsonBlob(copy), subject));
  }
});

test('file/count/photo bounds, signatures, SHA-256, finite scores and model versions are checked before restore', async () => {
  const mutations = [
    copy => { copy.works = Array(51).fill(copy.works[0]); },
    copy => { copy.queue = Array(51).fill(copy.queue[0]); },
    copy => { copy.queue.push(structuredClone(copy.queue[0])); },
    copy => { copy.works.push(structuredClone(copy.works[0])); },
    copy => { copy.queue[0].photo.mime = 'image/png'; },
    copy => { copy.queue[0].photo.base64 = '%%%='; },
    copy => { copy.queue[0].photoSha256 = '0'.repeat(64); },
    copy => { copy.queue[0].clientInference.imageSha256 = '0'.repeat(64); },
    copy => { copy.queue[0].clientInference.labels[0].score = 1.01; },
    copy => { copy.queue[0].clientInference.labels[0].score = null; },
    copy => { copy.queue[0].clientInference.humanReview.modelVersion = 'different'; },
    copy => { delete copy.queue[0].photo; },
    copy => { copy.queue[0].photo.base64 = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'); },
  ];
  for (const mutate of mutations) {
    const copy = raw(); mutate(copy);
    await assert.rejects(decodeOfflineCopy(jsonBlob(copy), subject));
  }
  await assert.rejects(decodeOfflineCopy(new Blob([new Uint8Array(32 * 1024 * 1024 + 1)]), subject), /TOO_LARGE/);
  const copy = await decodeOfflineCopy(jsonBlob(raw()), subject);
  copy.queue[0].clientInference.labels[0].score = Infinity;
  await assert.rejects(validateOfflineRecords(copy));
});

let browser;
let server;
let origin;
before(async () => {
  const require = createRequire(new URL('../../mf-employees/package.json', import.meta.url));
  const { chromium } = require('@playwright/test');
  const sources = Object.fromEntries(await Promise.all(['store', 'transfer', 'review'].map(async name =>
    ['/' + name + '.ts', stripTypeScriptTypes(await readFile(new URL('../src/offline/' + name + '.ts', import.meta.url), 'utf8'))])));
  server = createServer((req, res) => {
    res.setHeader('Content-Type', sources[req.url] ? 'text/javascript' : 'text/html');
    res.end(sources[req.url] ?? '<!doctype html><title>Offline copy test</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

test('Chromium IndexedDB roundtrip leaves source untouched, preserves bytes and states, then recovers only sending', async () => {
  const sourceContext = await browser.newContext();
  const targetContext = await browser.newContext();
  try {
    const source = await sourceContext.newPage();
    const target = await targetContext.newPage();
    await source.goto(origin); await target.goto(origin);
    const exported = await source.evaluate(async ({ work, item, progress, sourceOrigin }) => {
      const { openOfflineStore } = await import('/store.ts');
      const { createOfflineCopy } = await import('/transfer.ts');
      window.store = await openOfflineStore();
      const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
      const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
      const photoSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await photo.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
      await store.saveWork(work);
      for (const [index, state] of ['sending', 'conflict', 'rejected'].entries()) {
        await store.enqueue({ ...item, operationId: item.operationId.replace(/^1/, String(index + 1)), state,
          ...(index === 0 ? { photo, photoSha256, progress, clientInference: { runId: 'test-run', modelVersion: 'test-model', imageSha256: photoSha256,
            labels: [{ name: 'dent', score: 0.75 }], humanReview: { modelVersion: 'test-model', labels: ['scratch'] } } } : {}) });
      }
      window.copyText = await (await createOfflineCopy(store, item.subject, sourceOrigin)).text();
      return copyText;
    }, { work, item, progress, sourceOrigin });
    const result = await target.evaluate(async ({ exported, subject }) => {
      const { openOfflineStore } = await import('/store.ts');
      const { decodeOfflineCopy, createOfflineCopy } = await import('/transfer.ts');
      const store = await openOfflineStore();
      const copy = await decodeOfflineCopy(new Blob([exported]), subject);
      await store.restoreCopy(copy);
      store.close();
      const reopened = await openOfflineStore();
      const roundtrip = JSON.parse(await (await createOfflineCopy(reopened, subject, location.origin)).text());
      const before = (await reopened.queue(subject)).map(row => row.state);
      await reopened.recoverInterrupted(subject);
      const after = (await reopened.queue(subject)).map(row => row.state);
      const localSubject = await reopened.localSubject(); reopened.close();
      return { works: roundtrip.works, queue: roundtrip.queue, before, after, localSubject };
    }, { exported, subject });
    const serialized = JSON.parse(exported);
    assert.deepEqual(result.works, serialized.works);
    assert.deepEqual(result.queue, serialized.queue);
    assert.deepEqual(result.before, ['sending', 'conflict', 'rejected']);
    assert.deepEqual(result.after, ['pending', 'conflict', 'rejected']);
    assert.equal(result.localSubject, subject);
    assert.equal(await source.evaluate(async () => {
      const { createOfflineCopy } = await import('/transfer.ts');
      const before = JSON.parse(copyText);
      const after = JSON.parse(await (await createOfflineCopy(store, before.subject, before.sourceOrigin)).text());
      delete before.createdAt; delete after.createdAt;
      return JSON.stringify(before) === JSON.stringify(after);
    }), true);
  } finally { await sourceContext.close(); await targetContext.close(); }
});

test('Chromium refuses occupied targets, cross-owner collisions and wrong subject without any writes', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto(origin);
    const result = await page.evaluate(async ({ work, item, subject, raw }) => {
      const { openOfflineStore } = await import('/store.ts');
      const { decodeOfflineCopy } = await import('/transfer.ts');
      const store = await openOfflineStore();
      const copy = { subject, works: [work], queue: [item] };
      const errors = [];
      await store.enqueue({ ...item, subject: 'other' });
      const originalAdd = IDBObjectStore.prototype.add;
      const originalPut = IDBObjectStore.prototype.put;
      let writes = 0;
      IDBObjectStore.prototype.add = function (...args) { writes++; return originalAdd.apply(this, args); };
      IDBObjectStore.prototype.put = function (...args) { writes++; return originalPut.apply(this, args); };
      try {
        try { await store.restoreCopy(copy); } catch (error) { errors.push(error.message); }
        try { await store.restoreCopy({ ...copy, queue: [{ ...item, subject: 'wrong' }] }); } catch (error) { errors.push(error.message); }
        try { await decodeOfflineCopy(new Blob([JSON.stringify(raw)]), 'wrong'); } catch (error) { errors.push(error.message); }
      } finally { IDBObjectStore.prototype.add = originalAdd; IDBObjectStore.prototype.put = originalPut; }
      const unchanged = [await store.works(subject), await store.queue(subject), await store.localSubject(), (await store.queue('other')).length];
      await store.saveWork(work);
      try { await store.restoreCopy({ ...copy, queue: [] }); } catch (error) { errors.push(error.message); }
      await store.forget(subject);
      await store.setLocalSubject('other');
      try { await store.restoreCopy({ ...copy, queue: [] }); } catch (error) { errors.push(error.message); }
      const owner = await store.localSubject(); store.close();
      return { errors, writes, unchanged, owner };
    }, { work, item, subject, raw: raw() });
    assert.deepEqual(result.errors, ['OFFLINE_DUPLICATE_OPERATION', 'OFFLINE_COPY_OWNER_OR_DUPLICATE',
      'OFFLINE_COPY_SUBJECT_OR_VERSION', 'OFFLINE_COPY_TARGET_NOT_EMPTY', 'OFFLINE_OWNER_MISMATCH']);
    assert.equal(result.writes, 0);
    assert.deepEqual(result.unchanged, [[], [], null, 1]);
    assert.equal(result.owner, 'other');
  } finally { await context.close(); }
});

test('Chromium abort after a successful insert rolls back works, queue and local subject together', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); await page.goto(origin);
    assert.deepEqual(await page.evaluate(async copy => {
      const { openOfflineStore } = await import('/store.ts');
      const store = await openOfflineStore();
      const original = IDBObjectStore.prototype.add;
      let inserted = false;
      IDBObjectStore.prototype.add = function (...args) {
        const request = original.apply(this, args);
        request.addEventListener('success', () => { inserted = true; this.transaction.abort(); }, { once: true });
        return request;
      };
      let rejected = false;
      try { await store.restoreCopy(copy); } catch { rejected = true; }
      finally { IDBObjectStore.prototype.add = original; }
      const result = [inserted, rejected, await store.works(copy.subject), await store.queue(copy.subject), await store.localSubject()];
      store.close(); return result;
    }, { subject, works: [work], queue: [item] }), [true, true, [], [], null]);
  } finally { await context.close(); }
});

test('format two roundtrips independent manual review and rejects malformed optional review fields', async () => {
  const inspectionReview = { schemaVersion: 1, mode: 'manual', reason: 'inference_failed', interpretation: 'Revisión independiente', labels: ['dent'], reviewedAt: createdAt };
  const store = { works: async () => [work], queue: async () => [{ ...item, inspectionReview }] };
  const blob = await createOfflineCopy(store, subject, sourceOrigin); const rawCopy = JSON.parse(await blob.text());
  assert.equal(rawCopy.version, 2); assert.deepEqual((await decodeOfflineCopy(blob, subject)).queue[0].inspectionReview, inspectionReview);
  for (const bad of [null, { ...inspectionReview, labels: null }, { ...inspectionReview, mode: 'assisted' }, { ...inspectionReview, labels: ['dent', 'dent'] }]) {
    const copy = structuredClone(rawCopy); copy.queue[0].inspectionReview = bad; await assert.rejects(decodeOfflineCopy(jsonBlob(copy), subject));
  }
});
