import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const forbidden = new Set(['identity', 'auth', 'graphql', 'api', 'protected', 'presigned']);

export async function buildOfflineManifest(directory = fileURLToPath(new URL('../dist/', import.meta.url))) {
  const root = resolve(directory);
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const runtimeScript = '<script src="/runtime-config.js"></script>';
  if (!html.includes(runtimeScript)) throw new Error('Missing public runtime configuration script');
  // The deployment generates runtime-config.js at startup, so it cannot have a build-time digest.
  const offlineConfig = '<script>globalThis.__AUTONEXUS_CONFIG__={version:1,oidcUrl:location.origin+"/identity",graphqlUrl:location.origin+"/graphql",technicalUrls:{employees:location.origin+"/technical/employees",operations:location.origin+"/technical/operations"}};</script>';
  await writeFile(resolve(root, 'offline.html'), html.replace(runtimeScript, offlineConfig));
  const files = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Offline resources must not be symlinks');
      const path = resolve(folder, entry.name);
      const name = relative(root, path).split(sep).join('/');
      if (entry.isDirectory()) {
        if (['assets', 'offline-model', 'icons'].some(prefix => name === prefix || name.startsWith(prefix + '/'))) await walk(path);
      } else if (entry.isFile()) files.push(name);
    }
  }
  await walk(root);
  const selected = files.filter(name => {
    const url = '/' + name;
    if (url.toLowerCase().split('/').some(segment => forbidden.has(segment))
      || /[?#%]/.test(name) || name.includes(String.fromCharCode(92))) return false;
    return ['offline.html', 'manifest.webmanifest', 'favicon.svg'].includes(name)
      || ((name.startsWith('assets/') || name.startsWith('icons/')) && /[.](m?js|css|wasm|png|jpe?g|svg|webp|ico|woff2?|ttf)$/i.test(name))
      || (name.startsWith('offline-model/') && /[.](json|bin|m?js|wasm)$/i.test(name));
  }).sort();
  for (const name of ['offline.html', 'manifest.webmanifest']) {
    if (!selected.includes(name)) throw new Error('Missing required offline resource: ' + name);
  }
  if (!selected.some(name => name.startsWith('assets/') && /[.]m?js$/.test(name))) throw new Error('Missing built offline JavaScript');
  const modelReady = selected.some(name => name.startsWith('offline-model/'));
  if (modelReady) {
    for (const name of ['offline-model/index.json', 'offline-model/tfjs/model.json', 'offline-model/vendor/tf.min.js']) {
      if (!selected.includes(name)) throw new Error('Missing required offline model resource: ' + name);
    }
    const model = JSON.parse(await readFile(resolve(root, 'offline-model/tfjs/model.json'), 'utf8'));
    if (!Array.isArray(model.weightsManifest) || model.weightsManifest.length === 0) throw new Error('Missing model weights manifest');
    for (const group of model.weightsManifest) {
      if (!Array.isArray(group.paths) || group.paths.length === 0) throw new Error('Missing model weight paths');
      for (const path of group.paths) {
        if (typeof path !== 'string' || !new RegExp('^[a-zA-Z0-9_./-]+[.]bin$').test(path) || path.split('/').some(part => part === '..' || part === '.')
          || path.startsWith('/') || !selected.includes('offline-model/tfjs/' + path)) throw new Error('Missing or unsafe model weight: ' + path);
      }
    }
    const index = JSON.parse(await readFile(resolve(root, 'offline-model/index.json'), 'utf8'));
    if (index.modelUrl !== '/offline-model/tfjs/model.json' || !Array.isArray(index.files) || !index.files.length) {
      throw new Error('Invalid offline model index');
    }
    for (const file of index.files) {
      if (typeof file.url !== 'string' || !file.url.startsWith('/offline-model/') || !selected.includes(file.url.slice(1))) {
        throw new Error('Missing or unsafe indexed model resource');
      }
      const content = await readFile(resolve(root, file.url.slice(1)));
      if (file.sha256 !== digest(content) || file.bytes !== content.byteLength) throw new Error('Offline model index integrity mismatch');
    }
  }
  const resources = [];
  let bytes = 0;
  for (const name of selected) {
    const content = await readFile(resolve(root, name));
    bytes += content.byteLength;
    resources.push({ url: '/' + name, sha256: digest(content) });
  }
  if (resources.length > 512 || bytes > 128 * 1024 * 1024) throw new Error('Offline resource budget exceeded (512 files / 128 MiB)');
  const manifest = { version: digest(JSON.stringify(resources)), modelReady, resources };
  const template = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const worker = template.replace('/* OFFLINE_MANIFEST */ null', JSON.stringify(manifest));
  if (worker === template) throw new Error('Missing worker manifest placeholder');
  await writeFile(resolve(root, 'offline-resources.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(resolve(root, 'sw.js'), worker);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = await buildOfflineManifest(process.argv[2]);
  console.log('Offline manifest ' + manifest.version + ': ' + manifest.resources.length + ' resources');
}
