/**
 * Pair dataset images with their annotations by exact file stem and download the missing labels.
 *
 * The published dataset renames its `existing_damage_*` images and labels with different numeric
 * bases (image `existing_damage_01000.jpg` has no label of that name), so pairing by position or by
 * an inferred offset would silently attach the wrong annotation. Only stems that exist on *both*
 * sides are used; everything else is excluded from training and reported.
 *
 * Usage: node ml/training/collect_pairs.mjs [--root ml/data] [--download]
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO = 'tugberkkalay/autodamageiq-vehicle-damage-dataset';
const RESOLVE = 'https://huggingface.co/datasets/' + REPO + '/resolve/main/';
const API = 'https://huggingface.co/api/datasets/' + REPO + '/tree/main/';
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex === -1 ? 'ml/data' : args[rootIndex + 1];
const download = args.includes('--download');
const raw = join(root, 'raw', REPO.replace('/', '__'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function listTree(directory) {
  const names = [];
  let cursor;
  for (let page = 0; page < 200; page++) {
    const url = API + directory + '?recursive=false&limit=1000' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    let response;
    for (let attempt = 0; attempt < 8; attempt++) {
      response = await fetch(url, { redirect: 'follow' });
      if (response.status === 200) break;
      if (response.status === 429 || response.status >= 500) { await sleep(Math.min(1000 * 2 ** attempt, 20000)); continue; }
      throw new Error('tree ' + directory + ' status ' + response.status);
    }
    const entries = await response.json();
    for (const entry of entries) if (entry.type === 'file') names.push(entry.path);
    const link = response.headers.get('link') ?? '';
    const next = /<([^>]+)>\s*;\s*rel="next"/.exec(link);
    if (!next) break;
    cursor = new URL(next[1]).searchParams.get('cursor') ?? undefined;
    if (!cursor) break;
    await sleep(200);
  }
  return names;
}

async function fetchLabel(split, stem) {
  const target = join(raw, 'labels', split, stem + '.txt');
  if (existsSync(target)) return 'cached';
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(RESOLVE + 'labels/' + split + '/' + stem + '.txt', { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (response.status === 200) { await writeFile(target, await response.text(), 'utf8'); return 'downloaded'; }
    if (response.status === 404) return 'missing';
    if (response.status === 429 || response.status >= 500) {
      const retry = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retry) && retry > 0 ? retry * 1000 : Math.min(1000 * 2 ** attempt, 30000));
      continue;
    }
    throw new Error('label ' + stem + ' status ' + response.status);
  }
  return 'failed';
}

async function main() {
  mkdirSync(join(raw, 'labels', 'train'), { recursive: true });
  mkdirSync(join(raw, 'labels', 'val'), { recursive: true });

  const report = { repo: REPO, splits: {}, excluded: {}, download: download ? {} : null };
  for (const split of ['train', 'val']) {
    const images = readdirSync(join(raw, 'images', split)).filter(name => name.toLowerCase().endsWith('.jpg')).sort();
    const imageStems = new Set(images.map(name => name.slice(0, -4)));
    const labels = await listTree('labels/' + split);
    const labelStems = new Set(labels.map(path => path.split('/').at(-1).replace(/\.txt$/, '')));
    const pairs = [...imageStems].filter(stem => labelStems.has(stem)).sort();
    const orphanImages = [...imageStems].filter(stem => !labelStems.has(stem));
    const orphanLabels = [...labelStems].filter(stem => !imageStems.has(stem));

    const prefixes = {};
    for (const stem of orphanImages) {
      const prefix = stem.includes('_') ? stem.split('_')[0] : 'other';
      prefixes[prefix] = (prefixes[prefix] ?? 0) + 1;
    }
    report.splits[split] = { images: images.length, labels: labels.length, pairs: pairs.length };
    report.excluded[split] = { imagesWithoutMatchingLabel: orphanImages.length, labelsWithoutMatchingImage: orphanLabels.length, orphanImagePrefixes: prefixes };

    if (download) {
      const counts = { cached: 0, downloaded: 0, missing: 0, failed: 0 };
      let cursor = 0;
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < pairs.length) {
          const stem = pairs[cursor++];
          counts[await fetchLabel(split, stem)]++;
          if ((counts.cached + counts.downloaded) % 500 === 0) console.log(JSON.stringify({ split, ...counts }));
        }
      });
      await Promise.all(workers);
      report.download[split] = counts;
    }
  }
  writeFileSync(join(root, 'pairs.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.download && Object.values(report.download).some(counts => counts.failed > 0) ? 1 : 0;
}

await main();
