import { readFileSync, writeFileSync, renameSync, unlinkSync, statSync, existsSync, openSync, closeSync, fsyncSync, fchmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ensure = (condition, code) => { if (!condition) throw new Error(code); };
const origins = ['http://127.0.0.1:4285', 'http://127.0.0.1:4286'];
export const consumers = ['keycloak', 'employees', 'operations', 'finance', 'intelligence', 'sync', 'bff', 'public', 'demo'];
const keys = {
  keycloak: { KC_HOSTNAME: '/identity' },
  ...Object.fromEntries(['employees', 'operations', 'finance', 'intelligence', 'sync', 'bff'].map(name => [name, { OIDC_ISSUER_URI: '/identity/realms/autonexus', WEB_ALLOWED_ORIGINS: '', ...(name === 'finance' ? { APP_URL: '' } : {}) }])),
  public: { PUBLIC_ORIGIN: '' }, demo: { PUBLIC_ORIGIN: '', OIDC_ISSUER_URI: '/identity/realms/autonexus' },
};

export function options(args) {
  const result = { apply: false, inside: false, acknowledge: false }, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    ensure(!seen.has(key), 'DUPLICATE_OPTION'); seen.add(key);
    if (key === '--apply') result.apply = true;
    else if (key === '--inside') result.inside = true;
    else if (key === '--queue-exported-admin-finished') result.acknowledge = true;
    else {
      ensure(['--from', '--to', '--project'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--'), 'ARGUMENT_INVALID');
      result[key.slice(2)] = args[++i];
    }
  }
  ensure(result.project === 'cu16-proof', 'PROJECT_MISMATCH');
  ensure(origins.includes(result.from) && origins.includes(result.to) && result.from !== result.to, 'ORIGIN_PAIR_MISMATCH');
  ensure(!result.apply || result.acknowledge, 'EXPORT_AND_ADMIN_COMPLETION_REQUIRED');
  return result;
}

function publicJson(bytes, from, to) {
  const value = JSON.parse(bytes);
  ensure([from, to].includes(value.publicOrigin), 'STATE_ORIGIN_MISMATCH');
  const matches = [...bytes.matchAll(/"publicOrigin"\s*:\s*"[^"\\]*"/g)];
  ensure(matches.length === 1, 'STATE_ORIGIN_AMBIGUOUS');
  return bytes.replace(matches[0][0], matches[0][0].replace(JSON.stringify(value.publicOrigin), JSON.stringify(to)));
}

export function runtimeConfig(origin) {
  return 'globalThis.__AUTONEXUS_CONFIG__ = ' + JSON.stringify({ version: 1, oidcUrl: origin + '/identity', graphqlUrl: origin + '/graphql', technicalUrls: { employees: origin + '/technical/employees', operations: origin + '/technical/operations' } }) + ';\n';
}

export function planFiles(files, { from, to }) {
  const state = JSON.parse(files['state/bootstrap.json']);
  ensure(state.version === 1 && state.secrets && state.admin, 'STATE_INVALID');
  const next = { ...files };
  next['state/bootstrap.json'] = publicJson(files['state/bootstrap.json'], from, to);
  const updated = JSON.parse(next['state/bootstrap.json']);
  ensure(equal(state.secrets, updated.secrets) && equal(state.admin, updated.admin), 'PRIVATE_STATE_CHANGED');
  const marker = 'state/identity-ready.json';
  ensure(JSON.parse(files[marker]).version === 1, 'IDENTITY_MARKER_INVALID');
  next[marker] = publicJson(files[marker], from, to);
  for (const consumer of consumers) {
    const path = 'config/' + consumer + '/service.env';
    let bytes = files[path];
    ensure(typeof bytes === 'string', 'CONFIG_MISSING');
    for (const [key, suffix] of Object.entries(keys[consumer])) {
      const pattern = new RegExp('^' + key + '=([^\\r\\n]*)(?=\\r?$)', 'gm');
      const matches = [...bytes.matchAll(pattern)];
      ensure(matches.length === 1, 'CONFIG_KEY_MISSING_OR_DUPLICATE');
      const oldValue = "'" + from + suffix + "'", newValue = "'" + to + suffix + "'";
      ensure([oldValue, newValue].includes(matches[0][1]), 'CONFIG_PUBLIC_VALUE_DRIFT');
      bytes = bytes.replace(pattern, key + '=' + newValue);
    }
    next[path] = bytes;
  }
  const runtime = 'config/public/runtime-config.js';
  ensure([runtimeConfig(from), runtimeConfig(to)].includes(files[runtime]), 'PUBLIC_RUNTIME_DRIFT');
  next[runtime] = runtimeConfig(to);
  return Object.entries(next).filter(([path, after]) => after !== files[path]).map(([path, after]) => ({ path, before: files[path], after }));
}

export function planClient(client, { from, to }) {
  ensure(client.clientId === 'autonexus-shell' && client.publicClient === true && client.protocol === 'openid-connect' && client.attributes?.['pkce.code.challenge.method'] === 'S256', 'SHELL_CLIENT_POLICY_DRIFT');
  for (const origin of [from, to]) {
    if (equal(client.redirectUris, [origin + '/auth/callback']) && equal(client.webOrigins, [origin]) && client.attributes['post.logout.redirect.uris'] === origin + '/') {
      return { redirectUris: [to + '/auth/callback'], webOrigins: [to], attributes: { ...client.attributes, 'post.logout.redirect.uris': to + '/' } };
    }
  }
  throw new Error('SHELL_ORIGIN_POLICY_DRIFT');
}

export function atomicWrite(path, bytes, mode) {
  const temporary = path + '.origin-' + randomUUID();
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); fchmodSync(fd, mode); } finally { closeSync(fd); }
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function commitFiles(changes, root = '/', writer = atomicWrite) {
  for (const change of changes) ensure(readFileSync(resolve(root, change.path), 'utf8') === change.before, 'CONCURRENT_FILE_CHANGE');
  const completed = [];
  try {
    for (const change of changes) {
      const target = resolve(root, change.path), mode = statSync(target).mode & 0o777;
      writer(target, change.after, mode); completed.push({ ...change, mode });
    }
  } catch (error) {
    try { for (const change of completed.reverse()) atomicWrite(resolve(root, change.path), change.before, change.mode); }
    catch { throw new Error('FILE_ROLLBACK_REQUIRED'); }
    throw error;
  }
}

async function inside(opts) {
  const paths = ['state/bootstrap.json', 'state/identity-ready.json', ...consumers.map(name => 'config/' + name + '/service.env'), 'config/public/runtime-config.js'];
  const files = Object.fromEntries(paths.map(path => [path, readFileSync('/' + path, 'utf8')]));
  const changes = planFiles(files, opts);
  // A dry run never logs in: creating an administrative session is a realm mutation.
  if (!opts.apply) { console.log(JSON.stringify({ dryRun: true, filesValid: true, filesWouldChange: changes.length > 0, identityChecked: false, secretsPreserved: true })); return; }
  const state = JSON.parse(files['state/bootstrap.json']), base = 'http://keycloak:8080/identity';
  let session;
  async function request(path, { method = 'GET', body, form = false, auth = true } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(auth ? { Authorization: 'Bearer ' + session.access_token } : {}), ...(body === undefined ? {} : { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }) }, ...(body === undefined ? {} : { body: form ? new URLSearchParams(body) : JSON.stringify(body) }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    ensure([200, 204].includes(response.status), 'IDENTITY_REQUEST_FAILED');
    return response.status === 204 ? null : response.json();
  }
  const tokenPath = '/realms/master/protocol/openid-connect';
  session = await request(tokenPath + '/token', { method: 'POST', auth: false, form: true, body: { grant_type: 'password', client_id: 'admin-cli', username: 'bootstrap', password: state.secrets.keycloak } });
  ensure(typeof session.access_token === 'string' && typeof session.refresh_token === 'string', 'BOOTSTRAP_SESSION_INVALID');
  let lock;
  const lockPath = '/state/.origin-migration.lock';
  try {
    lock = openSync(lockPath, 'wx', 0o600);
    const api = '/admin/realms/autonexus/clients', found = await request(api + '?clientId=autonexus-shell');
    ensure(found.length === 1 && typeof found[0].id === 'string', 'SHELL_NOT_UNIQUE');
    const clientPath = api + '/' + encodeURIComponent(found[0].id);
    const client = await request(clientPath), patch = planClient(client, opts);
    const previous = { redirectUris: client.redirectUris, webOrigins: client.webOrigins, attributes: client.attributes };
    const clientChanged = !equal(previous, patch);
    if (!changes.length && !clientChanged) { console.log(JSON.stringify({ applied: false, alreadyCurrent: true, secretsPreserved: true, identityChecked: true })); return; }
    const backup = '/state/origin-' + new URL(opts.from).port + '-' + new URL(opts.to).port + '-' + randomUUID() + '.private.json';
    atomicWrite(backup, JSON.stringify({ version: 1, project: opts.project, from: opts.from, to: opts.to, files, shell: { id: client.id, ...previous } }) + '\n', 0o600);
    let identityWriteAttempted = false;
    try {
      ensure(equal(await request(clientPath), client), 'CONCURRENT_CLIENT_CHANGE');
      if (clientChanged) { identityWriteAttempted = true; await request(clientPath, { method: 'PUT', body: patch }); }
      const verified = await request(clientPath);
      ensure(equal({ redirectUris: verified.redirectUris, webOrigins: verified.webOrigins, attributes: verified.attributes }, patch), 'IDENTITY_VERIFY_FAILED');
      const originFields = new Set(['redirectUris', 'webOrigins', 'attributes']);
      ensure(Object.entries(client).filter(([key]) => !originFields.has(key)).every(([key, value]) => equal(verified[key], value)), 'CLIENT_NON_ORIGIN_POLICY_CHANGED');
      commitFiles(changes);
    } catch (error) {
      // A PUT timeout is uncertain; restoring the original public fields is idempotent.
      try { if (identityWriteAttempted) await request(clientPath, { method: 'PUT', body: previous }); }
      catch { throw new Error('IDENTITY_ROLLBACK_REQUIRED'); }
      throw error;
    }
    console.log(JSON.stringify({ applied: true, backupCreated: true, secretsPreserved: true, identityChecked: true, runtimeRestarted: false }));
  } finally {
    if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); }
    await request(tokenPath + '/logout', { method: 'POST', auth: false, form: true, body: { client_id: 'admin-cli', refresh_token: session.refresh_token } });
  }
}

export function dockerPlan(opts, image) {
  const access = opts.apply ? '' : ',readonly';
  return ['run', '--rm', '-i', '--name', opts.project + '-origin-migration', '--pull=never', '--network', opts.project + '_default', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '0:0',
    '--mount', 'type=volume,source=' + opts.project + '_bootstrap-state,target=/state' + access,
    ...consumers.flatMap(name => ['--mount', 'type=volume,source=' + opts.project + '_config-' + name + ',target=/config/' + name + access]),
    '--entrypoint', 'node', image, '--input-type=module', '-', '--inside', '--project', opts.project, '--from', opts.from, '--to', opts.to,
    ...(opts.apply ? ['--apply', '--queue-exported-admin-finished'] : [])];
}

function host(opts) {
  const docker = args => execFileSync('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000, maxBuffer: 1024 * 1024 });
  for (const name of ['bootstrap-state', ...consumers.map(name => 'config-' + name)]) {
    const labels = JSON.parse(docker(['volume', 'inspect', opts.project + '_' + name, '--format', '{{json .Labels}}']).toString());
    ensure(labels?.['com.docker.compose.project'] === opts.project, 'VOLUME_PROJECT_MISMATCH');
  }
  const network = JSON.parse(docker(['network', 'inspect', opts.project + '_default', '--format', '{{json .Labels}}']).toString());
  ensure(network?.['com.docker.compose.project'] === opts.project, 'NETWORK_PROJECT_MISMATCH');
  const labels = JSON.parse(docker(['inspect', opts.project + '-employees-1', '--format', '{{json .Config.Labels}}']).toString());
  ensure(labels?.['com.docker.compose.project'] === opts.project && labels?.['com.docker.compose.service'] === 'employees', 'IMAGE_PROJECT_MISMATCH');
  const image = docker(['inspect', opts.project + '-employees-1', '--format', '{{.Image}}']).toString().trim();
  ensure(/^sha256:[a-f0-9]{64}$/.test(image), 'IMAGE_INVALID');
  try {
    process.stdout.write(execFileSync('docker', dockerPlan(opts, image), { input: readFileSync(new URL(import.meta.url)), stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000, maxBuffer: 1024 * 1024 }));
  } catch (error) {
    const code = String(error.stderr ?? '').match(/^FAIL ([A-Z_]+); private diagnostics omitted$/m)?.[1];
    throw new Error(code ?? 'HELPER_FAILED');
  }
}

if (process.argv.includes('--inside') || (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)) {
  try { const opts = options(process.argv.slice(2)); if (opts.inside) await inside(opts); else host(opts); }
  catch (error) { console.error('FAIL ' + (/^[A-Z_]+$/.test(error.message) ? error.message : 'ORIGIN_MIGRATION_FAILED') + '; private diagnostics omitted'); process.exitCode = 1; }
}
