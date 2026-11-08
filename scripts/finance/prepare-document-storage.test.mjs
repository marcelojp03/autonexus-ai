import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { prepare, prepareVolume, runOperator } from './prepare-document-storage.mjs';

const parent = fileURLToPath(new URL('../../output/finance/storage-tests/', import.meta.url));
const profile = { endpoint: 'http://127.0.0.1:4566', bucket: 'finance-synthetic', region: 'us-east-1', accessKey: 'synthetic-owner', secretKey: 'synthetic-local-password' };
async function fixture(p = profile) {
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, 'case-'));
  await writeFile(resolve(directory, 'finance-documents.private.json'), JSON.stringify(p), { mode: 0o600 });
  return directory;
}
const files = ['finance-documents-minio.private.json', 'finance-minio-user.private.txt', 'finance-minio-password.private.txt'];
test('final target accepts only readonly verification; unrelated names are rejected before Docker', () => {
  assert.throws(() => runOperator(profile, 'configure', undefined, 'cu16-proof-finance-documents-storage-1'), /Unsupported/);
  assert.throws(() => runOperator(profile, 'probe', undefined, 'cu16-proof-finance-documents-storage-1'), /Unsupported/);
  assert.throws(() => runOperator(profile, 'verify-proof', undefined, 'unrelated-storage'), /Unsupported/);
});
test('reject invalid volume project before Docker invocation', () => {
  for (const project of ['', '../other', 'UPPER', 'unexpected.name', '--option']) {
    assert.throws(() => prepareVolume(project), /Invalid local Compose project/);
  }
});
test('derive only endpoint, retain source bytes, preserve target bytes on repeat', async () => {
  const directory = await fixture();
  const source = await readFile(resolve(directory, 'finance-documents.private.json'));
  const expected = { ...profile, endpoint: 'http://127.0.0.1:4568' };
  assert.deepEqual(await prepare(directory), expected);
  const before = await Promise.all(files.map(f => readFile(resolve(directory, f), 'utf8')));
  assert.equal(before[1], profile.accessKey);
  assert.equal(before[2], profile.secretKey);
  assert.deepEqual(JSON.parse(before[0]), expected);
  assert.deepEqual(await prepare(directory), expected);
  assert.deepEqual(await readFile(resolve(directory, 'finance-documents.private.json')), source);
  assert.deepEqual(await Promise.all(files.map(f => readFile(resolve(directory, f), 'utf8'))), before);
  if (process.platform !== 'win32') for (const f of files) assert.equal((await stat(resolve(directory, f))).mode & 0o777, 0o600);
});
for (const name of files) test('refuse drift without rewriting: ' + name, async () => {
  const directory = await fixture();
  await prepare(directory);
  await writeFile(resolve(directory, name), 'drift');
  const before = await Promise.all(files.map(f => readFile(resolve(directory, f), 'utf8')));
  await assert.rejects(prepare(directory), /drift/);
  assert.deepEqual(await Promise.all(files.map(f => readFile(resolve(directory, f), 'utf8'))), before);
});
test('already-active MinIO profile is preserved on repeated preparation', async () => {
  const p = { ...profile, endpoint: 'http://127.0.0.1:4568' };
  const directory = await fixture(p);
  const source = await readFile(resolve(directory, 'finance-documents.private.json'));
  assert.deepEqual(await prepare(directory), p);
  assert.deepEqual(await prepare(directory), p);
  assert.deepEqual(await readFile(resolve(directory, 'finance-documents.private.json')), source);
});
for (const patch of [{ endpoint: 'https://example.invalid' }, { secretKey: 'bad\ncredential' }, { region: '../bad' }, { bucket: '../bad' }]) {
  test('reject unexpected source boundary: ' + Object.keys(patch)[0] + ' ' + JSON.stringify(patch).length, async () => {
    const directory = await fixture({ ...profile, ...patch });
    await assert.rejects(prepare(directory));
    await assert.rejects(stat(resolve(directory, files[0])), { code: 'ENOENT' });
  });
}
