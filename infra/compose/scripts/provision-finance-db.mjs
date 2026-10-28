/**
 * Provision the Finanzas database on an already initialized Compose volume.
 * Idempotent, never prints secrets, and refuses to touch other owners' objects.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspace = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: workspace, encoding: 'utf8' });
if (common.status !== 0) throw new Error('Git metadata unavailable');
const root = resolve(common.stdout.trim(), '..');
const { Client } = createRequire(resolve(root, 'services/employees/package.json'))('pg');
const composeEnv = {};
for (const line of readFileSync(resolve(root, 'infra/compose/.env'), 'utf8').split(/\r?\n/)) {
  const at = line.indexOf('=');
  if (at > 0) composeEnv[line.slice(0, at).trim()] = line.slice(at + 1);
}
const database = composeEnv.FINANCE_DB ?? 'autonexus_finance';
const role = composeEnv.FINANCE_USER ?? 'autonexus_finance';
const privateEnv = resolve(root, 'services/finance/.env');
const ignore = spawnSync('git', ['check-ignore', '--quiet', privateEnv], { cwd: root });
if (ignore.status !== 0) throw new Error('services/finance/.env must be ignored by Git');

let password = composeEnv.FINANCE_PASSWORD;
if (!password && existsSync(privateEnv)) {
  const line = readFileSync(privateEnv, 'utf8').split(/\r?\n/).find(entry => entry.startsWith('DB_PASSWORD='));
  password = line ? line.slice('DB_PASSWORD='.length) : undefined;
}
if (!password) password = randomBytes(24).toString('base64url');

const db = new Client({
  host: composeEnv.DB_HOST ?? '127.0.0.1',
  port: Number(composeEnv.POSTGRES_PORT ?? 55432),
  database: composeEnv.POSTGRES_DB ?? 'postgres',
  user: composeEnv.POSTGRES_ADMIN_USER,
  password: composeEnv.POSTGRES_ADMIN_PASSWORD,
});
await db.connect();
const roles = await db.query('SELECT rolname FROM pg_roles WHERE rolname = $1', [role]);
if (roles.rowCount === 0) {
  const create = await db.query("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', $1::text, $2::text) AS sql", [role, password]);
  await db.query(create.rows[0].sql);
} else {
  const alter = await db.query("SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS sql", [role, password]);
  await db.query(alter.rows[0].sql);
}
const databases = await db.query('SELECT datname FROM pg_database WHERE datname = $1', [database]);
if (databases.rowCount === 0) {
  await db.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(role)}`);
}
await db.query(`REVOKE ALL ON DATABASE ${quoteIdent(database)} FROM PUBLIC`);
await db.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${quoteIdent(database)} TO ${quoteIdent(role)}`);
await db.end();

if (!existsSync(privateEnv)) {
  const port = composeEnv.POSTGRES_PORT ?? '55432';
  const content = [
    'APP_PORT=8000',
    'DB_HOST=127.0.0.1',
    `DB_PORT=${port}`,
    `DB_NAME=${database}`,
    `DB_USER=${role}`,
    `DB_PASSWORD=${password}`,
    'EMPLOYEES_API_URL=http://127.0.0.1:3002',
    '',
  ].join('\n');
  writeFileSync(privateEnv, content, { flag: 'wx', mode: 0o600 });
}
console.log(JSON.stringify({ provisioned: true, database, role, privateEnvWritten: existsSync(privateEnv) }));

function quoteIdent(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid identifier');
  return '"' + value + '"';
}
