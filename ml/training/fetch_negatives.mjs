/**
 * Build a small, representative negative set with provenance recorded per image.
 *
 * The training dataset has no damage-free photographs, so no false-alarm rate can be estimated from
 * it. These negatives come from Wikimedia Commons because every file there carries machine-readable
 * licence metadata: only CC0, public domain and CC BY / CC BY-SA files are accepted, and the
 * manifest keeps the licence, the author and the file page for each one.
 *
 * Two groups:
 *   cars        - vehicles parked or in traffic, expected to show no visible damage
 *   outOfDomain - interiors, documents, landscapes: detection here is a false alarm by construction
 *
 * Usage: node ml/training/fetch_negatives.mjs [--per-group 40] [--root ml/data]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'https://commons.wikimedia.org/w/api.php';
const ALLOWED = /^(cc0|public domain|cc by(-sa)? \d(\.\d)?|cc by(-sa)? \d\.\d|pd)/i;
const GROUPS = {
  cars: 'Category:Parked automobiles',
  outOfDomain: 'Category:Interior_design',
};

const args = process.argv.slice(2);
const perGroup = Number(args[args.indexOf('--per-group') + 1]) || 40;
const root = (args.indexOf('--root') === -1 ? 'ml/data' : args[args.indexOf('--root') + 1]) + '/negatives';

async function listCategory(category, limit) {
  const url = API + '?' + new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'categorymembers', gcmtitle: category, gcmtype: 'file', gcmlimit: String(limit),
    prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '840',
  });
  const response = await fetch(url, { headers: { 'User-Agent': 'AutoNexusAI-academic/1.0' } });
  if (!response.ok) throw new Error('commons ' + response.status);
  const body = await response.json();
  return Object.values(body.query?.pages ?? {});
}

function pick(meta) {
  const read = key => meta?.[key]?.value ?? '';
  return {
    license: read('LicenseShortName'),
    artist: String(read('Artist')).replace(/<[^>]*>/g, '').slice(0, 120),
    credit: String(read('Credit')).replace(/<[^>]*>/g, '').slice(0, 120),
  };
}

async function main() {
  const manifest = { source: 'Wikimedia Commons', api: API, groups: {}, collectedAt: new Date().toISOString(), policy: 'only CC0/PD/CC BY(-SA) files; licence, author and file page recorded per image' };
  for (const [group, category] of Object.entries(GROUPS)) {
    const directory = join(root, group);
    mkdirSync(directory, { recursive: true });
    const pages = await listCategory(category, perGroup * 2);
    const entries = [];
    for (const page of pages) {
      if (entries.length >= perGroup) break;
      const info = page.imageinfo?.[0];
      if (!info?.thumburl) continue;
      const { license, artist, credit } = pick(info.extmetadata);
      if (!ALLOWED.test(license)) continue;
      const name = page.title.replace(/^File:/, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
      const target = join(directory, name);
      try {
        const response = await fetch(info.thumburl, { headers: { 'User-Agent': 'AutoNexusAI-academic/1.0' } });
        if (!response.ok) continue;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 5000) continue;
        await writeFile(target, bytes);
        entries.push({ file: group + '/' + name, license, artist, credit, page: info.descriptionurl, bytes: bytes.length });
      } catch {
        // A single failed download must not invalidate the rest of the sample.
      }
    }
    manifest.groups[group] = { category, count: entries.length, files: entries };
    console.log(JSON.stringify({ group, count: entries.length, licenses: [...new Set(entries.map(entry => entry.license))] }));
  }
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ manifest: join(root, 'manifest.json'), total: Object.values(manifest.groups).reduce((sum, group) => sum + group.count, 0) }));
}

await main();
