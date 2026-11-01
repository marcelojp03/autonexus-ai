/**
 * Write ml/data/dataset.json from the Hub metadata and the files already on disk.
 *
 * `download_dataset.py` writes this manifest at the end of a complete snapshot; when the snapshot
 * was assembled in several passes (images first, annotations with `collect_pairs.mjs`), this script
 * records the same facts - revision, licence, provenance and real file counts - without
 * re-downloading 23k files.
 *
 * Usage: node ml/training/dataset_manifest.mjs [--root ml/data]
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'tugberkkalay/autodamageiq-vehicle-damage-dataset';
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex === -1 ? 'ml/data' : args[rootIndex + 1];
const raw = join(root, 'raw', REPO.replace('/', '__'));

const count = directory => {
  try {
    return readdirSync(join(raw, directory)).length;
  } catch {
    return 0;
  }
};

const info = await (await fetch('https://huggingface.co/api/datasets/' + REPO)).json();
const manifest = {
  name: REPO,
  url: 'https://huggingface.co/datasets/' + REPO,
  license: 'CC-BY-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  revision: info.sha,
  downloadedAt: new Date(statSync(join(raw, 'data.yaml')).mtimeMs).toISOString(),
  localPath: raw,
  counts: {
    images: count('images/train') + count('images/val'),
    labels: count('labels/train') + count('labels/val'),
  },
  upstreamSources: ['CarDD', 'VehiDE', 'human-in-the-loop GPT-4o labels'],
  provenanceNote:
    'Aggregated third-party dataset. The CC BY 4.0 declaration, class list and counts are taken from the dataset card; ' +
    'per-image vehicle identity is not published, so a vehicle-disjoint split cannot be guaranteed. Part of the images and ' +
    'annotations use different numeric bases, so only stems present on both sides were paired (see pairs.json).',
};
writeFileSync(join(root, 'dataset.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ revision: manifest.revision, counts: manifest.counts }));
