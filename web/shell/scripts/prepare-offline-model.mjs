import { readFile, mkdir, writeFile, rename, rm, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const shell = fileURLToPath(new URL('../', import.meta.url));
const runtimeSha256 = 'cb03f6ad0f992376dcc735dc3426901477ca05c434e0321f072b94869a7cc2bd';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateMetadata(manifest, quality) {
  if (manifest.modelVersion !== 'automotive-damage-mobilenetv2-v1' ||
      manifest.runId !== '20261101T-with-negatives' ||
      JSON.stringify(manifest.labels) !== JSON.stringify(['crack', 'dent', 'glass_shatter', 'scratch']) ||
      JSON.stringify(manifest.preprocessing?.inputSize) !== '[224,224]' ||
      manifest.preprocessing?.colorMode !== 'RGB' ||
      manifest.preprocessingFingerprint !== '8e1557df3dcdd725088da336d732849196cbac46804776849c62abc58bcf32f8' ||
      quality.status !== 'experimental') {
    throw new Error('Unsupported or corrupt offline model metadata');
  }
}

export function weightPaths(graph) {
  if (graph.format !== 'graph-model' || !Array.isArray(graph.weightsManifest) || !graph.weightsManifest.length) {
    throw new Error('Invalid graph model');
  }
  const paths = graph.weightsManifest.flatMap((group) => {
    if (!Array.isArray(group.paths) || !group.paths.length) throw new Error('Missing graph weights');
    return group.paths;
  });
  for (const path of paths) {
    if (typeof path !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.bin$/.test(path)) {
      throw new Error('Graph weights must be local relative .bin paths');
    }
  }
  return [...new Set(paths)];
}

export async function prepareOfflineModel() {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: shell, encoding: 'utf8' }).trim();
  const root = dirname(common);
  const source = await realpath(resolve(process.env.OFFLINE_MODEL_SOURCE || resolve(root, 'ml/artifacts/automotive-damage-mobilenetv2-v1/20261101T-with-negatives')));
  const vendor = resolve(process.env.OFFLINE_TFJS_SOURCE || resolve(root, 'output/cu23/browser-check/vendor/tf.min.js'));
  const destination = resolve(shell, 'public/offline-model');
  // Refuse to leave redistributable binaries visible to git even on a fresh worktree.
  try {
    execFileSync('git', ['check-ignore', '-q', '--', destination + '/index.json'], { cwd: shell });
  } catch {
    throw new Error('Add /web/shell/public/offline-model/ to the repository .gitignore before preparing binaries');
  }
  const manifestBytes = await readFile(resolve(source, 'manifest.json'));
  const qualityBytes = await readFile(resolve(source, 'quality.json'));
  const manifest = JSON.parse(manifestBytes);
  const quality = JSON.parse(qualityBytes);
  validateMetadata(manifest, quality);
  const graphBytes = await readFile(resolve(source, 'tfjs/model.json'));
  const paths = weightPaths(JSON.parse(graphBytes));
  const runtime = await readFile(vendor);
  if (sha256(runtime) !== runtimeSha256) throw new Error('TFJS 4.20.0 vendor SHA-256 mismatch');
  const files = new Map([
    ['manifest.json', manifestBytes], ['quality.json', qualityBytes],
    ['tfjs/model.json', graphBytes], ['vendor/tf.min.js', runtime],
  ]);
  for (const path of paths) {
    const weight = await realpath(resolve(source, 'tfjs', path));
    if (!weight.startsWith(source + sep)) throw new Error('Weight symlink escapes artifact');
    const bytes = await readFile(weight);
    if (!bytes.length) throw new Error('Empty graph weight');
    files.set('tfjs/' + path, bytes);
  }
  const index = {
    schemaVersion: 1,
    modelVersion: manifest.modelVersion, runId: manifest.runId,
    labels: manifest.labels, qualityStatus: quality.status,
    runtime: { version: '4.20.0', url: '/offline-model/vendor/tf.min.js', sha256: runtimeSha256 },
    modelUrl: '/offline-model/tfjs/model.json',
    files: [...files].map(([path, bytes]) => ({ url: '/offline-model/' + path, bytes: bytes.length, sha256: sha256(bytes) })),
  };
  const temporary = destination + '/.preparing';
  await mkdir(destination, { recursive: true });
  await mkdir(temporary, { recursive: false });
  try {
    for (const [path, bytes] of files) {
      await mkdir(dirname(resolve(destination, path)), { recursive: true });
      await mkdir(dirname(resolve(temporary, path)), { recursive: true });
      await writeFile(resolve(temporary, path), bytes);
    }
    for (const [path] of files) await rename(resolve(temporary, path), resolve(destination, path));
    // Publish the index last; consumers verify every hash before using the model.
    await writeFile(resolve(temporary, 'index.json'), JSON.stringify(index, null, 2) + '\n');
    await rename(resolve(temporary, 'index.json'), resolve(destination, 'index.json'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log('Prepared ' + index.modelVersion + '/' + index.runId + ': ' + index.files.length + ' local assets (quality: ' + index.qualityStatus + ')');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareOfflineModel().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
