import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const workspace = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const pause = ms => new Promise(done => setTimeout(done, ms));
export function config(env = process.env) {
  const required = name => { assert.ok(env[name], 'Missing ' + name); return env[name]; };
  const endpoint = name => {
    const url = new URL(required(name));
    assert.ok(['http:', 'https:'].includes(url.protocol));
    assert.ok(!url.username && !url.password && !url.search && !url.hash);
    return url.href.replace(/\/$/, '');
  };
  return {
    employees: endpoint('CU05_EMPLOYEES_URL'), operations: endpoint('CU05_OPERATIONS_URL'),
    finance: endpoint('CU05_FINANCE_URL'), graphql: endpoint('CU05_GRAPHQL_URL'),
    shell: endpoint('CU05_SHELL_URL'), issuer: endpoint('CU05_ISSUER'),
    redirect: endpoint('CU05_REDIRECT_URI'), clientId: required('CU05_CLIENT_ID'),
    adminAccountFile: required('CU05_ADMIN_ACCOUNT_FILE'), managementFile: required('CU05_EMPLOYEES_CLIENT_FILE'),
    unlinkedAccountFile: required('CU05_UNLINKED_ACCOUNT_FILE'), playwrightModule: env.CU05_PLAYWRIGHT_MODULE,
    adminAccountKey: env.CU05_ADMIN_ACCOUNT_KEY ?? 'administrador', unlinkedAccountKey: env.CU05_UNLINKED_ACCOUNT_KEY ?? 'mecanico',
  };
}
export function privateStore(runId) {
  assert.match(runId, /^[a-zA-Z0-9-]+$/);
  const dir = resolve(workspace, 'output/cu05', runId);
  const check = spawnSync('git', ['check-ignore', '--quiet', '--no-index', '--', 'output/cu05/' + runId + '/private.json'], { cwd: workspace });
  assert.equal(check.status, 0, 'Private fixture path must be gitignored');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'private.json');
  const state = { runId, synthetic: true, accounts: [], flows: [], ownedResources: [] };
  writeFileSync(path, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
  return { dir, state, save: () => writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 }) };
}
export async function request(url, token, method = 'GET', body) {
  const response = await fetch(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}
export function expect(response, status, code) {
  assert.equal(response.status, status, 'Unexpected HTTP status');
  if (code) assert.equal(response.body?.code, code, 'Unexpected public error code');
  return response.body;
}
export function civilDate(offset = 7) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + offset * 86400000));
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}
export async function authorize(c, account) {
  const verifier = randomBytes(48).toString('base64url'), state = randomBytes(24).toString('base64url');
  const query = new URLSearchParams({ client_id: c.clientId, redirect_uri: c.redirect, response_type: 'code', response_mode: 'fragment', scope: 'openid profile', state, nonce: randomBytes(24).toString('base64url'), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  const send = (url, options = {}) => fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const form = await send(c.issuer + '/protocol/openid-connect/auth?' + query);
  assert.equal(form.status, 200, 'OIDC form unavailable');
  const match = (await form.text()).match(/<form\b[^>]*\baction="([^"]+)"/i);
  assert.ok(match, 'OIDC form missing');
  const action = new URL(match[1].replaceAll('&amp;', '&'));
  assert.equal(action.origin, new URL(c.issuer).origin);
  assert.ok(action.pathname.startsWith(new URL(c.issuer).pathname + '/login-actions/'));
  const logged = await send(action, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: form.headers.getSetCookie().map(s => s.split(';')[0]).join('; ') }, body: new URLSearchParams({ username: account.username, password: account.password, credentialId: '' }) });
  assert.equal(logged.status, 302, 'Synthetic account did not authorize');
  const callback = new URL(logged.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, c.redirect);
  const parameters = new URLSearchParams(callback.hash.slice(1));
  assert.equal(parameters.get('state'), state); assert.ok(parameters.get('code'));
  const result = await send(c.issuer + '/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: c.clientId, redirect_uri: c.redirect, code: parameters.get('code'), code_verifier: verifier }) });
  assert.equal(result.status, 200, 'PKCE exchange failed');
  const tokens = await result.json(); assert.ok(tokens.access_token); return tokens.access_token;
}
export function createSession(c) {
  const cache = new Map();
  const readAccount = file => JSON.parse(readFileSync(file, 'utf8'));
  const select = (file, key) => {
    const input = readAccount(file), account = Array.isArray(input) ? input.find(item => item.key === key) : input;
    assert.ok(account?.username && account?.password, 'Selected private account unavailable'); return account;
  };
  const admin = select(c.adminAccountFile, c.adminAccountKey), unlinked = select(c.unlinkedAccountFile, c.unlinkedAccountKey);
  async function token(account, fresh = false) {
    const key = account.subject ?? account.username;
    const old = cache.get(key);
    if (!fresh && old?.exp > Date.now() + 20000) return old.token;
    const value = await authorize(c, account);
    const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url'));
    assert.ok(claims.sub && Number.isFinite(claims.exp));
    if (account.subject) assert.equal(claims.sub, account.subject, 'Fixture subject mismatch');
    cache.set(key, { token: value, exp: claims.exp * 1000 }); return value;
  }
  const api = async (owner, path, method = 'GET', body, account = admin) => request(c[owner] + path, typeof account === 'string' ? account : account ? await token(account) : null, method, body);
  async function setNewCredential(account) {
    assert.equal(account.createdInRun, true, 'Never reset an existing account');
    const technical = readAccount(c.managementFile);
    const response = await fetch(c.issuer + '/protocol/openid-connect/token', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: technical.clientId, client_secret: technical.clientSecret }) });
    assert.equal(response.status, 200, 'E management client unavailable');
    const bearer = (await response.json()).access_token;
    const issuer = new URL(c.issuer), realmAdmin = issuer.origin + '/admin' + issuer.pathname;
    expect(await request(realmAdmin + '/users/' + encodeURIComponent(account.subject) + '/reset-password', bearer, 'PUT', { type: 'password', value: account.password, temporary: false }), 204);
  }
  return { admin, unlinked, token, api, setNewCredential };
}
