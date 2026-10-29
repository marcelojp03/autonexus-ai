import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, chmodSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { provisionIdentity } from './bootstrap/identity.mjs';
import { exchange, deadExchange, vhost, queues, permissions, topicPermissions, queueArguments } from '../rabbitmq/scripts/topology.mjs';

export const consumers = ['postgres', 'idp-postgres', 'keycloak', 'rabbitmq', 'employees', 'operations', 'finance', 'bff', 'public', 'demo'];
export const ensure = (condition, code) => { if (!condition) throw new Error(code); };
export const json = value => JSON.stringify(value, null, 2) + '\n';
export function origin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('PUBLIC_ORIGIN_INVALID'); }
  ensure(typeof value === 'string' && value === url.origin && !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))), 'PUBLIC_ORIGIN_INVALID');
  return value;
}
export function shellEnv(values) {
  return Object.entries(values).map(([key, value]) => {
    ensure(/^[A-Z][A-Z0-9_]*$/.test(key) && !/[\x00\r\n]/.test(String(value)), 'ENV_INVALID');
    return key + "='" + String(value).replaceAll("'", "'\\''") + "'";
  }).join('\n') + '\n';
}
export function preserve(file, content, mode = 0o600) {
  if (existsSync(file)) ensure(readFileSync(file, 'utf8') === content, 'CONFIG_DRIFT');
  else { mkdirSync(resolve(file, '..'), { recursive: true, mode: mode === 0o600 ? 0o700 : 0o755 }); writeFileSync(file, content, { flag: 'wx', mode }); }
}
export function configuration(state) {
  const s = state.secrets, publicOrigin = origin(state.publicOrigin);
  const issuer = publicOrigin + '/identity/realms/autonexus';
  const internal = 'http://keycloak:8080/identity';
  const auth = { OIDC_ISSUER_URI: issuer, OIDC_JWKS_URI: internal + '/realms/autonexus/protocol/openid-connect/certs', WEB_ALLOWED_ORIGINS: publicOrigin };
  const result = {
    postgres: { POSTGRES_USER: 'bootstrap', POSTGRES_DB: 'postgres', POSTGRES_PASSWORD: s.postgres },
    'idp-postgres': { POSTGRES_USER: 'idp_database_admin', POSTGRES_DB: 'postgres', POSTGRES_PASSWORD: s.idpAdmin, IDP_DB_PASSWORD: s.idpPostgres },
    keycloak: { KC_DB: 'postgres', KC_DB_URL: 'jdbc:postgresql://idp-postgres:5432/autonexus_idp', KC_DB_USERNAME: 'autonexus_idp', KC_DB_PASSWORD: s.idpPostgres, KC_BOOTSTRAP_ADMIN_USERNAME: 'bootstrap', KC_BOOTSTRAP_ADMIN_PASSWORD: s.keycloak, KC_HOSTNAME: publicOrigin + '/identity', KC_HTTP_RELATIVE_PATH: '/identity', KC_HTTP_MANAGEMENT_RELATIVE_PATH: '/', KC_PROXY_HEADERS: 'xforwarded', KC_HTTP_ENABLED: 'true', KC_HEALTH_ENABLED: 'true' },
    rabbitmq: { RABBITMQ_DEFAULT_USER: 'autonexus_setup', RABBITMQ_DEFAULT_PASS: s.rabbitmq },
    bff: { ...auth, HTTP_HOST: '0.0.0.0', PORT: 3004, EMPLOYEES_API_URL: 'http://employees:3002', OPERATIONS_API_URL: 'http://operations:8081', FINANCE_API_URL: 'http://finance:8000' },
    public: { PUBLIC_ORIGIN: publicOrigin }, demo: { PUBLIC_ORIGIN: publicOrigin, OIDC_ISSUER_URI: issuer },
  };
  for (const owner of ['employees', 'operations', 'finance']) {
    const database = 'autonexus_' + owner;
    Object.assign(result.postgres, { [owner.toUpperCase() + '_USER']: database, [owner.toUpperCase() + '_DB']: database, [owner.toUpperCase() + '_PASSWORD']: s[owner + 'Db'] });
    result[owner] = { ...auth, OIDC_AUDIENCE: 'autonexus-' + owner + '-api', DB_HOST: 'postgres', DB_PORT: 5432, DB_NAME: database, DB_USER: database, DB_PASSWORD: s[owner + 'Db'], RABBITMQ_URL: 'amqp://' + database + ':' + s[owner + 'Rabbit'] + '@rabbitmq:5672/autonexus', CU15_BROKER_CLIENT_FILE: '/run/config/broker-client.json', CU15_MESSAGING_ENABLED: 'true' };
  }
  Object.assign(result.employees, { HTTP_HOST: '0.0.0.0', PORT: 3002, OIDC_ADMIN_BASE_URL: internal, OIDC_TOKEN_URL: internal + '/realms/autonexus/protocol/openid-connect/token', EMPLOYEES_IDP_CLIENT_FILE: '/run/config/employees-client.json' });
  Object.assign(result.operations, { HTTP_HOST: '0.0.0.0', PORT: 8081, CU15_ENABLED: 'true', EMPLOYEES_API_URL: 'http://employees:3002', FINANCE_API_URL: 'http://finance:8000', OIDC_TOKEN_URL: internal + '/realms/autonexus/protocol/openid-connect/token', CU15_IDP_CLIENT_FILE: '/run/config/cu15-coordinator-client.json' });
  Object.assign(result.finance, { APP_ENV: 'local', APP_DEBUG: 'false', APP_KEY: s.appKey, APP_URL: publicOrigin, DB_CONNECTION: 'pgsql', DB_DATABASE: 'autonexus_finance', DB_USERNAME: 'autonexus_finance', SESSION_DRIVER: 'file', CACHE_STORE: 'file', QUEUE_CONNECTION: 'sync', EMPLOYEES_API_URL: 'http://employees:3002' });
  return result;
}
export function init({ stateDir = '/state', configDir = '/config', publicOrigin = process.env.PUBLIC_ORIGIN } = {}) {
  const file = resolve(stateDir, 'bootstrap.json');
  let state;
  if (existsSync(file)) {
    state = JSON.parse(readFileSync(file, 'utf8'));
    ensure(state.version === 1 && state.secrets && state.admin, 'STATE_INVALID');
    if (publicOrigin !== undefined) ensure(origin(publicOrigin) === state.publicOrigin, 'PUBLIC_ORIGIN_DRIFT');
  } else {
    for (const consumer of consumers) {
      const directory = resolve(configDir, consumer);
      ensure(!existsSync(directory) || readdirSync(directory).length === 0, 'STATE_MISSING_CONFIG_EXISTS');
    }
    const secrets = Object.fromEntries(['postgres', 'idpAdmin', 'idpPostgres', 'keycloak', 'rabbitmq', 'employeesClient', 'coordinatorClient', ...['employees', 'operations', 'finance'].flatMap(owner => [owner + 'Db', owner + 'Rabbit'])].map(key => [key, randomBytes(32).toString('hex')]));
    secrets.appKey = 'base64:' + randomBytes(32).toString('base64');
    state = { version: 1, publicOrigin: origin(publicOrigin), secrets, admin: { username: 'admin_' + randomBytes(8).toString('hex'), password: randomBytes(32).toString('hex'), roles: ['administrador'] } };
    preserve(file, json(state));
  }
  for (const key of ['postgres', 'idpAdmin', 'idpPostgres', 'keycloak', 'rabbitmq', 'employeesClient', 'coordinatorClient', ...['employees', 'operations', 'finance'].flatMap(owner => [owner + 'Db', owner + 'Rabbit'])]) ensure(/^[a-f0-9]{64}$/.test(state.secrets[key]), 'STATE_INVALID');
  ensure(/^base64:[A-Za-z0-9+/]{43}=$/.test(state.secrets.appKey) && /^[a-f0-9]{64}$/.test(state.admin.password), 'STATE_INVALID');
  const configs = configuration(state);
  for (const consumer of consumers) {
    const directory = resolve(configDir, consumer);
    mkdirSync(directory, { recursive: true, mode: 0o755 }); chmodSync(directory, 0o755);
    if (consumer === 'finance') {
      const target = resolve(directory, 'service.env');
      const legacy = { ...configs.finance }; delete legacy.EMPLOYEES_API_URL;
      // One exact generated predecessor may gain this non-secret endpoint atomically.
      // Any other drift still fails; no credentials or business records are rewritten.
      if (existsSync(target) && readFileSync(target, 'utf8') === shellEnv(legacy)) {
        const temporary = resolve(directory, '.transport-' + randomBytes(8).toString('hex') + '.env');
        writeFileSync(temporary, shellEnv(configs.finance), { flag: 'wx', mode: 0o444 });
        renameSync(temporary, target);
      }
    }
    preserve(resolve(directory, 'service.env'), shellEnv(configs[consumer]), 0o444);
  }
  for (const owner of ['employees', 'operations', 'finance']) preserve(resolve(configDir, owner, 'broker-client.json'), json({ host: 'rabbitmq', port: 5672, vhost: 'autonexus', username: 'autonexus_' + owner, password: state.secrets[owner + 'Rabbit'] }), 0o444);
  preserve(resolve(configDir, 'demo/admin-account.json'), json(state.admin), 0o444);
  preserve(resolve(configDir, 'demo/employees-client.json'), json({ clientId: 'autonexus-employees-admin', clientSecret: state.secrets.employeesClient }), 0o444);
  const publicConfig = { version: 1, oidcUrl: state.publicOrigin + '/identity', graphqlUrl: state.publicOrigin + '/graphql', technicalUrls: { employees: state.publicOrigin + '/technical/employees', operations: state.publicOrigin + '/technical/operations' } };
  preserve(resolve(configDir, 'public/runtime-config.js'), 'globalThis.__AUTONEXUS_CONFIG__ = ' + JSON.stringify(publicConfig) + ';\n', 0o444);
  return state;
}
export async function retry(check, attempts = 60, delay = 1000) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await check(); } catch { if (attempt + 1 === attempts) throw new Error('READINESS_EXHAUSTED'); }
    await pause(delay);
  }
}
export function httpApi(base, authorization) {
  return async (path, method = 'GET', body, allowed = [200, 201, 204]) => {
    const response = await fetch(base + path, { method, headers: { Authorization: authorization, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000), redirect: 'error' });
    ensure(allowed.includes(response.status), 'HTTP_STATUS_' + response.status);
    return response.status === 200 ? response.json() : null;
  };
}
export async function provisionDatabases(state) {
  const module = await import(process.env.BOOTSTRAP_PG_MODULE || 'pg');
  const Client = module.Client ?? module.default.Client;
  const connect = async (user, password, database) => {
    const client = new Client({ host: 'postgres', port: 5432, user, password, database, connectionTimeoutMillis: 5000, query_timeout: 5000 });
    try { await client.connect(); await client.query('SELECT 1'); return client; } catch (error) { await client.end().catch(() => {}); throw error; }
  };
  const admin = await retry(() => connect('bootstrap', state.secrets.postgres, 'postgres'));
  try {
    for (const owner of ['employees', 'operations', 'finance']) {
      const name = 'autonexus_' + owner, password = state.secrets[owner + 'Db'];
      ensure(/^[a-f0-9]{64}$/.test(password), 'STATE_INVALID');
      const roles = await admin.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1', [name]);
      if (!roles.rowCount) await admin.query('CREATE ROLE ' + name + " LOGIN PASSWORD '" + password + "' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
      else ensure(Object.values(roles.rows[0]).every(value => value === false), 'DATABASE_ROLE_DRIFT');
      const databases = await admin.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1', [name]);
      if (!databases.rowCount) await admin.query('CREATE DATABASE ' + name + ' OWNER ' + name);
      else ensure(databases.rows[0].owner === name, 'DATABASE_OWNER_DRIFT');
      await admin.query('REVOKE ALL ON DATABASE ' + name + ' FROM PUBLIC');
      const client = await connect(name, password, name);
      try { await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC'); } finally { await client.end(); }
    }
  } finally { await admin.end(); }
}
export async function provisionRabbit(state) {
  const api = httpApi('http://rabbitmq:15672/api', 'Basic ' + Buffer.from('autonexus_setup:' + state.secrets.rabbitmq).toString('base64'));
  await retry(() => api('/overview'));
  const root = '/' + encodeURIComponent(vhost);
  await api('/vhosts' + root, 'PUT', {});
  for (const [name, type] of [[exchange, 'topic'], [deadExchange, 'direct']]) await api('/exchanges' + root + '/' + name, 'PUT', { type, durable: true, auto_delete: false, internal: false, arguments: {} });
  for (const queue of queues) {
    const dead = 'cu15.' + queue.owner + '.dlq.v1';
    await api('/queues' + root + '/' + dead, 'PUT', { durable: true, auto_delete: false, arguments: {} });
    await api('/bindings' + root + '/e/' + deadExchange + '/q/' + dead, 'POST', { routing_key: queue.deadKey, arguments: {} });
    await api('/queues' + root + '/' + queue.name, 'PUT', { durable: true, auto_delete: false, arguments: queueArguments(queue) });
    for (const key of queue.bindings) await api('/bindings' + root + '/e/' + exchange + '/q/' + queue.name, 'POST', { routing_key: key, arguments: {} });
  }
  for (const owner of ['employees', 'operations', 'finance']) {
    const user = 'autonexus_' + owner;
    const existing = await api('/users/' + user, 'GET', undefined, [200, 404]);
    if (existing) ensure(!existing.tags?.length, 'BROKER_AUTHORITY_DRIFT');
    else await api('/users/' + user, 'PUT', { password: state.secrets[owner + 'Rabbit'], tags: '' });
    await api('/permissions' + root + '/' + user, 'PUT', permissions(owner));
    await api('/topic-permissions' + root + '/' + user, 'PUT', topicPermissions(owner));
  }
}
export async function provision(options = {}) {
  const state = init(options);
  const identityMarker = resolve(options.stateDir ?? '/state', 'identity-ready.json');
  const markerBytes = json({ version: 1, publicOrigin: state.publicOrigin });
  if (existsSync(identityMarker)) ensure(readFileSync(identityMarker, 'utf8') === markerBytes, 'IDENTITY_MARKER_DRIFT');
  for (const [stage, action] of [
    ['DATABASES', () => provisionDatabases(state)],
    ['IDENTITY', async () => {
      await provisionIdentity(state, options.configDir ?? '/config', existsSync(identityMarker));
      preserve(identityMarker, markerBytes);
    }],
    ['BROKER', () => provisionRabbit(state)],
  ]) {
    try { await action(); console.log('PASS bootstrap stage ' + stage); }
    catch (error) {
      // Constrained diagnostics only, never raw upstream messages or private values.
      const code = /^[A-Z0-9_]+$/.test(error.message ?? '') ? error.message : /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : /^[A-Za-z]+$/.test(error.name ?? '') ? error.name.toUpperCase() : 'UNKNOWN';
      const location = String(error.stack ?? '').match(/(?:identity|bootstrap)[.]mjs:[0-9]+:[0-9]+/)?.[0]?.replaceAll(':', '_').replaceAll('.', '_').toUpperCase();
      throw new Error(stage + '_' + code + (location ? '_' + location : ''), { cause: error });
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    ensure(['init', 'provision'].includes(process.argv[2]), 'USE_INIT_OR_PROVISION');
    if (process.argv[2] === 'init') init(); else await provision();
    console.log('PASS bootstrap ' + process.argv[2] + '; private values omitted');
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'BOOTSTRAP_FAILED';
    console.error('FAIL ' + code + '; private diagnostics omitted'); process.exitCode = 1;
  }
}
