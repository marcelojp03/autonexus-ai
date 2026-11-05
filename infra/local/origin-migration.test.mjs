import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { configuration, shellEnv } from './bootstrap.mjs';
import { options, consumers, planFiles, planClient, runtimeConfig, commitFiles, atomicWrite, dockerPlan } from '../../scripts/cu27/migrate-local-origin.mjs';

const from = 'http://127.0.0.1:4285', to = 'http://127.0.0.1:4286';
const opts = options(['--project', 'cu16-proof', '--from', from, '--to', to]);
function fixture() {
  const state = { version: 1, publicOrigin: from, secrets: { postgres: 'synthetic-only', keycloak: 'synthetic-master', appKey: 'synthetic-key' }, admin: { username: 'synthetic', password: 'synthetic-private' } };
  const generated = configuration(state);
  return {
    'state/bootstrap.json': JSON.stringify(state, null, 2) + '\n',
    'state/identity-ready.json': JSON.stringify({ version: 1, publicOrigin: from }, null, 2) + '\n',
    ...Object.fromEntries(consumers.map(name => ['config/' + name + '/service.env', shellEnv(generated[name])])),
    'config/public/runtime-config.js': runtimeConfig(from),
  };
}
const client = () => ({ id: 'synthetic-shell', clientId: 'autonexus-shell', publicClient: true, protocol: 'openid-connect', redirectUris: [from + '/auth/callback'], webOrigins: [from], attributes: { 'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': from + '/', unchanged: 'retained' }, secret: 'must-not-be-sent', protocolMappers: [{ name: 'keep' }] });
function materialize(files, action) {
  const root = mkdtempSync(resolve(tmpdir(), 'origin-migration-'));
  try {
    for (const [path, bytes] of Object.entries(files)) { mkdirSync(dirname(resolve(root, path)), { recursive: true }); writeFileSync(resolve(root, path), bytes); }
    action(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('explicit project/origins, default dry run and apply acknowledgement are mandatory', () => {
  assert.equal(opts.apply, false);
  for (const args of [[], ['--project', 'other', '--from', from, '--to', to], ['--project', 'cu16-proof', '--from', from, '--to', 'http://localhost:4286'], ['--project', 'cu16-proof', '--from', from, '--to', from]]) assert.throws(() => options(args));
  const args = ['--project', 'cu16-proof', '--from', from, '--to', to];
  assert.throws(() => options([...args, '--apply']), /EXPORT_AND_ADMIN_COMPLETION_REQUIRED/);
  assert.equal(options([...args, '--apply', '--queue-exported-admin-finished']).apply, true);
  assert.throws(() => options([...args, '--project', 'cu16-proof']), /DUPLICATE_OPTION/);
});

test('all bootstrap public consumers and identity marker move, private state bytes stay unchanged', () => {
  const files = fixture(), changes = planFiles(files, opts);
  assert.equal(changes.length, 12);
  for (const { path, before, after } of changes) assert.equal(after, before.replaceAll(from, to), path);
  assert.equal(files['state/bootstrap.json'].includes(to), false);
  const stateChange = changes.find(change => change.path === 'state/bootstrap.json');
  assert.deepEqual(JSON.parse(stateChange.after).secrets, JSON.parse(stateChange.before).secrets);
  assert.deepEqual(JSON.parse(stateChange.after).admin, JSON.parse(stateChange.before).admin);
});

test('extra private env lines, CRLF, comments, quotes, S3 credentials and internal endpoints retain exact bytes', () => {
  const files = fixture(), path = 'config/operations/service.env';
  const privateLines = "# synthetic-only\r\nAWS_SECRET_ACCESS_KEY='private " + from + "'\r\nS3_EVIDENCE_BUCKET='private-bucket'\r\nEXTRA='a'\\''b'\r\n";
  files[path] = files[path].replaceAll('\n', '\r\n') + privateLines;
  const after = planFiles(files, opts).find(change => change.path === path).after;
  assert.ok(after.endsWith(privateLines));
  assert.equal(after, files[path].replace("OIDC_ISSUER_URI='" + from, "OIDC_ISSUER_URI='" + to).replace("WEB_ALLOWED_ORIGINS='" + from, "WEB_ALLOWED_ORIGINS='" + to));
});

test('unexpected origins/values, duplicate keys and widened runtime refuse before any mutation', () => {
  const mutations = [
    files => { const state = JSON.parse(files['state/bootstrap.json']); state.publicOrigin = 'http://127.0.0.1:4999'; files['state/bootstrap.json'] = JSON.stringify(state); },
    files => { files['config/sync/service.env'] = files['config/sync/service.env'].replace("WEB_ALLOWED_ORIGINS='" + from + "'", "WEB_ALLOWED_ORIGINS='*'"); },
    files => { files['config/demo/service.env'] += "PUBLIC_ORIGIN='" + from + "'\n"; },
    files => { files['config/public/runtime-config.js'] += 'globalThis.extra = true;\n'; },
  ];
  for (const mutate of mutations) {
    const files = fixture(); mutate(files); const snapshot = structuredClone(files);
    materialize(files, root => {
      assert.throws(() => commitFiles(planFiles(files, opts), root));
      for (const [path, bytes] of Object.entries(snapshot)) assert.equal(readFileSync(resolve(root, path), 'utf8'), bytes);
    });
    assert.deepEqual(files, snapshot);
  }
});

test('replay is idempotent and reverse plan restores original bytes', () => {
  const files = fixture(), changes = planFiles(files, opts);
  for (const change of changes) files[change.path] = change.after;
  assert.deepEqual(planFiles(files, opts), []);
  const reversed = planFiles(files, { from: to, to: from });
  for (const change of reversed) files[change.path] = change.after;
  assert.deepEqual(files, fixture());
});

test('shell patch replaces only exact public origin fields, retains attributes, excludes secrets and mobile', () => {
  const original = client(), snapshot = structuredClone(original), patch = planClient(original, opts);
  assert.deepEqual(Object.keys(patch).sort(), ['attributes', 'redirectUris', 'webOrigins']);
  assert.deepEqual(patch.redirectUris, [to + '/auth/callback']);
  assert.deepEqual(patch.webOrigins, [to]);
  assert.deepEqual(patch.attributes, { ...original.attributes, 'post.logout.redirect.uris': to + '/' });
  assert.deepEqual(original, snapshot);
  assert.deepEqual(planClient({ ...original, ...patch }, opts), patch);
  const mobile = { ...original, clientId: 'autonexus-mobile', redirectUris: ['bo.edu.uagrm.autonexus://auth/callback'], webOrigins: [] };
  assert.throws(() => planClient(mobile, opts), /SHELL_CLIENT_POLICY_DRIFT/);
  assert.deepEqual(mobile.redirectUris, ['bo.edu.uagrm.autonexus://auth/callback']);
});

test('shell wildcard, mixed origin policy, unknown origin and missing PKCE refuse', () => {
  for (const mutated of [{ ...client(), webOrigins: ['*'] }, { ...client(), redirectUris: [from + '/*'] }, { ...client(), webOrigins: [to] }, { ...client(), webOrigins: ['http://127.0.0.1:4999'] }, { ...client(), attributes: { 'post.logout.redirect.uris': from + '/' } }]) assert.throws(() => planClient(mutated, opts));
});

test('atomic commit detects concurrent drift before any file write', () => {
  const files = fixture(), changes = planFiles(files, opts);
  materialize(files, root => {
    writeFileSync(resolve(root, changes.at(-1).path), 'concurrent');
    assert.throws(() => commitFiles(changes, root), /CONCURRENT_FILE_CHANGE/);
    assert.equal(readFileSync(resolve(root, changes[0].path), 'utf8'), changes[0].before);
  });
});

test('mid-commit failure compensates completed writes; normal commit uses no leftover temporary files', () => {
  const files = fixture(), changes = planFiles(files, opts);
  materialize(files, root => {
    let count = 0;
    assert.throws(() => commitFiles(changes, root, (path, bytes, mode) => { if (++count === 3) throw new Error('SYNTHETIC_FAILURE'); atomicWrite(path, bytes, mode); }), /SYNTHETIC_FAILURE/);
    for (const [path, bytes] of Object.entries(files)) assert.equal(readFileSync(resolve(root, path), 'utf8'), bytes);
    commitFiles(changes, root);
    for (const change of changes) assert.equal(readFileSync(resolve(root, change.path), 'utf8'), change.after);
    assert.equal(readdirSync(resolve(root, 'state')).some(name => name.includes('.origin-')), false);
  });
});

test('Docker plan has explicit existing volumes, no host secrets or credentials mounts, readonly dry run', () => {
  const args = dockerPlan(opts, 'synthetic-local-image');
  const mounts = args.filter(value => value.startsWith('type=volume,'));
  assert.equal(mounts.length, 10);
  assert.ok(mounts.every(value => value.includes('source=cu16-proof_') && value.endsWith(',readonly')));
  assert.ok(args.includes('--pull=never'));
  assert.equal(args[args.indexOf('--network') + 1], 'cu16-proof_default');
  assert.equal(args.includes('--env-file'), false);
  assert.equal(args.some(value => value.includes('.aws')), false);
  assert.equal(args.includes('--apply'), false);
  const apply = dockerPlan({ ...opts, apply: true }, 'synthetic-local-image');
  assert.equal(apply.filter(value => value.startsWith('type=volume,')).some(value => value.endsWith(',readonly')), false);
});
