import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { init, consumers, configuration, shellEnv, origin, retry, preserve } from './bootstrap.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'autonexus-bootstrap-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { stateDir: join(root, 'state'), configDir: join(root, 'config'), publicOrigin: 'http://127.0.0.1:18420' };
}
const bytes = path => readFileSync(path, 'utf8');
test('repeat init preserves state, credentials and every consumer byte', t => {
  const options = fixture(t), state = init(options);
  const statePath = join(options.stateDir, 'bootstrap.json'), before = bytes(statePath);
  const envs = consumers.map(owner => bytes(join(options.configDir, owner, 'service.env')));
  const account = bytes(join(options.configDir, 'demo/admin-account.json'));
  const demoClient = bytes(join(options.configDir, 'demo/employees-client.json'));
  assert.deepEqual(JSON.parse(demoClient), { clientId: 'autonexus-employees-admin', clientSecret: state.secrets.employeesClient });
  assert.deepEqual(init(options), state);
  assert.equal(bytes(statePath), before);
  assert.deepEqual(consumers.map(owner => bytes(join(options.configDir, owner, 'service.env'))), envs);
  assert.equal(bytes(join(options.configDir, 'demo/admin-account.json')), account);
  assert.equal(bytes(join(options.configDir, 'demo/employees-client.json')), demoClient);
  for (const owner of ['public', 'bff', 'operations', 'finance']) assert.equal(existsSync(join(options.configDir, owner, 'employees-client.json')), false);
  for (const [key, value] of Object.entries(state.secrets)) if (key !== 'appKey') assert.match(value, /^[a-f0-9]{64}$/);
  assert.equal(Buffer.from(state.secrets.appKey.slice(7), 'base64').length, 32);
});
test('lost canonical state fails closed and preserves existing config', t => {
  const options = fixture(t); init(options);
  const env = bytes(join(options.configDir, 'employees/service.env'));
  rmSync(join(options.stateDir, 'bootstrap.json'));
  assert.throws(() => init(options), /STATE_MISSING_CONFIG_EXISTS/);
  assert.equal(bytes(join(options.configDir, 'employees/service.env')), env);
  assert.equal(existsSync(join(options.stateDir, 'bootstrap.json')), false);
});
test('missing consumer config is recovered only from existing state', t => {
  const options = fixture(t); const state = init(options);
  const path = join(options.configDir, 'employees/service.env'), before = bytes(path);
  chmodSync(path, 0o600); rmSync(path);
  assert.deepEqual(init(options), state); assert.equal(bytes(path), before);
});
test('drift and changed public origin fail without replacing credentials', t => {
  const options = fixture(t); init(options);
  const state = bytes(join(options.stateDir, 'bootstrap.json'));
  assert.throws(() => init({ ...options, publicOrigin: 'http://localhost:18420' }), /PUBLIC_ORIGIN_DRIFT/);
  const path = join(options.configDir, 'employees/service.env'); chmodSync(path, 0o600); writeFileSync(path, 'CHANGED=1\n');
  assert.throws(() => init(options), /CONFIG_DRIFT/);
  assert.equal(bytes(path), 'CHANGED=1\n'); assert.equal(bytes(join(options.stateDir, 'bootstrap.json')), state);
});
test('public origin accepts canonical HTTPS or loopback HTTP only', () => {
  for (const value of ['http://127.0.0.1:18420', 'http://localhost:18420', 'http://[::1]:18420', 'https://workshop.example']) assert.equal(origin(value), value);
  for (const value of [undefined, '', 'http://remote.example', 'https://host/', 'https://host/path', 'https://host?x=1', 'https://user:pass@host', 'https://host#hash', 'https://host:443', 'file:///tmp/test', ' https://host']) assert.throws(() => origin(value), /PUBLIC_ORIGIN_INVALID/);
});
test('public and BFF receive no secrets; services receive only owner credentials', t => {
  const options = fixture(t), state = init(options), configs = configuration(state);
  const secrets = [...Object.values(state.secrets), state.admin.password];
  for (const owner of ['public', 'bff']) for (const secret of secrets) assert.equal(JSON.stringify(configs[owner]).includes(secret), false);
  for (const owner of ['employees', 'operations', 'finance']) {
    const env = JSON.stringify(configs[owner]);
    assert.ok(env.includes(state.secrets[owner + 'Db'])); assert.ok(env.includes(state.secrets[owner + 'Rabbit']));
    for (const other of ['employees', 'operations', 'finance'].filter(value => value !== owner)) { assert.equal(env.includes(state.secrets[other + 'Db']), false); assert.equal(env.includes(state.secrets[other + 'Rabbit']), false); }
    for (const key of ['postgres', 'idpAdmin', 'idpPostgres', 'keycloak', 'rabbitmq']) assert.equal(env.includes(state.secrets[key]), false);
    const broker = JSON.parse(bytes(join(options.configDir, owner, 'broker-client.json')));
    assert.deepEqual(broker, { host: 'rabbitmq', port: 5672, vhost: 'autonexus', username: 'autonexus_' + owner, password: state.secrets[owner + 'Rabbit'] });
  }
});
test('runtime JavaScript contains precisely the agreed public shape', t => {
  const options = fixture(t), state = init(options), context = {};
  const source = bytes(join(options.configDir, 'public/runtime-config.js'));
  runInNewContext(source, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.__AUTONEXUS_CONFIG__)), { version: 1, oidcUrl: options.publicOrigin + '/identity', graphqlUrl: options.publicOrigin + '/graphql', technicalUrls: { employees: options.publicOrigin + '/technical/employees', operations: options.publicOrigin + '/technical/operations' } });
  for (const secret of [...Object.values(state.secrets), state.admin.password]) assert.equal(source.includes(secret), false);
});
test('Compose init and runtime keys match actual owner adapters', t => {
  const options = fixture(t), state = init(options), configs = configuration(state);
  assert.equal(configs['idp-postgres'].POSTGRES_USER, 'idp_database_admin');
  assert.equal(configs['idp-postgres'].IDP_DB_PASSWORD, configs.keycloak.KC_DB_PASSWORD);
  assert.notEqual(configs['idp-postgres'].POSTGRES_PASSWORD, configs.keycloak.KC_DB_PASSWORD);
  for (const owner of ['employees', 'operations', 'finance']) {
    assert.equal(configs.postgres[owner.toUpperCase() + '_PASSWORD'], configs[owner].DB_PASSWORD);
    assert.equal(configs.postgres[owner.toUpperCase() + '_USER'], configs[owner].DB_USER);
    assert.equal(configs.postgres[owner.toUpperCase() + '_DB'], configs[owner].DB_NAME);
    assert.equal(configs[owner].CU15_BROKER_CLIENT_FILE, '/run/config/broker-client.json');
    assert.equal(configs[owner].OIDC_ISSUER_URI, options.publicOrigin + '/identity/realms/autonexus');
    assert.equal(configs[owner].OIDC_JWKS_URI, 'http://keycloak:8080/identity/realms/autonexus/protocol/openid-connect/certs');
  }
  assert.equal(configs.employees.EMPLOYEES_IDP_CLIENT_FILE, '/run/config/employees-client.json');
  assert.equal(configs.operations.CU15_IDP_CLIENT_FILE, '/run/config/cu15-coordinator-client.json');
  assert.equal(configs.employees.OIDC_ADMIN_BASE_URL, 'http://keycloak:8080/identity');
  assert.equal(configs.operations.EMPLOYEES_API_URL, 'http://employees:3002');
  assert.equal(configs.operations.FINANCE_API_URL, 'http://finance:8000');
  for (const owner of ['employees', 'operations', 'bff']) assert.equal(configs[owner].HTTP_HOST, '0.0.0.0');
});
test('shell values are single-quoted and reject line or key injection', () => {
  assert.equal(shellEnv({ VALUE: "a'b $HOME $(id); \\" }), "VALUE='a'\\''b $HOME $(id); \\'\n");
  assert.equal(shellEnv({ APP_KEY: 'base64:abcd+/=' }), "APP_KEY='base64:abcd+/='\n");
  for (const value of ['x\ny', 'x\ry', 'x\0y']) assert.throws(() => shellEnv({ VALUE: value }), /ENV_INVALID/);
  assert.throws(() => shellEnv({ 'A;id': 'value' }), /ENV_INVALID/);
});
test('private state and runtime file modes are separated on POSIX', { skip: process.platform === 'win32' }, t => {
  const options = fixture(t); init(options);
  assert.equal(statSync(join(options.stateDir, 'bootstrap.json')).mode & 0o777, 0o600);
  for (const consumer of consumers) { assert.equal(statSync(join(options.configDir, consumer)).mode & 0o777, 0o755); assert.equal(statSync(join(options.configDir, consumer, 'service.env')).mode & 0o777, 0o444); }
});
test('preserve never replaces an existing technical credential', t => {
  const options = fixture(t), path = join(options.configDir, 'employees/employees-client.json');
  preserve(path, 'original'); preserve(path, 'original');
  assert.throws(() => preserve(path, 'replacement'), /CONFIG_DRIFT/); assert.equal(bytes(path), 'original');
});
test('readiness succeeds only on a successful probe and has bounded failures', async () => {
  let attempts = 0;
  assert.equal(await retry(async () => { if (++attempts < 3) throw new Error('not ready'); return 'ready'; }, 3, 0), 'ready');
  assert.equal(attempts, 3); attempts = 0;
  await assert.rejects(retry(async () => { attempts++; throw new Error('not ready'); }, 2, 0), /READINESS_EXHAUSTED/);
  assert.equal(attempts, 2);
});
