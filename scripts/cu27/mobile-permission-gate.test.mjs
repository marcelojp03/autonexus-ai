import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionGate, immutableFingerprint, validateOperationId, validateDenial } from './mobile-permission-gate.mjs';
import { expected } from './verify-mobile-photo.mjs';
const id = '11111111-1111-4111-8111-111111111111';
function harness(mode = 'success', baselineChange) {
  let clock = 0, revoked = false, restored = false, reads = 0, deviceReads = 0;
  const reports = [], events = [], logins = [];
  const row = { operationId: id, description: 'synthetic rejection', photoBytes: expected.photoBytes, imageSha256: expected.imageSha256, actualFileSha256: expected.imageSha256, modelVersion: expected.modelVersion, runId: expected.runId, labels: 'a:0.1,b:0.2,c:0.3,d:0.4', humanReviewLabels: '', humanReviewedAt: '2026-11-05T16:00:00Z', advanceId: null, evidenceId: null };
  const io = {
    now: () => clock,
    preflight: async () => { if (mode === 'preflight') throw new Error('PRIOR_PERMISSION_EVIDENCE_EXISTS_NO_OVERWRITE'); },
    inspect: async () => {
      deviceReads++;
      const state = revoked && mode === 'lag' && deviceReads === 2 ? 'pending' : revoked || restored ? 'rejected' : 'pending';
      return { queue: [{ ...row, state, lastCode: state === 'rejected' ? 'HTTP_403' : null, ...(mode === 'changed' && revoked ? { labels: 'a:0.5,b:0.2,c:0.3,d:0.4' } : {}) }] };
    },
    login: async subject => { logins.push({ revoked, restored, subject }); return 'RAM_ONLY_SYNTHETIC_TOKEN'; },
    ledger: async () => {
      if (!revoked && !restored && baselineChange) return { status: 200, data: { operation: { operationId: id, entity: 'advance', target: { assignmentId: expected.assignmentId }, payload: { description: row.description }, state: 'pending', ...baselineChange } } };
      if (!revoked && !restored || mode === 'timeout') return { status: 404 };
      if (revoked && mode === 'http500' && reads++ === 0) return { status: 500 };
      if (revoked && mode === 'network' && reads++ === 0) throw new DOMException('PRIVATE_NETWORK_DETAILS', 'TimeoutError');
      if (revoked && mode === 'always500') return { status: 503 };
      if (revoked && mode === 'forbiddenRead') return { status: 403 };
      if (revoked && mode === 'refresh' && reads++ === 0) return { status: 401 };
      return { status: 200, data: { operation: { operationId: id, state: mode === 'conflict' ? 'conflict' : 'rejected', lastResult: { status: mode === 'conflict' ? 409 : 403, code: mode === 'conflict' ? 'VERSION_CONFLICT' : 'HTTP_403' } } } };
    },
    execution: async () => ({ status: 200, data: { advances: mode === 'ownerPresent' ? [{ description: row.description }] : [] } }),
    withRevoked: async (callback, options) => {
      assert.deepEqual(options, { routingCompanion: true, callbackTimeoutMs: 300000 }); revoked = true;
      try { return await callback({ origin: 'http://127.0.0.1:4286', subject: 'synthetic-subject', signal: new AbortController().signal, deadline: clock + 300000 }); }
      finally { revoked = false; restored = true; }
    },
    sleep: async ms => { clock += ms; },
    save: report => reports.push(structuredClone(report)), emit: event => events.push(event),
  };
  return { run: () => createPermissionGate(io)(id), reports, events, logins, restored: () => restored, clock: () => clock };
}
test('rejects accepted-case and invalid IDs; no conflict can satisfy actual denial', () => {
  for (const value of [undefined, 'invalid', expected.operationId, expected.operationId.toUpperCase()]) assert.throws(() => validateOperationId(value));
  validateDenial({ state: 'rejected', lastResult: { status: 403, code: 'HTTP_403' } });
  for (const value of [{ state: 'conflict', lastResult: { status: 409, code: 'HTTP_403' } }, { state: 'rejected', lastResult: { status: 403, code: 'HTTP_409' } }]) assert.throws(() => validateDenial(value));
});
test('fingerprint excludes operational state but includes immutable human review and raw scores', () => {
  const row = { operationId: id, labels: 'a:0.1', humanReviewLabels: '', humanReviewedAt: 'timestamp' };
  assert.equal(immutableFingerprint(row), immutableFingerprint({ ...row, state: 'rejected', lastCode: 'HTTP_403' }));
  assert.notEqual(immutableFingerprint(row), immutableFingerprint({ ...row, humanReviewLabels: null }));
});
test('success restores helper before fresh owner reads and leaves device UI recovery explicitly pending', async () => {
  const h = harness(); const report = await h.run();
  assert.equal(h.restored(), true); assert.equal(report.rejectionChecksPassed, true);
  assert.equal(report.pass, false); assert.equal(report.deviceRecoveryUI, 'PENDING');
  assert.equal(report.state, 'PARTIAL_DEVICE_RECOVERY_UI_PENDING');
  assert.ok(h.events.some(e => e.state === 'WAITING_FOR_DEVICE_OWNER_REJECTION'));
  assert.equal(h.logins.at(-1).restored, true);
  assert.ok(!JSON.stringify(h.reports).includes('RAM_ONLY_SYNTHETIC_TOKEN'));
});
test('ledger/device persistence lag and 401 refresh are supported', async () => {
  for (const mode of ['lag', 'refresh']) { const h = harness(mode); await h.run(); assert.equal(h.restored(), true); }
});
test('timeout, conflict and payload changes finish callback and restore', async () => {
  for (const mode of ['timeout', 'conflict', 'changed']) {
    const h = harness(mode); await assert.rejects(h.run()); assert.equal(h.restored(), true);
    assert.equal(h.reports.at(-1).state, 'BLOCKED'); assert.ok(h.clock() <= 300000);
  }
});
test('preflight failure never overwrites prior evidence or starts revocation', async () => {
  const h = harness('preflight'); await assert.rejects(h.run(), /PRIOR_PERMISSION_EVIDENCE_EXISTS_NO_OVERWRITE/);
  assert.equal(h.reports.length, 0); assert.equal(h.restored(), false);
});
test('existing pending exact intent resumes the same operation', async () => {
  const h = harness('success', {}); const report = await h.run();
  assert.equal(report.rejectionChecksPassed, true); assert.equal(h.restored(), true);
});
test('existing mismatched or terminal intent and present owner advance refuse before revocation', async () => {
  for (const change of [{ operationId: expected.operationId }, { entity: 'client-inference' }, { target: { assignmentId: 'other' } }, { payload: { description: 'other' } }, { state: 'applied' }, { state: 'conflict' }, { state: 'rejected' }, { lastResult: { status: 403, code: 'HTTP_403' } }]) {
    const h = harness('success', change); await assert.rejects(h.run()); assert.equal(h.restored(), false);
  }
  const h = harness('ownerPresent', {}); await assert.rejects(h.run(), /BASELINE_OWNER_ADVANCE_ALREADY_EXISTS/); assert.equal(h.restored(), false);
});
test('HTTP 500 and network timeout before real 403 retry with sanitized counters and restoration', async () => {
  for (const mode of ['http500', 'network']) {
    const h = harness(mode); const report = await h.run();
    assert.equal(report.rejectionChecksPassed, true); assert.equal(h.restored(), true);
    assert.equal(report.transients[mode === 'http500' ? 'http5xx' : 'network'], 1);
    assert.ok(!JSON.stringify(h.reports).includes('PRIVATE_NETWORK_DETAILS'));
  }
});
test('persistent 5xx exhausts the original bounded deadline; non-401/404 4xx never retries', async () => {
  const h = harness('always500'); await assert.rejects(h.run(), /DEVICE_REJECTION_TIMEOUT/);
  assert.equal(h.restored(), true); assert.ok(h.clock() <= 300000); assert.ok(h.reports.at(-1).transients.http5xx > 0);
  const forbidden = harness('forbiddenRead'); await assert.rejects(forbidden.run(), /MS05_READ_FAILED/); assert.equal(forbidden.restored(), true); assert.equal(forbidden.clock(), 0);
});
