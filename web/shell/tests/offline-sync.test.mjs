import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { syncPending, REGISTER_SYNC, PUSH_SYNC, LOOKUP_SYNC, EXECUTION_VERSION } from '../src/offline/sync.ts';

// Deterministic client/coordinator doubles: these are unit tests, not real integration evidence.
const subject = 'mechanic-a';
const operationId = '11111111-1111-4111-8111-111111111111';
const assignmentId = '22222222-2222-4222-8222-222222222222';
const advanceId = '33333333-3333-4333-8333-333333333333';
const evidenceId = '44444444-4444-4444-8444-444444444444';
const hash = createHash('sha256').update('photo').digest('hex');
const ok = (field, body) => ({ data: { [field]: body } });
const failure = (statusCode, code) => ({ errors: [{ statusCode, code, message: code }] });

function fixture({ photo = false, inference = false } = {}) {
  let current = subject;
  const listeners = new Set();
  const state = {
    item: { operationId, subject, assignmentId, baseVersion: 3, description: 'Inspection', minutesWorked: 12,
      createdAt: '2026-01-01T00:00:00.000Z', state: 'pending',
      ...(photo ? { photo: new Blob(['photo'], { type: 'image/jpeg' }), photoSha256: hash } : {}),
      ...(inference ? { clientInference: { runId: 'experimental-run', modelVersion: 'model-v1', imageSha256: hash,
        labels: [{ name: 'scratch', score: 0.4 }], humanReview: { modelVersion: 'model-v1', labels: ['dent'] } } } : {}) },
    work: { subject, assignmentId, expiresAt: '2099-01-01T00:00:00Z' },
    calls: [], writes: [], owners: [], overlays: new Map(), operations: new Map(), attempt: 1,
    hook: undefined, put: undefined, missing: false,
  };
  const store = {
    async queue(who) { assert.equal(who, subject); return [structuredClone(state.item)]; },
    async works(who) { assert.equal(who, subject); return [structuredClone(state.work)]; },
    async update(item) { assert.equal(current, subject); state.item = structuredClone(item); state.writes.push(structuredClone(item)); },
  };
  function switchTo(next) { current = next; for (const listener of listeners) listener(session.snapshot()); }
  const session = {
    snapshot() { return { phase: current ? 'authenticated' : 'anonymous', authenticated: !!current, identity: current ? { subject: current } : null }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async requestBusiness(query, variables) {
      assert.equal(current, subject);
      state.calls.push({ query, variables: structuredClone(variables) });
      const intercepted = await state.hook?.(query, variables);
      if (intercepted !== undefined) return intercepted;
      if (query === REGISTER_SYNC) {
        const input = variables.input;
        const [operation] = JSON.parse(input.operationsJson);
        assert.ok(state.item.progress.steps[operation.operationId], 'step persisted before registration');
        assert.deepEqual(state.item.progress.steps[operation.operationId].input, input);
        assert.equal('subject' in operation, false);
        assert.equal('subject' in input, false);
        assert.match(operation.operationId, /^[a-f0-9-]{36}$/);
        const previous = state.operations.get(operation.operationId);
        if (!previous) {
          state.operations.set(operation.operationId, { operation, overlayId: input.overlayId, state: 'pending' });
          state.overlays.set(input.overlayId, operation.operationId);
        }
        return ok('registerOfflineSync', { overlay: { overlayId: input.overlayId }, replayed: !!previous, replayedOperations: previous ? [operation.operationId] : [] });
      }
      if (query === LOOKUP_SYNC) {
        assert.ok(query.includes('lastCode resultJson }'));
        assert.equal(query.includes('} resultJson'), false);
        const entry = state.operations.get(variables.operationId);
        if (!entry) return failure(404, 'OPERATION_NOT_FOUND');
        const body = structuredClone(entry.body ?? {});
        if (body.upload) { body.upload.url = '[redacted]'; delete body.upload.headers; }
        return ok('offlineSyncOperation', { overlayId: entry.overlayId, operation: { operationId: entry.operation.operationId,
          entity: entry.operation.entity, state: entry.state, attemptCount: 1, lastStatus: entry.status, lastCode: entry.code, resultJson: JSON.stringify(body) } });
      }
      if (query === EXECUTION_VERSION) return ok('myExecution', { assignmentId, version: 44,
        advances: [{ id: advanceId, evidences: [{ id: evidenceId, version: 7 + state.attempt, attempt: state.attempt, state: 'pending', failureCode: null }] }] });
      assert.equal(query, PUSH_SYNC);
      const id = state.overlays.get(variables.overlayId);
      const entry = state.operations.get(id);
      assert.ok(entry, 'only original registered overlay is pushed');
      const operation = entry.operation;
      state.owners.push(structuredClone(operation));
      let body;
      if (operation.entity === 'advance') body = { advance: { id: advanceId } };
      else if (operation.entity === 'client-inference') body = { analysisId: 'analysis-a', evidenceId, assignmentId };
      else if (operation.entity === 'evidence-confirm') body = { evidence: { id: evidenceId, state: 'available', version: 9 } };
      else {
        if (operation.entity === 'evidence-reauthorize') state.attempt++;
        body = { evidence: { id: evidenceId, attempt: state.attempt, version: 7 + state.attempt },
          upload: { url: 'ephemeral-signed-upload', method: 'PUT', expiresAt: '2099-01-01T00:00:00Z', headers: { 'x-checksum': 'exact' } } };
      }
      const needs = state.missing && operation.entity === 'evidence-confirm';
      Object.assign(entry, { body, status: needs ? 409 : 200, code: needs ? 'EVIDENCE_OBJECT_MISSING' : 'HTTP_200', state: needs ? 'needs-reupload' : 'applied' });
      return ok('pushOfflineSync', { overlayId: variables.overlayId, applied: needs ? [] : [id], pending: [],
        failed: needs ? [{ operationId: id, state: entry.state, status: entry.status, code: entry.code }] : [],
        resultsJson: JSON.stringify([{ operationId: id, status: entry.status, code: entry.code, body }]) });
    },
    async uploadEvidence(target, blob) {
      assert.equal(current, subject);
      assert.equal(target.url, 'ephemeral-signed-upload');
      assert.deepEqual(target.headers, { 'x-checksum': 'exact' });
      assert.equal(await blob.text(), 'photo');
      state.calls.push({ query: 'PUT' });
      return state.put ? state.put(target, blob) : { completed: true, status: 200 };
    },
  };
  return { state, store, session, switchTo, run: () => syncPending(store, session, subject) };
}

test('unit mock: plain advance persists intent before network and retains applied row', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { applied: 1, pending: 0, failed: 0 });
  assert.equal(f.state.item.state, 'applied');
  assert.equal(f.state.item.progress.advanceId, advanceId);
  const count = f.state.calls.length;
  assert.deepEqual(await f.run(), { applied: 0, pending: 0, failed: 0 });
  assert.equal(f.state.calls.length, count);
});

test('unit mock: photo chain uses owner record IDs and evidence version, then stores separate human review', async () => {
  const f = fixture({ photo: true, inference: true });
  assert.deepEqual(await f.run(), { applied: 1, pending: 0, failed: 0 });
  assert.deepEqual(f.state.owners.map(op => op.entity), ['advance', 'evidence-authorize', 'evidence-confirm', 'client-inference']);
  const [, authorization, confirm, inference] = f.state.owners;
  assert.equal(authorization.target.advanceId, advanceId);
  assert.equal(confirm.target.evidenceId, evidenceId);
  assert.equal(confirm.baseVersion, 44);
  assert.equal(confirm.payload.expectedVersion, 8);
  assert.equal(inference.target.evidenceId, evidenceId);
  assert.deepEqual(inference.clientInference, f.state.item.clientInference);
  assert.equal(authorization.file.sha256, hash);
  assert.equal(authorization.payload.checksumSha256, createHash('sha256').update('photo').digest('base64'));
  for (const item of f.state.writes) {
    assert.doesNotMatch(JSON.stringify(item.progress), /ephemeral-signed-upload|x-checksum|headers|bearer/i);
    if (item.state === 'applied') assert.equal(item.progress.inferenceApplied, true);
  }
});

for (const [status, code, expected] of [[401, 'UNAUTHENTICATED', 'pending'], [503, 'SERVICE_UNAVAILABLE', 'pending'],
  [409, 'VERSION_CONFLICT', 'conflict'], [403, 'FORBIDDEN', 'rejected'], [404, 'EXECUTION_WORK_NOT_FOUND', 'rejected'],
  [409, 'EVIDENCE_ATTEMPTS_EXHAUSTED', 'rejected']]) {
  test(`unit mock: ${status} ${code} preserves ${expected} without deleting`, async () => {
    const f = fixture();
    f.state.hook = () => failure(status, code);
    await f.run();
    assert.equal(f.state.item.state, expected);
    assert.equal(f.state.item.lastCode, code);
    if (expected !== 'pending') { const count = f.state.calls.length; await f.run(); assert.equal(f.state.calls.length, count); }
  });
}

test('unit mock: expired work blocks all traffic until main revalidates it', async () => {
  const f = fixture();
  f.state.work.expiresAt = '2000-01-01T00:00:00Z';
  assert.deepEqual(await f.run(), { applied: 0, pending: 1, failed: 0 });
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.item.lastCode, 'OFFLINE_WORK_EXPIRED');
  f.state.work.expiresAt = '2099-01-01T00:00:00Z';
  assert.equal((await f.run()).applied, 1);
});

test('unit mock: interrupted registration repeats exactly the persisted envelope', async () => {
  const f = fixture();
  f.state.hook = query => { if (query === REGISTER_SYNC) throw new Error('lost registration response'); };
  await f.run();
  const original = f.state.calls[0].variables.input;
  f.state.hook = undefined;
  await f.run();
  const registrations = f.state.calls.filter(call => call.query === REGISTER_SYNC);
  assert.deepEqual(registrations[1].variables.input, original);
  assert.equal(f.state.item.state, 'applied');
});

test('unit mock: ambiguous push resumes original overlay and owner operation', async () => {
  const f = fixture();
  f.state.hook = query => { if (query === PUSH_SYNC) throw new Error('lost push'); };
  await f.run();
  const original = f.state.item.overlayId;
  f.state.hook = undefined;
  await f.run();
  assert.equal(f.state.calls.filter(call => call.query === REGISTER_SYNC).length, 1);
  assert.ok(f.state.calls.filter(call => call.query === PUSH_SYNC).every(call => call.variables.overlayId === original));
  assert.equal(f.state.operations.size, 1);
});

test('unit mock: lost successful push recovers sanitized owner body without another owner call', async () => {
  const f = fixture();
  const update = f.store.update;
  let once = true;
  f.store.update = async item => { if (once && item.progress.advanceId) { once = false; throw new Error('local commit interrupted'); } return update(item); };
  await f.run();
  // Simulate process interruption before the owner result was durably captured.
  delete f.state.item.progress.advanceId;
  await f.run();
  assert.equal(f.state.owners.length, 1);
  assert.equal(f.state.item.progress.advanceId, advanceId);
  assert.equal(f.state.item.state, 'applied');
});

test('unit mock: lost PUT confirms existing evidence first, never authorizes a duplicate', async () => {
  const f = fixture({ photo: true });
  f.state.put = () => { throw new Error('PUT response lost'); };
  assert.equal((await f.run()).pending, 1);
  assert.equal(f.state.item.progress.evidenceState, 'put-started');
  const before = f.state.calls.length;
  f.state.put = undefined;
  assert.equal((await f.run()).applied, 1);
  assert.equal(f.state.calls.slice(before).some(call => call.query === 'PUT'), false);
  assert.equal(f.state.owners.filter(op => op.entity === 'evidence-authorize').length, 1);
  assert.equal(f.state.owners.at(-1).entity, 'evidence-confirm');
});

test('unit mock: missing object requires reauthorization of the same evidence with a stable new attempt', async () => {
  const f = fixture({ photo: true });
  f.state.missing = true;
  assert.equal((await f.run()).pending, 1);
  assert.equal(f.state.item.state, 'needs-reupload');
  f.state.missing = false;
  assert.equal((await f.run()).applied, 1);
  const retries = f.state.owners.filter(op => op.entity === 'evidence-reauthorize');
  assert.equal(retries.length, 1);
  assert.equal(retries[0].target.evidenceId, evidenceId);
  assert.equal(retries[0].payload.expectedVersion, 8);
  assert.equal(f.state.item.progress.attempt, 2);
});

test('unit mock: exhausted fifth upload attempt remains rejected and visible', async () => {
  const f = fixture({ photo: true });
  f.state.item.progress = { steps: {}, advanceId, evidenceId, attempt: 5, evidenceState: 'failed' };
  assert.equal((await f.run()).failed, 1);
  assert.equal(f.state.item.lastCode, 'EVIDENCE_ATTEMPTS_EXHAUSTED');
  assert.equal(f.state.calls.length, 0);
});

test('unit mock: confirmation retry freezes operation ID, overlay, and both versions', async () => {
  const f = fixture({ photo: true });
  f.state.hook = (query, variables) => {
    if (query === PUSH_SYNC) {
      const id = f.state.overlays.get(variables.overlayId);
      if (f.state.operations.get(id).operation.entity === 'evidence-confirm') throw new Error('confirm response lost');
    }
  };
  await f.run();
  const before = structuredClone(Object.values(f.state.item.progress.steps).find(step => JSON.parse(step.input.operationsJson)[0].entity === 'evidence-confirm'));
  f.state.hook = undefined;
  assert.equal((await f.run()).applied, 1);
  const after = Object.values(f.state.item.progress.steps).find(step => JSON.parse(step.input.operationsJson)[0].entity === 'evidence-confirm');
  assert.deepEqual(after.input, before.input);
  assert.equal(f.state.calls.filter(call => call.query === EXECUTION_VERSION).length, 1);
});

for (const point of ['initial', 'queue', 'works', 'register', 'push', 'put']) {
  test(`unit mock: account switch at ${point} discards async result and stops writes/traffic`, async () => {
    const f = fixture({ photo: point === 'put' });
    let writesAtSwitch = 0;
    let callsAtSwitch = 0;
    const change = () => { writesAtSwitch = f.state.writes.length; callsAtSwitch = f.state.calls.length; f.switchTo('mechanic-b'); };
    if (point === 'initial') change();
    else if (point === 'queue' || point === 'works') {
      const method = f.store[point];
      f.store[point] = async who => { const result = await method(who); change(); return result; };
    } else if (point === 'put') f.state.put = () => { change(); return { completed: true, status: 200 }; };
    else f.state.hook = query => {
      if (query === (point === 'register' ? REGISTER_SYNC : PUSH_SYNC)) { change(); return {}; }
    };
    assert.equal((await f.run()).applied, 0);
    assert.equal(f.state.writes.length, writesAtSwitch);
    assert.equal(f.state.calls.length, callsAtSwitch);
  });
}

test('unit mock: account switch away and back still invalidates in-flight result', async () => {
  const f = fixture();
  f.state.hook = () => { f.switchTo('mechanic-b'); f.switchTo(subject); return {}; };
  await f.run();
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.item.state, 'sending');
});

for (const point of ['registration', 'owner body', 'push JSON']) {
  test(`unit mock: malformed successful ${point} never marks a queue item applied`, async () => {
    const f = fixture();
    f.state.hook = (query, variables) => {
      if (point === 'registration' && query === REGISTER_SYNC) return ok('registerOfflineSync', {});
      if (query === PUSH_SYNC) return ok('pushOfflineSync', { overlayId: variables.overlayId, applied: [operationId], failed: [],
        resultsJson: point === 'push JSON' ? '{' : JSON.stringify([{ operationId, status: 200, body: {} }]) });
    };
    assert.equal((await f.run()).pending, 1);
    assert.equal(f.state.item.state, 'pending');
  });
}

test('unit mock: mismatched local image/inference bytes reject before network', async () => {
  const f = fixture({ photo: true, inference: true });
  f.state.item.clientInference.imageSha256 = '0'.repeat(64);
  assert.equal((await f.run()).failed, 1);
  assert.equal(f.state.calls.length, 0);
});

test('unit mock: simultaneous calls share a single durable execution', async () => {
  const f = fixture();
  const first = f.run();
  assert.equal(f.run(), first);
  await first;
  assert.equal(f.state.owners.length, 1);
});

test('unit mock: lookup resumes the original coordinator envelope rather than a replay wrapper', async () => {
  const f = fixture();
  f.state.hook = query => { if (query === PUSH_SYNC) throw new Error('interrupted push'); };
  await f.run();
  const original = '55555555-5555-4555-8555-555555555555';
  f.state.operations.get(operationId).overlayId = original;
  f.state.overlays.set(original, operationId);
  f.state.hook = undefined;
  const before = f.state.calls.length;
  assert.equal((await f.run()).applied, 1);
  const calls = f.state.calls.slice(before);
  assert.equal(calls.some(call => call.query === REGISTER_SYNC), false);
  assert.equal(calls.find(call => call.query === PUSH_SYNC).variables.overlayId, original);
});

test('unit mock: failed binary PUT remains ambiguous and confirms before any subsequent upload', async () => {
  const f = fixture({ photo: true });
  f.state.put = () => ({ completed: false, status: 503 });
  assert.equal((await f.run()).pending, 1);
  assert.equal(f.state.item.lastCode, 'EVIDENCE_UPLOAD_UNCONFIRMED');
  const before = f.state.calls.length;
  f.state.put = undefined;
  assert.equal((await f.run()).applied, 1);
  assert.equal(f.state.calls.slice(before).some(call => call.query === 'PUT'), false);
});

test('unit mock: expiry during registration blocks the subsequent push', async () => {
  const f = fixture();
  f.state.hook = query => { if (query === REGISTER_SYNC) f.state.work.expiresAt = '2000-01-01T00:00:00Z'; };
  assert.equal((await f.run()).pending, 1);
  assert.equal(f.state.calls.some(call => call.query === PUSH_SYNC), false);
});

for (const entity of ['evidence-authorize', 'evidence-confirm', 'client-inference']) {
  test(`unit mock: malformed ${entity} result never completes the photo chain`, async () => {
    const f = fixture({ photo: true, inference: true });
    f.state.hook = (query, variables) => {
      if (query !== PUSH_SYNC) return;
      const id = f.state.overlays.get(variables.overlayId);
      if (f.state.operations.get(id).operation.entity !== entity) return;
      return ok('pushOfflineSync', { overlayId: variables.overlayId, applied: [id], failed: [],
        resultsJson: JSON.stringify([{ operationId: id, status: 200, body: { unrelated: true } }]) });
    };
    assert.equal((await f.run()).pending, 1);
    assert.equal(f.state.item.state, 'pending');
    assert.equal(f.state.item.progress.inferenceApplied, undefined);
  });
}

test('unit mock: interrupted authorization recovers record ID without persisting or reusing signed target', async () => {
  const f = fixture({ photo: true });
  const update = f.store.update;
  let failed = false;
  f.store.update = async item => {
    if (!failed && item.progress.evidenceId) { failed = true; throw new Error('process lost local authorization result'); }
    return update(item);
  };
  await f.run();
  delete f.state.item.progress.evidenceId;
  delete f.state.item.progress.evidenceState;
  delete f.state.item.progress.attempt;
  const before = f.state.calls.length;
  assert.equal((await f.run()).applied, 1);
  assert.equal(f.state.calls.slice(before).some(call => call.query === 'PUT'), false);
  assert.equal(f.state.owners.filter(op => op.entity === 'evidence-authorize').length, 1);
});
