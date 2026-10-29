/** Local CU15 verification helpers. Credentials stay in RAM/ignored owner files. */
import { createRequire } from 'node:module';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
export const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const primary = resolve(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: workspace, encoding: 'utf8' }).trim(), '..');
export const node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe';
export const php = 'C:/Users/marcelo/.config/herd/bin/php84/php.exe';
export const clientFile = resolve(primary, 'infra/keycloak/.local/cu15-coordinator-client.json');
export const brokerFile = owner => resolve(primary, 'infra/compose/.local/cu15-messaging/' + owner + '.json');
export function serviceEnvironment(owner) {
  assert.ok(['employees', 'finance', 'operations'].includes(owner));
  const entries = readFileSync(resolve(primary, 'services', owner, '.env'), 'utf8').split(String.fromCharCode(10)).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const index = line.indexOf('='); let value = line.slice(index + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [line.slice(0, index).trim(), value];
  });
  const result = Object.fromEntries(entries);
  const database = result.DB_DATABASE ?? result.DB_NAME;
  assert.equal(database, 'autonexus_' + owner, 'wrong owner database');
  assert.equal(result.DB_HOST, '127.0.0.1', 'only owned loopback databases');
  assert.equal(String(result.DB_PORT), '55432', 'wrong PostgreSQL instance');
  if (owner === 'finance') assert.equal(result.DB_CONNECTION, 'pgsql', 'finance must not fall back to SQLite');
  return result;
}
export function sanitize(text, secrets) {
  let result = String(text);
  for (const value of secrets.filter(value => typeof value === 'string' && value.length >= 8)) result = result.replaceAll(value, '[REDACTED]');
  return result.replace(/eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+/g, '[REDACTED_JWT]');
}
export async function technicalToken() {
  const credentials = JSON.parse(readFileSync(clientFile, 'utf8'));
  assert.equal(credentials.clientId, 'autonexus-cu15-coordinator');
  const response = await fetch('http://127.0.0.1:8180/realms/autonexus/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.clientId, client_secret: credentials.clientSecret }), signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, 'technical identity unavailable');
  return (await response.json()).access_token;
}
export function accounts() { return JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8')); }
export async function userToken(key) {
  const { authorize } = await import('../../services/employees/scripts/local-pkce.mjs');
  return (await authorize(accounts().find(account => account.key === key))).access_token;
}
export async function ownerDatabase(owner) {
  const env = serviceEnvironment(owner);
  const { Client } = createRequire(resolve(workspace, 'services/employees/package.json'))('pg');
  const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_DATABASE ?? env.DB_NAME, user: env.DB_USERNAME ?? env.DB_USER, password: env.DB_PASSWORD });
  await db.connect(); return db;
}
export function runFinance(args) {
  const env = serviceEnvironment('finance');
  const result = spawnSync(php, args, { cwd: resolve(workspace, 'services/finance'), env: { ...process.env, ...env, APP_DEBUG: 'false', CU15_MESSAGING_ENABLED: 'true', CU15_BROKER_CLIENT_FILE: brokerFile('finance') }, encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
  const secrets = Object.entries(env).filter(([key]) => ['PASSWORD', 'SECRET', 'KEY', 'TOKEN'].some(marker => key.includes(marker))).map(([, value]) => value);
  return { status: result.status, output: sanitize((result.stdout ?? '') + (result.stderr ?? ''), secrets) };
}
export function financeKernel(path, token, body) {
  const env = serviceEnvironment('finance');
  const child = spawn(php, [resolve(workspace, 'scripts/cu15/finance-kernel.php')], { cwd: resolve(workspace, 'services/finance'), env: { ...process.env, ...env, APP_DEBUG: 'false' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '', diagnostics = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  child.stdin.end(JSON.stringify({ path, token, body }));
  const done = new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('real PHP kernel timeout')); }, 45000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('real PHP kernel could not start')); });
    child.on('exit', code => {
      clearTimeout(timer);
      const secrets = [token, ...Object.entries(env).filter(([key]) => ['PASSWORD', 'SECRET', 'KEY', 'TOKEN'].some(marker => key.includes(marker))).map(([, value]) => value)];
      if (code !== 0) return reject(new Error('real PHP verification kernel failed: ' + sanitize(diagnostics, secrets)));
      try { resolveResult(JSON.parse(output)); } catch { reject(new Error('real PHP verification kernel returned invalid JSON')); }
    });
  });
  return { done, process: child };
}
export async function request(url, token, method = 'GET', body) {
  const target = new URL(url);
  assert.ok(target.protocol === 'http:' && target.hostname === '127.0.0.1' && ['3002', '3004', '8000', '8081'].includes(target.port), 'owner request must stay in the scoped local APIs');
  const response = await fetch(url, { method, headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  return { status: response.status, body: await response.json() };
}
