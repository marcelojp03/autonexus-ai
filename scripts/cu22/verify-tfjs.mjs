#!/usr/bin/env node
/**
 * Compare the TensorFlow.js artefact against the Python scores, in a JS runtime.
 *
 * Runs inside a Node container with `@tensorflow/tfjs` (pure JS, no native bindings). The inputs are
 * the exact float32 tensors produced by the training pipeline, so the comparison isolates the model
 * conversion from any decoding difference.
 *
 * Usage: node scripts/cu22/verify-tfjs.mjs <runDir>
 * Exit: 0 when every score is within --tolerance (default 0.01), 1 otherwise.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const runDir = resolve(process.argv[2] ?? 'ml/artifacts/automotive-damage-mobilenetv2-v1/20261101T-with-negatives');
const tolerance = Number(process.env.CU22_TOLERANCE ?? 0.01);
const modelDir = resolve(runDir, 'tfjs');
const checkDir = resolve(runDir, 'tfjs-check');
if (!existsSync(resolve(modelDir, 'model.json'))) throw new Error('missing tfjs model in ' + modelDir);

const requireApp = createRequire(resolve('web/mf-intelligence/package.json'));
let tf;
try {
  tf = requireApp('@tensorflow/tfjs');
} catch {
  tf = (await import('@tensorflow/tfjs')).default ?? (await import('@tensorflow/tfjs'));
}

/** Minimal file-system IOHandler: pure tfjs cannot read a model from disk on its own. */
const fileHandler = {
  load: async () => {
    const modelJSON = JSON.parse(readFileSync(resolve(modelDir, 'model.json'), 'utf8'));
    const specs = modelJSON.weightsManifest.flatMap(group => group.weights);
    const shards = modelJSON.weightsManifest.flatMap(group => group.paths.map(path => readFileSync(resolve(modelDir, path))));
    const total = shards.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const shard of shards) {
      merged.set(new Uint8Array(shard), offset);
      offset += shard.byteLength;
    }
    return {
      modelTopology: modelJSON.modelTopology,
      weightSpecs: specs,
      weightData: merged.buffer,
      format: modelJSON.format,
      generatedBy: modelJSON.generatedBy,
      convertedBy: modelJSON.convertedBy,
    };
  },
};

const reference = JSON.parse(readFileSync(resolve(checkDir, 'reference.json'), 'utf8'));
const [rows, height, width, channels] = reference.shape;
const rawInputs = readFileSync(resolve(checkDir, reference.inputsFile));
const inputs = new Float32Array(rawInputs.buffer, rawInputs.byteOffset, rawInputs.byteLength / 4);

const model = await tf.loadGraphModel(fileHandler);
const tensor = tf.tensor4d(inputs, [rows, height, width, channels]);
const output = model.execute(tensor);
const scores = (Array.isArray(output) ? output[0] : output).arraySync();

let maxDelta = 0;
let worst = null;
for (let i = 0; i < rows; i++) {
  for (let j = 0; j < reference.labels.length; j++) {
    const delta = Math.abs(scores[i][j] - reference.scores[i][j]);
    if (delta > maxDelta) {
      maxDelta = delta;
      worst = { sample: i, label: reference.labels[j], js: scores[i][j], python: reference.scores[i][j] };
    }
  }
}

const report = {
  runtime: '@tensorflow/tfjs ' + (tf.version?.tfjs ?? 'unknown'),
  modelVersion: reference.modelVersion,
  runId: reference.runId,
  samples: rows,
  labels: reference.labels,
  maxAbsDelta: Number(maxDelta.toFixed(6)),
  tolerance,
  equivalent: maxDelta <= tolerance,
  worst,
  note: 'Compares the converted graph model against the Keras artefact on identical preprocessed tensors.',
};
writeFileSync(resolve(runDir, 'tfjs-equivalence.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exit(report.equivalent ? 0 : 1);
