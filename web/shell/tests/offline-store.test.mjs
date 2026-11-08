import assert from 'node:assert/strict';
import { after, before, beforeEach, afterEach, test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';

const require = createRequire(new URL('../../mf-employees/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
let browser;
let server;
let context;
let page;
let origin;

before(async () => {
  const sources = Object.fromEntries(await Promise.all(['store', 'transfer', 'review'].map(async name =>
    ['/' + name + '.ts', stripTypeScriptTypes(await readFile(new URL('../src/offline/' + name + '.ts', import.meta.url), 'utf8'))])));
  server = createServer((req, res) => {
    res.setHeader('Content-Type', sources[req.url] ? 'text/javascript' : 'text/html');
    res.end(sources[req.url] ?? '<!doctype html><title>Offline store test</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(async () => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async () => {
    const module = await import('/store.ts');
    window.openStore = module.openOfflineStore;
    window.store = await window.openStore();
    window.work = subject => ({ subject, assignmentId: 'a1', orderId: 'o1', orderNumber: 'OT-1', version: 1,
      preparedAt: '2026-11-01T00:00:00Z', expiresAt: '2026-11-08T00:00:00Z' });
    window.item = (subject, operationId = 'op1') => ({ subject, operationId, assignmentId: 'a1', baseVersion: 1,
      description: 'Inspection', minutesWorked: 5, createdAt: '2026-11-01T00:00:00Z', state: 'pending' });
  });
});

afterEach(async () => { await context?.close(); });

test('real IndexedDB isolates works and queue by required subject', async () => {
  assert.deepEqual(await page.evaluate(async () => {
    await store.saveWork(work('alice'));
    await store.saveWork({ ...work('bob'), orderNumber: 'OT-2' });
    await store.enqueue(item('alice'));
    await store.enqueue(item('bob', 'op2'));
    return [(await store.works('alice')).map(w => w.orderNumber),
      (await store.works('bob')).map(w => w.orderNumber),
      (await store.queue('alice')).map(q => q.operationId), await store.works('charlie')];
  }), [['OT-1'], ['OT-2'], ['op1'], []]);
});

test('every subject query and mutation rejects absent or blank ownership', async () => {
  const errors = await page.evaluate(async () => {
    const errors = [];
    for (const subject of [undefined, null, '', '   ']) {
      for (const action of [() => store.works(subject), () => store.queue(subject), () => store.forget(subject),
        () => store.setLocalSubject(subject), () => store.recoverInterrupted(subject),
        () => store.saveWork(work(subject)), () => store.enqueue(item(subject)), () => store.update(item(subject))]) {
        try { await action(); errors.push('unexpected success'); } catch (error) { errors.push(error.message); }
      }
    }
    return errors;
  });
  assert.equal(errors.length, 32);
  assert.ok(errors.every(error => error === 'OFFLINE_SUBJECT_REQUIRED'));
});

test('duplicate enqueue never replaces data and an operation cannot change owners', async () => {
  assert.deepEqual(await page.evaluate(async () => {
    await store.enqueue(item('alice'));
    const errors = [];
    for (const action of [() => store.enqueue({ ...item('alice'), description: 'Replacement' }),
      () => store.enqueue(item('bob')), () => store.update(item('bob')), () => store.update(item('alice', 'missing'))]) {
      try { await action(); } catch (error) { errors.push(error.message); }
    }
    return [errors, (await store.queue('alice'))[0].description, await store.queue('bob')];
  }), [['OFFLINE_DUPLICATE_OPERATION', 'OFFLINE_OWNER_MISMATCH', 'OFFLINE_OWNER_MISMATCH', 'OFFLINE_OPERATION_NOT_FOUND'], 'Inspection', []]);
});

test('blob, inference, human review and progress survive database close/reopen', async () => {
  assert.deepEqual(await page.evaluate(async () => {
    const clientInference = { runId: 'r1', modelVersion: 'experimental-v1', imageSha256: 'image-hash',
      labels: [{ name: 'dent', score: 0.8 }], humanReview: { modelVersion: 'experimental-v1', labels: ['scratch'] } };
    await store.enqueue({ ...item('alice'), photo: new Blob(['photo bytes'], { type: 'image/jpeg' }),
      photoSha256: 'image-hash', clientInference, progress: { evidenceId: 'e1', uploaded: false } });
    store.close();
    window.store = await openStore();
    const saved = (await store.queue('alice'))[0];
    return [await saved.photo.text(), saved.photo.type, saved.photoSha256, saved.clientInference, saved.progress];
  }), ['photo bytes', 'image/jpeg', 'image-hash', { runId: 'r1', modelVersion: 'experimental-v1', imageSha256: 'image-hash',
    labels: [{ name: 'dent', score: 0.8 }], humanReview: { modelVersion: 'experimental-v1', labels: ['scratch'] } },
  { evidenceId: 'e1', uploaded: false }]);
});

test('recoverInterrupted changes only sending records of that subject', async () => {
  assert.deepEqual(await page.evaluate(async () => {
    await store.enqueue({ ...item('alice'), state: 'sending', progress: { evidenceId: 'e1' } });
    await store.enqueue({ ...item('alice', 'conflict'), state: 'conflict' });
    await store.enqueue({ ...item('bob', 'bob-op'), state: 'sending' });
    await store.recoverInterrupted('alice');
    return [(await store.queue('alice')).map(q => [q.operationId, q.state, q.progress?.evidenceId ?? null]),
      (await store.queue('bob'))[0].state];
  }), [[['conflict', 'conflict', null], ['op1', 'pending', 'e1']], 'sending']);
});

test('forget removes only that subject and clears a matching local subject atomically', async () => {
  assert.deepEqual(await page.evaluate(async () => {
    for (const subject of ['alice', 'bob']) {
      await store.saveWork(work(subject));
      await store.enqueue(item(subject, subject + '-op'));
    }
    await store.setLocalSubject('bob');
    await store.forget('alice');
    const retained = await store.localSubject();
    await store.forget('bob');
    return [retained, await store.localSubject(), await store.works('alice'), await store.queue('alice'),
      await store.works('bob'), await store.queue('bob')];
  }), ['bob', null, [], [], [], []]);
});

test('credential fields are rejected, including nested synchronization progress', async () => {
  const result = await page.evaluate(async () => {
    const errors = [];
    for (const extra of [{ accessToken: 'private' }, { Authorization: 'private' },
      { progress: { upload: { presignedUrl: 'private' } } }, { progress: { refresh_token: 'private' } }]) {
      try { await store.enqueue({ ...item('alice'), ...extra }); } catch (error) { errors.push(error.message); }
    }
    try { await store.saveWork({ ...work('alice'), password: 'private' }); } catch (error) { errors.push(error.message); }
    return [errors, await store.queue('alice'), await store.works('alice')];
  });
  assert.deepEqual(result, [Array(5).fill('OFFLINE_CREDENTIAL_FIELD'), [], []]);
});

test('a successful request followed by transaction abort rejects without persisting', async () => {
  assert.deepEqual(await page.evaluate(async () => {
    const original = IDBObjectStore.prototype.put;
    let requestSucceeded = false;
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args);
      const tx = this.transaction;
      request.addEventListener('success', () => { requestSucceeded = true; tx.abort(); }, { once: true });
      return request;
    };
    let errorName;
    try { await store.saveWork(work('alice')); } catch (error) { errorName = error.name; }
    finally { IDBObjectStore.prototype.put = original; }
    return [requestSucceeded, errorName, await store.works('alice')];
  }), [true, 'Error', []]);
});

test('mutation promise resolves after the transaction complete event', async () => {
  assert.equal(await page.evaluate(async () => {
    const original = IDBDatabase.prototype.transaction;
    let committed = false;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = original.apply(this, args);
      tx.addEventListener('complete', () => { committed = true; });
      return tx;
    };
    try { await store.saveWork(work('alice')); return committed; }
    finally { IDBDatabase.prototype.transaction = original; }
  }), true);
});

test('manual review survives IndexedDB close and reopen without model and leaves legacy rows untouched', async () => {
  const result = await page.evaluate(async () => {
    const legacy = window.item('actor-a', 'legacy'); await window.store.enqueue(legacy);
    const inspectionReview = { schemaVersion: 1, mode: 'manual', reason: 'model_unavailable', interpretation: 'Revisión del panel', labels: [], reviewedAt: '2026-11-07T12:00:00Z' };
    await window.store.enqueue({ ...window.item('actor-a', 'manual'), inspectionReview });
    window.store.close(); window.store = await window.openStore(); return window.store.queue('actor-a');
  });
  assert.equal(result.find(row => row.operationId === 'manual').inspectionReview.mode, 'manual');
  assert.equal(result.find(row => row.operationId === 'manual').clientInference, undefined);
  assert.equal(result.find(row => row.operationId === 'legacy').inspectionReview, undefined);
});

test('bounded Chromium quota rejects a real write without replacing data; same ID retries once', async () => {
  // Set quota before the first IDB write: an already-open client may retain its old write budget.
  const quotaContext = await browser.newContext();
  const quotaPage = await quotaContext.newPage();
  const cdp = await quotaContext.newCDPSession(quotaPage);
  try {
    // Browser-level quota, not a mocked successful/failed IndexedDB request. Maximum payload 2 MiB.
    await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 256 * 1024 });
    await quotaPage.goto(origin);
    const quota = await cdp.send('Storage.getUsageAndQuota', { origin });
    assert.equal(quota.overrideActive, true);
    assert.equal(quota.quota, 256 * 1024);
    const failed = await quotaPage.evaluate(async () => {
      window.openStore = (await import('/store.ts')).openOfflineStore;
      window.store = await window.openStore();
      window.item = operationId => ({subject:'actor-a',operationId,assignmentId:'a1',baseVersion:1,description:'Inspection',minutesWorked:5,createdAt:'2026-11-07T00:00:00Z',state:'pending'});
      await window.store.enqueue(window.item('previous'));
      const bytes = new Uint8Array(2 * 1024 * 1024);
      for (let offset = 0; offset < bytes.length; offset += 65536) crypto.getRandomValues(bytes.subarray(offset, offset + 65536));
      window.quotaItem = { ...window.item('quota-retry'), photo: new Blob([bytes], { type: 'image/jpeg' }) };
      let code = null;
      try { await window.store.enqueue(window.quotaItem); } catch (error) { code = error.name; }
      return { code, ids: (await window.store.queue('actor-a')).map(row => row.operationId) };
    });
    assert.equal(failed.code, 'QuotaExceededError');
    assert.deepEqual(failed.ids, ['previous']);
    await cdp.send('Storage.overrideQuotaForOrigin', { origin });
    const after = await quotaPage.evaluate(async () => {
      await window.store.enqueue(window.quotaItem);
      window.store.close(); window.store = await window.openStore();
      return (await window.store.queue('actor-a')).map(row => ({ id: row.operationId, bytes: row.photo?.size ?? 0 }));
    });
    assert.deepEqual(after, [{ id: 'previous', bytes: 0 }, { id: 'quota-retry', bytes: 2 * 1024 * 1024 }]);
  } finally {
    await cdp.send('Storage.overrideQuotaForOrigin', { origin });
    await cdp.detach();
    await quotaContext.close();
  }
});
