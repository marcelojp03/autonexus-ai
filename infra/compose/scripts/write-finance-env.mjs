/** Writes the private Laravel environment for Finanzas from the provisioned credentials. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const workspace = process.cwd();
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: workspace, encoding: 'utf8' });
if (common.status !== 0) throw new Error('Git metadata unavailable');
const root = resolve(common.stdout.trim(), '..');
const target = resolve(root, 'services/finance/.env');
const check = spawnSync('git', ['check-ignore', '--quiet', target], { cwd: root });
if (check.status !== 0) throw new Error('services/finance/.env must be ignored by Git');

const current = {};
if (existsSync(target)) {
  for (const line of readFileSync(target, 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=');
    if (at > 0) current[line.slice(0, at).trim()] = line.slice(at + 1);
  }
}
const example = readFileSync(resolve(workspace, 'services/finance/.env.example'), 'utf8').split(/\r?\n/);
const overrides = {
  DB_CONNECTION: 'pgsql',
  DB_HOST: current.DB_HOST ?? '127.0.0.1',
  DB_PORT: current.DB_PORT ?? '55432',
  DB_DATABASE: current.DB_NAME ?? 'autonexus_finance',
  DB_USERNAME: current.DB_USER ?? 'autonexus_finance',
  DB_PASSWORD: current.DB_PASSWORD ?? '',
  APP_KEY: current.APP_KEY && current.APP_KEY.startsWith('base64:') ? current.APP_KEY : 'base64:' + randomBytes(32).toString('base64'),
  APP_URL: 'http://127.0.0.1:8000',
  APP_DEBUG: 'false',
  APP_ENV: 'local',
  LOG_CHANNEL: 'stderr',
  LOG_LEVEL: 'warning',
  SESSION_DRIVER: 'array',
  CACHE_STORE: 'array',
  QUEUE_CONNECTION: 'sync',
  OIDC_ISSUER_URI: 'http://127.0.0.1:8180/realms/autonexus',
  OIDC_AUDIENCE: 'autonexus-finance-api',
  EMPLOYEES_API_URL: current.EMPLOYEES_API_URL ?? 'http://127.0.0.1:3002',
  WEB_ALLOWED_ORIGINS: 'http://127.0.0.1:4200,http://127.0.0.1:4202,http://127.0.0.1:4204',
};
const kept = [];
const seen = new Set();
for (const line of example) {
  const at = line.indexOf('=');
  const key = at > 0 ? line.slice(0, at).trim() : null;
  if (!key) {
    kept.push(line);
    continue;
  }
  if (key in overrides) {
    kept.push(key + '=' + overrides[key]);
    seen.add(key);
  } else if (key.startsWith('#')) {
    kept.push(line);
  } else {
    kept.push(line);
  }
}
for (const [key, value] of Object.entries(overrides)) {
  if (!seen.has(key)) kept.push(key + '=' + value);
}
writeFileSync(target, kept.filter(line => !line.startsWith('# DB_')).join('\n') + '\n', { mode: 0o600 });
console.log(JSON.stringify({ written: true, database: overrides.DB_DATABASE }));
