import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMetadata, weightPaths } from '../scripts/prepare-offline-model.mjs';
import { inferPhoto, prepareModel, belowThresholds, inspectionError } from '../src/offline/inference.ts';

const manifest = {
  thresholds: { crack: 0.25, dent: 0.35, glass_shatter: 0.4, scratch: 0.5 },
  modelVersion: 'automotive-damage-mobilenetv2-v1', runId: '20261101T-with-negatives',
  labels: ['crack', 'dent', 'glass_shatter', 'scratch'],
  preprocessing: { inputSize: [224, 224], colorMode: 'RGB' },
  preprocessingFingerprint: '8e1557df3dcdd725088da336d732849196cbac46804776849c62abc58bcf32f8',
};

test('offline artifact metadata preserves experimental quality and ordered labels', () => {
  const scores = manifest.labels.map(name => ({ name, score: manifest.thresholds[name] - 0.01 }));
  const original = structuredClone(scores);
  assert.equal(belowThresholds(scores, manifest.thresholds), true);
  assert.deepEqual(scores, original);
  assert.equal(belowThresholds([{ name: 'crack', score: 0.3 }], manifest.thresholds), false);
  assert.equal(inspectionError(new RangeError('allocation failed')).reason, 'insufficient_resources');
  assert.equal(inspectionError(new Error('execute failed')).reason, 'inference_failed');
  assert.doesNotThrow(() => validateMetadata(manifest, { status: 'experimental' }));
  for (const change of [{ runId: 'other' }, { labels: [...manifest.labels].reverse() },
    { preprocessing: { inputSize: [256, 256], colorMode: 'RGB' } }, { preprocessingFingerprint: 'other' }]) {
    assert.throws(() => validateMetadata({ ...manifest, ...change }, { status: 'experimental' }), /metadata/);
  }
  assert.throws(() => validateMetadata(manifest, { status: 'validated' }), /metadata/);
});

test('offline graph weights cannot escape the local artifact', () => {
  const graph = (paths) => ({ format: 'graph-model', weightsManifest: [{ paths }] });
  assert.deepEqual(weightPaths(graph(['group1-shard1of2.bin', 'shards/group1-shard2of2.bin'])),
    ['group1-shard1of2.bin', 'shards/group1-shard2of2.bin']);
  for (const path of ['../weights.bin', '/weights.bin', 'https://example.invalid/w.bin',
    '//host/w.bin', 'C:\weights.bin', 'a/../../w.bin', '%2e%2e/w.bin', 'w.bin?url=x']) {
    assert.throws(() => weightPaths(graph([path])), /local/);
  }
  assert.throws(() => weightPaths(graph([])), /weights/);
});

test('missing and unsupported models reject honestly and can be retried', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(prepareModel(), /missing/);
    globalThis.fetch = async () => Response.json({ schemaVersion: 1, modelVersion: 'fake' });
    await assert.rejects(prepareModel(), /metadata/);
  } finally { globalThis.fetch = original; }
});

test('photograph byte and pixel limits fail before loading a model or decoding', async () => {
  await assert.rejects(inferPhoto(new Blob([])), /5 MiB/);
  await assert.rejects(inferPhoto(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])), /5 MiB/);
  await assert.rejects(inferPhoto(new Blob(['not an image'])), /JPEG or PNG/);
  const png = new ArrayBuffer(24);
  const view = new DataView(png);
  view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a); view.setUint32(12, 0x49484452);
  view.setUint32(16, 8192); view.setUint32(20, 8192);
  await assert.rejects(inferPhoto(new Blob([png])), /24 megapixels/);
  view.setUint32(16, 31); view.setUint32(20, 32);
  await assert.rejects(inferPhoto(new Blob([png])), /Calidad insuficiente/);
  view.setUint32(16, 8193); view.setUint32(20, 32);
  await assert.rejects(inferPhoto(new Blob([png])), /8192 pixels/);
});
