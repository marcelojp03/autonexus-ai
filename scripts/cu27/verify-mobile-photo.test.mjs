import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expected, derivedId, localRow, parseLabels, validateAnalysis, snapshot, compareReplay } from './verify-mobile-photo.mjs';

const raw = 'dent:0.123456789012345,scratch:0.2,glass:0.3,normal:0.4';
function fixture() {
  const metadata = { queue: [{ ...expected, description: expected.marker + ' default text', state: 'applied', evidenceState: 'available', inferenceState: 'applied', actualFileSha256: expected.imageSha256, labels: raw, humanReviewLabels: '', humanReviewedAt: '2026-11-05T16:00:00Z', evidenceId: 'synthetic-evidence' }] };
  const row = localRow(metadata);
  const analysis = { analysisId: 'synthetic-analysis', assignmentId: expected.assignmentId, evidenceId: row.evidenceId, origin: 'client', verifiedByServer: false, runId: expected.runId, modelVersion: expected.modelVersion, imageSha256: expected.imageSha256, labels: row.labels, humanReview: { modelVersion: expected.modelVersion, labels: [] } };
  const execution = { version: 24, advances: [{ id: row.advanceId, description: row.description, evidences: [{ id: row.evidenceId, state: 'available' }] }] };
  const listing = { assignmentId: expected.assignmentId, items: [analysis] };
  return { metadata, row, analysis, execution, listing };
}
test('SQLite scores retain full float precision and require four distinct scores', () => {
  assert.equal(parseLabels(raw)[0].score, 0.123456789012345);
  for (const value of [null, '', 'a:0.2', raw.replace('glass:0.3', 'dent:0.3'), raw.replace('0.2', 'NaN')]) assert.throws(() => parseLabels(value));
});
test('explicit reviewed none is different from an absent review', () => {
  const { metadata } = fixture();
  assert.equal(localRow(metadata).humanReviewLabels, '');
  for (const change of [{ humanReviewedAt: null }, { humanReviewLabels: null }, { actualFileSha256: '0'.repeat(64) }, { state: 'pending' }, { advanceId: 'other' }]) {
    assert.throws(() => localRow({ queue: [{ ...metadata.queue[0], ...change }] }));
  }
  assert.throws(() => localRow({ queue: [...metadata.queue, ...metadata.queue] }));
});
test('MS04 preserves exact raw scores and explicit empty review separately', () => {
  const { row, analysis } = fixture();
  validateAnalysis({ ...analysis, labels: [...analysis.labels].reverse() }, row);
  for (const change of [{ origin: 'server' }, { verifiedByServer: true }, { humanReview: null }, { humanReview: { modelVersion: expected.modelVersion, labels: ['dent'] } }, { labels: analysis.labels.map((label, i) => i ? label : { ...label, score: 0.123457 }) }]) assert.throws(() => validateAnalysis({ ...analysis, ...change }, row));
});
test('snapshot rejects duplicate exact descriptions, evidence and analyses', () => {
  const { row, analysis, execution, listing } = fixture();
  assert.equal(snapshot(row, execution, analysis, listing).advanceCount, 1);
  assert.throws(() => snapshot(row, { ...execution, advances: [...execution.advances, ...execution.advances] }, analysis, listing));
  assert.throws(() => snapshot(row, { ...execution, advances: [{ ...execution.advances[0], description: expected.marker }] }, analysis, listing));
  assert.throws(() => snapshot(row, execution, analysis, { ...listing, items: [analysis, analysis] }));
  assert.throws(() => snapshot(row, { ...execution, advances: [{ ...execution.advances[0], evidences: [...execution.advances[0].evidences, ...execution.advances[0].evidences] }] }, analysis, listing));
});
test('replay compares version and all owner IDs/counts without replacing baseline', () => {
  const { row, analysis, execution, listing } = fixture();
  const before = snapshot(row, execution, analysis, listing);
  compareReplay(before, structuredClone(before));
  for (const change of [{ version: 25 }, { advanceCount: 2 }, { evidenceCount: 2 }, { analysisCount: 2 }, { analysisIds: ['other'] }, { evidenceId: 'other' }]) assert.throws(() => compareReplay(before, { ...before, ...change }));
});
test('derived inference ID is deterministic with UUID v5 and RFC variant bits', () => {
  const value = derivedId(expected.operationId + ':client-inference');
  assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(value, derivedId(expected.operationId + ':client-inference'));
});
