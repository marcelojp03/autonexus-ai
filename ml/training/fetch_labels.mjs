/**
 * Fetch the YOLO label files of the CU23 dataset directly over HTTPS.
 *
 * `huggingface_hub.snapshot_download` fetches 23k small files at a few files per second here, so
 * the annotation half of the dataset is retrieved with a bounded concurrent pool instead. The work
 * is resumable: existing files are skipped, and 404s are recorded as "image without annotations"
 * (that is a real property of the published dataset, not a truncated download).
 *
 * Usage: node ml/training/fetch_labels.mjs [--root ml/data]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO = 'tugberkkalay/autodamageiq-vehicle-damage-dataset';
const BASE = 'https://huggingface.co/datasets/' + REPO + '/resolve/main/';
const CONCURRENCY = 3;

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const root = rootIndex === -1 ? 'ml/data' : args[rootIndex + 1];
const raw = join(root, 'raw', REPO.replace('/', '__'));

function stems(directory) {
  return readdirSync(directory)
    .filter(name => name.toLowerCase().endsWith('.jpg'))
    .map(name => name.slice(0, -4));
}

async function fetchOne(split, stem) {
  const target = join(raw, 'labels', split, stem + '.txt');
  if (existsSync(target)) return 'cached';
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch(BASE + 'labels/' + split + '/' + stem + '.txt', { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (response.status === 404) return 'missing';
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 30000);
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      }
      if (response.status !== 200) throw new Error('status ' + response.status);
      const body = await response.text();
      await writeFile(target, body, 'utf8');
      return 'downloaded';
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return 'failed';
}

async function runPool(tasks, worker) {
  const counts = { cached: 0, downloaded: 0, missing: 0, failed: 0 };
  const missing = [];
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const outcome = await worker(task);
      counts[outcome > 0 ? 'cached' : 'downloaded']++;
      if (outcome === 'missing') { counts.missing++; missing.push(task.split + '/' + task.stem); }
      if (outcome === 'failed') { counts.failed++; missing.push('FAILED:' + task.split + '/' + task.stem); }
      done++;
      if (done % 200 === 0) console.log(JSON.stringify({ done, total: tasks.length, ...counts }));
    }
  });
  await Promise.all(workers);
  return { counts, missing };
}

async function main() {
  mkdirSync(join(raw, 'labels', 'train'), { recursive: true });
  mkdirSync(join(raw, 'labels', 'val'), { recursive: true });
  const tasks = [];
  for (const split of ['train', 'val']) {
    for (const stem of stems(join(raw, 'images', split))) tasks.push({ split, stem });
  }
  console.log(JSON.stringify({ phase: 'start', tasks: tasks.length, concurrency: CONCURRENCY }));
  const { counts, missing } = await runPool(tasks, ({ split, stem }) => fetchOne(split, stem));
  writeFileSync(join(root, 'missing-labels.json'), JSON.stringify({ repo: REPO, counts, missing }, null, 2));
  console.log(JSON.stringify({ phase: 'done', ...counts, missing: missing.length }));
  process.exitCode = counts.failed > 0 ? 1 : 0;
}

await main();
