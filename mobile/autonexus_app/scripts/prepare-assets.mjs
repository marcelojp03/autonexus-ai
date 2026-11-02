#!/usr/bin/env node
/**
 * Copy the CU23 artifact and the sample image into the Flutter app before building.
 *
 * Neither the LiteRT model nor the sample photograph is versioned: the model derives from a dataset
 * whose licence is restricted, so it is provisioned at build time from the operator's artefact
 * directory. The manifest (labels, thresholds, run identity, quality gate) is versioned because it is
 * metadata; the reference scores are versioned so the device test has a fixed expectation.
 *
 * Usage: node scripts/prepare-assets.mjs [--run-dir <path>] [--sample <path>]
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = name => (args.indexOf(name) === -1 ? undefined : args[args.indexOf(name) + 1]);
const runDir = resolve(arg('--run-dir') ?? '../../ml/artifacts/automotive-damage-mobilenetv2-v1/20261101T-with-negatives');
const sample = resolve(arg('--sample') ?? '../../ml/data/raw/tugberkkalay__autodamageiq-vehicle-damage-dataset/images/val/vehide_01102020_094657image929398.jpg');

const models = resolve('assets/models');
const samples = resolve('assets/samples');
mkdirSync(models, { recursive: true });
mkdirSync(samples, { recursive: true });

for (const [source, target] of [
  [resolve(runDir, 'model.tflite'), resolve(models, 'model.tflite')],
  [resolve(runDir, 'manifest.json'), resolve(models, 'manifest.json')],
  [resolve(runDir, 'quality.json'), resolve(models, 'quality.json')],
  [sample, resolve(samples, 'sample.jpg')],
]) {
  if (!existsSync(source)) {
    console.error('missing ' + source + '; generate the CU23 artifact first (see ml/README.md)');
    process.exit(1);
  }
  copyFileSync(source, target);
  console.log('copied ' + source + ' -> ' + target);
}
console.log('assets ready; run `flutter pub get` and then `flutter build apk --debug`');
