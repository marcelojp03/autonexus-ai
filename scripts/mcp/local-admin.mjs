import { execFileSync } from 'node:child_process';
import { resolve, dirname, basename, isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const ensure = (ok, code) => { if (!ok) throw new Error(code); };
export const normalized = value => resolve(value).replaceAll('\\', '/').toLowerCase();
export function mainRepositoryRoot(commonGitDirectory) {
  ensure(typeof commonGitDirectory === 'string' && isAbsolute(commonGitDirectory) && basename(commonGitDirectory) === '.git', 'COMMON_GIT_DIRECTORY_INVALID');
  return dirname(commonGitDirectory);
}
const docker = args => execFileSync('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
export function assertContainer(labels, service, root, linkedFixtureSource) {
  ensure(labels['com.docker.compose.project'] === 'cu16-proof' && labels['com.docker.compose.service'] === service, 'CONTAINER_OWNERSHIP');
  const source = labels['com.docker.compose.project.working_dir'];
  ensure(typeof source === 'string' && source.trim().length > 0 && isAbsolute(source), 'CONTAINER_WORKDIR');
  const allowed = [normalized(root)];
  if (linkedFixtureSource !== undefined) {
    ensure(normalized(linkedFixtureSource) === normalized(resolve(root, '.worktrees/work-marcelo')), 'LINKED_FIXTURE_SOURCE_INVALID');
    allowed.push(normalized(linkedFixtureSource));
  }
  ensure(allowed.includes(normalized(source)), 'CONTAINER_WORKDIR');
}
export function inspect(service, root, linkedFixtureSource) {
  const name = 'cu16-proof-' + service + '-1';
  assertContainer(JSON.parse(docker(['inspect', name, '--format', '{{json .Config.Labels}}'])), service, root, linkedFixtureSource);
  return name;
}
export function assertSubset(actual, expected, code = 'CONFIG_DRIFT') {
  ensure(Object.entries(expected).every(([key, value]) => isDeepStrictEqual(actual[key], value)), code);
}

/** A one-shot setup session can outlive the master's 60-second access token. */
export function administrativeChannel(initial, { refresh, request, writable = false, now = Date.now }) {
  // The master-realm bootstrap token carries `sid` but no `sub`; either anchors the same session.
  const anchor = token => {
    try {
      const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      for (const claim of ['sid', 'sub']) if (typeof value[claim] === 'string' && value[claim]) return claim + ':' + value[claim];
      throw new Error('ADMIN_SESSION_INVALID');
    } catch { throw new Error('ADMIN_SESSION_INVALID'); }
  };
  const validate = tokens => ensure(typeof tokens?.access_token === 'string' && typeof tokens.refresh_token === 'string'
    && Number.isFinite(tokens.expires_in) && tokens.expires_in > 0, 'ADMIN_SESSION_INVALID');
  validate(initial);
  const originalAnchor = anchor(initial.access_token);
  let tokens = initial; let expiresAt = now() + tokens.expires_in * 1000; let refreshCount = 0;
  const renew = () => {
    let next;
    try { next = refresh(tokens.refresh_token); validate(next); ensure(anchor(next.access_token) === originalAnchor, 'ADMIN_SESSION_SUBJECT_CHANGED'); }
    catch { throw new Error('ADMIN_SESSION_REFRESH_FAILED'); }
    tokens = next; expiresAt = now() + tokens.expires_in * 1000; refreshCount++;
  };
  return {
    api(path, method = 'GET', body) {
      ensure(method === 'GET' || writable, 'READ_ONLY_ADMIN');
      let renewed = false;
      if (now() + 15000 >= expiresAt) { renew(); renewed = true; }
      let response = request(path, tokens.access_token, method, body);
      if (response.status === 401 && !renewed) { renew(); response = request(path, tokens.access_token, method, body); }
      ensure([200, 201, 204].includes(response.status), 'IDP_HTTP_' + response.status);
      return response.data;
    },
    get refreshToken() { return tokens.refresh_token; },
    get refreshCount() { return refreshCount; },
  };
}
export function internal(url, { token, method = 'GET', body, form = false } = {}) {
  const source = "let s='';for await(const c of process.stdin)s+=c;try{const v=JSON.parse(s);const r=await fetch(v.url,{method:v.method,headers:{...(v.token?{Authorization:'Bearer '+v.token}:{}),...(v.body===undefined?{}:{'Content-Type':v.form?'application/x-www-form-urlencoded':'application/json'})},...(v.body===undefined?{}:{body:v.form?new URLSearchParams(v.body):JSON.stringify(v.body)}),redirect:'error',signal:AbortSignal.timeout(12000)});const t=await r.text();process.stdout.write(JSON.stringify({status:r.status,data:t?JSON.parse(t):null}));}catch{process.stdout.write(JSON.stringify({status:0,data:null}));process.exitCode=1;}";
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'cu16-proof-employees-1', 'node', '--input-type=module', '-e', source], {
    input: JSON.stringify({ url, token, method, body, form }), stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000,
  }));
}
function bootstrapPassword(origin, root, linkedFixtureSource) {
  const container = inspect('provision', root, linkedFixtureSource);
  const mounts = JSON.parse(docker(['inspect', container, '--format', '{{json .Mounts}}']));
  ensure(mounts.some(m => m.Name === 'cu16-proof_bootstrap-state' && m.Destination === '/state'), 'BOOTSTRAP_VOLUME_OWNERSHIP');
  const tar = docker(['cp', container + ':/state/bootstrap.json', '-']);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/s, '').trim(), 8);
    ensure(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length, 'BOOTSTRAP_ARCHIVE_INVALID');
    if (name === 'bootstrap.json' || name === './bootstrap.json') {
      const state = JSON.parse(tar.subarray(offset + 512, offset + 512 + size));
      ensure(state.publicOrigin === origin && /^[a-f0-9]{64}$/.test(state.secrets?.keycloak), 'BOOTSTRAP_STATE_MISMATCH');
      return state.secrets.keycloak;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('EXISTING_BOOTSTRAP_AUTHORITY_UNAVAILABLE');
}
export async function withLocalAdmin(origin, root, work, writable = false, linkedFixtureSource) {
  inspect('employees', root, linkedFixtureSource); inspect('keycloak', root, linkedFixtureSource);
  const master = 'http://keycloak:8080/identity/realms/master/protocol/openid-connect';
  const session = internal(master + '/token', { method: 'POST', form: true, body: {
    grant_type: 'password', client_id: 'admin-cli', username: 'bootstrap', password: bootstrapPassword(origin, root, linkedFixtureSource),
  } });
  ensure(session.status === 200 && session.data?.access_token && session.data?.refresh_token, 'BOOTSTRAP_LOGIN_FAILED');
  let channel;
  try {
    channel = administrativeChannel(session.data, { writable,
      request: (path, token, method, body) => internal('http://keycloak:8080/identity/admin/realms/autonexus' + path, { token, method, body }),
      refresh: refreshToken => {
        const refreshed = internal(master + '/token', { method: 'POST', form: true, body: { grant_type: 'refresh_token', client_id: 'admin-cli', refresh_token: refreshToken } });
        ensure(refreshed.status === 200, 'BOOTSTRAP_REFRESH_FAILED'); return refreshed.data;
      },
    });
    return await work(channel.api, { expiresIn: session.data.expires_in, get refreshCount() { return channel.refreshCount; } });
  } finally {
    const response = internal(master + '/logout', { method: 'POST', form: true, body: { client_id: 'admin-cli', refresh_token: channel?.refreshToken ?? session.data.refresh_token } });
    ensure(response.status === 204, 'BOOTSTRAP_LOGOUT_FAILED');
  }
}
