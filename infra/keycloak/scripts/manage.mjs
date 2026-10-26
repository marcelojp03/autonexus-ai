import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = 'autonexus-keycloak-dev';
const base = 'http://127.0.0.1:8180';
const issuer = base + '/realms/autonexus';
const spec = JSON.parse(readFileSync(resolve(root, 'realm.json')));
const roles = spec.roles.realm.map(r => r.name);
const path = name => resolve(root, name);
const json = name => JSON.parse(readFileSync(path(name)));
const check = (ok, label) => { assert.ok(ok, label); console.log('PASS ' + label); };
function command(exe, args, input) {
  const r = spawnSync(exe, args, { cwd: root, encoding: 'utf8', input, timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('Command failed: ' + exe);
  return r.stdout.trim();
}
const compose = args => command('docker', ['compose', '--project-name', project, '--project-directory', root, '--env-file', path('.env'), '-f', path('compose.yaml'), ...args]);
const env = () => Object.fromEntries(readFileSync(path('.env'), 'utf8').trim().split(/\r?\n/).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
function ignored() {
  for (const name of ['.env', '.local/test-accounts.json']) command('git', ['check-ignore', '--quiet', path(name)]);
}
function init() {
  ignored();
  const ep = existsSync(path('.env')), ap = existsSync(path('.local/test-accounts.json'));
  if (ep || ap) {
    assert.ok(ep && ap, 'Partial initialization: preserve existing files and investigate manually');
    console.log('PASS Existing private files preserved; no regeneration'); return;
  }
  const secret = () => randomBytes(32).toString('base64url');
  const values = { IDP_PG_ADMIN_PASSWORD: secret(), IDP_DB_PASSWORD: secret(), KC_BOOTSTRAP_ADMIN_USERNAME: 'infra_' + randomBytes(8).toString('hex'), KC_BOOTSTRAP_ADMIN_PASSWORD: secret() };
  mkdirSync(path('.local'), { recursive: true });
  writeFileSync(path('.env'), Object.entries(values).map(([k,v]) => k + '=' + v).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  const accounts = [...roles, 'sin_rol', 'deshabilitado'].map(key => ({ key, username: 'fixture_' + randomBytes(10).toString('hex'), password: secret(), roles: key === 'sin_rol' ? [] : [key === 'deshabilitado' ? 'mecanico' : key], enabled: key !== 'deshabilitado' }));
  writeFileSync(path('.local/test-accounts.json'), JSON.stringify(accounts, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('PASS New IdP-only private files created and ignored');
}
function ownership(requireBoth = true) {
  const ids = command('docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project]).split(/\s+/).filter(Boolean);
  if (requireBoth) assert.equal(ids.length, 2, 'Expected exactly two owned containers');
  for (const id of ids) {
    const labels = JSON.parse(command('docker', ['inspect', '--format', '{{json .Config.Labels}}', id]));
    const normalize = s => s.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
    assert.equal(normalize(labels['com.docker.compose.project.working_dir']), normalize(root), 'Workspace ownership mismatch');
    assert.ok(['postgres', 'keycloak'].includes(labels['com.docker.compose.service']));
  }
  const volumeName = project + '_idp-postgres-data';
  const volumes = command('docker',['volume','ls','-q','--filter','name=^' + volumeName + '$']);
  if (requireBoth) assert.equal(volumes, volumeName);
  if (volumes) {
    const labels = JSON.parse(command('docker',['volume','inspect','--format','{{json .Labels}}',volumeName]));
    assert.equal(labels['com.docker.compose.project'],project);
    assert.equal(labels['com.docker.compose.volume'],'idp-postgres-data');
  }
}
async function request(url, options = {}, allowed = [200, 201, 204]) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!allowed.includes(r.status)) throw new Error('HTTP status ' + r.status + ' (response omitted)');
  return r;
}
async function admin() {
  const e = env();
  const response = await request(base + '/realms/master/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: e.KC_BOOTSTRAP_ADMIN_USERNAME, password: e.KC_BOOTSTRAP_ADMIN_PASSWORD }) });
  const token = (await response.json()).access_token;
  return async (suffix, method = 'GET', data, allowed) => {
    const r = await request(base + '/admin/realms' + suffix, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }, allowed);
    return r.status === 204 || r.status === 201 || r.status === 404 ? null : r.json();
  };
}
async function provision() {
  ownership();
  const api = await admin();
  const current = await api('/autonexus', 'GET', undefined, [200,404]);
  const { roles: unused, clients, ...realmSettings } = spec;
  if (!current) await api('', 'POST', realmSettings);
  else await api('/autonexus', 'PUT', realmSettings);
  for (const role of spec.roles.realm) {
    const r = await api('/autonexus/roles/' + role.name, 'GET', undefined, [200,404]);
    if (!r) await api('/autonexus/roles', 'POST', role);
    else assert.equal(r.composite, false, 'Unexpected composite role');
  }
  for (const client of spec.clients) {
    const found = await api('/autonexus/clients?clientId=' + encodeURIComponent(client.clientId));
    if (!found.length) await api('/autonexus/clients', 'POST', client);
    else {
      const id = found[0].id;
      const { protocolMappers, ...settings } = client;
      await api('/autonexus/clients/' + id, 'PUT', settings);
      const old = await api('/autonexus/clients/' + id + '/protocol-mappers/models');
      for (const mapper of protocolMappers ?? []) {
        const existing = old.find(m => m.name === mapper.name);
        await api('/autonexus/clients/' + id + '/protocol-mappers/models' + (existing ? '/' + existing.id : ''), existing ? 'PUT' : 'POST', existing ? { ...mapper, id: existing.id } : mapper);
      }
    }
  }
  const realm = await api('/autonexus');
  if (realm.defaultRole) {
    const defaults = await api('/autonexus/roles-by-id/' + realm.defaultRole.id + '/composites');
    if (defaults.length) await api('/autonexus/roles-by-id/' + realm.defaultRole.id + '/composites', 'DELETE', defaults);
  }
  for (const account of json('.local/test-accounts.json')) {
    const found = await api('/autonexus/users?exact=true&username=' + encodeURIComponent(account.username));
    if (!found.length) await api('/autonexus/users', 'POST', { username: account.username, firstName: 'Local', lastName: 'Fixture', email: account.username + '@example.invalid', enabled: account.enabled, emailVerified: true, requiredActions: [], credentials: [{ type: 'password', value: account.password, temporary: false }] });
    const user = found[0] ?? (await api('/autonexus/users?exact=true&username=' + encodeURIComponent(account.username)))[0];
    assert.ok(user);
    await api('/autonexus/users/' + user.id, 'PUT', { enabled: account.enabled, ...(!user.firstName ? {firstName:'Local'} : {}), ...(!user.lastName ? {lastName:'Fixture'} : {}), ...(!user.email ? {email:account.username + '@example.invalid',emailVerified:true} : {}) });
    const existing = await api('/autonexus/users/' + user.id + '/role-mappings/realm');
    assert.ok(existing.every(r => !roles.includes(r.name) || account.roles.includes(r.name)), 'Unexpected existing workshop role; refusing destructive reconciliation');
    for (const name of account.roles) if (!existing.some(r => r.name === name)) await api('/autonexus/users/' + user.id + '/role-mappings/realm', 'POST', [await api('/autonexus/roles/' + name)]);
  }
  console.log('PASS Realm, clients, roles and seven private fixtures provisioned; existing passwords unchanged');
}
async function verify() {
  ownership(); ignored();
  const d = await (await request(issuer + '/.well-known/openid-configuration')).json();
  check(d.issuer === issuer && d.code_challenge_methods_supported.includes('S256'), 'Canonical discovery and S256 support');
  const jwks = await (await request(d.jwks_uri)).json();
  check(jwks.keys.some(k => k.use === 'sig' && k.alg === 'RS256'), 'Real RS256 JWKS');
  const api = await admin(), realm = await api('/autonexus');
  for (const k of ['enabled','sslRequired','defaultSignatureAlgorithm','accessTokenLifespan','ssoSessionIdleTimeout','ssoSessionMaxLifespan','revokeRefreshToken','refreshTokenMaxReuse']) assert.deepEqual(realm[k], spec[k], k);
  check(true, 'Realm lifetime / refresh rotation settings');
  const identities = {};
  for (const expected of spec.clients) {
    const [c] = await api('/autonexus/clients?clientId=' + expected.clientId);
    for (const k of ['publicClient','standardFlowEnabled','implicitFlowEnabled','directAccessGrantsEnabled','serviceAccountsEnabled', ...(expected.bearerOnly ? ['bearerOnly'] : ['redirectUris','webOrigins'])]) assert.deepEqual(c[k], expected[k], expected.clientId + ' ' + k);
    for (const [k,v] of Object.entries(expected.attributes ?? {})) assert.equal(c.attributes[k], v);
    for (const m of expected.protocolMappers ?? []) {
      const actual = c.protocolMappers.find(p => p.name === m.name);
      assert.ok(actual);
      for (const [k,v] of Object.entries(m.config)) assert.equal(actual.config[k], v);
    }
    identities[expected.clientId] = c.id;
  }
  check(true, 'Five client contracts / exact origins / access-only API audience mappers / server PKCE');
  const scopes = await api('/autonexus/client-scopes');
  const roleScope = scopes.find(s => s.name === 'roles');
  assert.ok(roleScope);
  const roleMappers = await api('/autonexus/client-scopes/' + roleScope.id + '/protocol-mappers/models');
  assert.ok(roleMappers.some(m => m.protocolMapper === 'oidc-usermodel-realm-role-mapper' && m.config['claim.name'] === 'realm_access.roles' && m.config['access.token.claim'] === 'true'));
  for (const c of spec.clients.filter(c => c.publicClient)) {
    const defaults = await api('/autonexus/clients/' + identities[c.clientId] + '/default-client-scopes');
    assert.ok(defaults.some(s => s.id === roleScope.id));
  }
  check(true, 'Default realm_access.roles mapper on all public clients');
  const accounts = json('.local/test-accounts.json');
  assert.deepEqual(accounts.map(a => a.key), [...roles,'sin_rol','deshabilitado']);
  for (const a of accounts) {
    assert.equal(a.enabled, a.key !== 'deshabilitado');
    assert.deepEqual(a.roles, a.key === 'sin_rol' ? [] : [a.key === 'deshabilitado' ? 'mecanico' : a.key]);
    assert.ok(typeof a.username === 'string' && a.username.length > 10 && typeof a.password === 'string' && a.password.length >= 32);
  }
  for (const role of roles) assert.equal((await api('/autonexus/roles/' + role)).composite, false);
  for (const a of accounts) {
    const [u] = await api('/autonexus/users?exact=true&username=' + encodeURIComponent(a.username));
    assert.equal(u.enabled, a.enabled); assert.deepEqual(u.requiredActions, []);
    assert.ok(u.firstName && u.lastName && u.email && u.emailVerified);
    const assigned = (await api('/autonexus/users/' + u.id + '/role-mappings/realm')).filter(r => roles.includes(r.name)).map(r => r.name).sort();
    assert.deepEqual(assigned, [...a.roles].sort()); identities[a.key] = u.id;
  }
  check(true, 'Five non-composite workshop roles and seven private fixture states');
  for (const c of spec.clients.filter(c => c.publicClient)) {
    const query = new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUris[0],response_type:'code',scope:'openid'});
    const missing = await request(issuer + '/protocol/openid-connect/auth?' + query, {redirect:'manual'}, [302,400]);
    const location = missing.headers.get('location') ?? '';
    check(missing.status === 400 || location.includes('error='), c.clientId + ' rejects code flow without PKCE');
    query.set('code_challenge', 'a'.repeat(43)); query.set('code_challenge_method', 'plain');
    const plain = await request(issuer + '/protocol/openid-connect/auth?' + query, {redirect:'manual'}, [302,400]);
    check(plain.status === 400 || (plain.headers.get('location') ?? '').includes('error='), c.clientId + ' rejects plain PKCE');
  }
  const pg = compose(['ps','-q','postgres']);
  const result = command('docker', ['exec','-i',pg,'psql','-U','idp_database_admin','-d','autonexus_idp','-At'], "SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='autonexus_idp';\nSELECT datname,pg_get_userbyid(datdba) FROM pg_database WHERE datname='autonexus_idp';\n");
  check(result.includes('autonexus_idp|f|f|f') && result.includes('autonexus_idp|autonexus_idp'), 'Independent database owned by non-superuser app role');
  for (const service of ['postgres','keycloak']) {
    const id = compose(['ps','-q',service]);
    assert.equal(command('docker',['inspect','--format','{{.State.Health.Status}}',id]),'healthy');
    const ports=JSON.parse(command('docker',['inspect','--format','{{json .HostConfig.PortBindings}}',id]));
    assert.deepEqual(ports ?? {}, service === 'postgres' ? {} : {'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'8180'}]});
  }
  check(true, 'Both owned containers healthy; only HTTP loopback published, no PostgreSQL/management port');
  return identities;
}
async function wait() {
  for (let i=0;i<120;i++) {
    try {
      const id=compose(['ps','-q','keycloak']);
      if (command('docker',['inspect','--format','{{.State.Health.Status}}',id]) === 'healthy') return;
    } catch {}
    await new Promise(r => setTimeout(r,1000));
  }
  throw new Error('IdP readiness timeout');
}
async function main(action) {
  if (action === 'init') return init();
  if (action === 'up') { ownership(false); compose(['up','-d','--wait','--wait-timeout','300']); console.log('PASS Owned stack started'); return; }
  if (action === 'provision') return provision();
  if (action === 'verify') return verify();
  if (action === 'verify-idempotency') {
    const before = await verify();
    const e=readFileSync(path('.env')), a=readFileSync(path('.local/test-accounts.json'));
    init(); await provision();
    assert.ok(e.equals(readFileSync(path('.env'))) && a.equals(readFileSync(path('.local/test-accounts.json'))));
    assert.deepEqual(await verify(), before);
    console.log('PASS Repeated init/provision preserve private bytes and all user/client IDs; no password-reset path for reused accounts'); return;
  }
  if (action === 'verify-persistence') {
    const before = await verify(); ownership();
    compose(['restart','keycloak']); await wait();
    const after = await verify(); assert.deepEqual(after,before);
    console.log('PASS User/client IDs persisted across owned Keycloak restart'); return;
  }
  if (action === 'bootstrap') { await main('up'); await main('provision'); return main('verify'); }
  throw new Error('Allowed actions: init, up, provision, verify, verify-idempotency, verify-persistence, bootstrap');
}
const [action, flag] = process.argv.slice(2);
if (flag === '--background') {
  ignored(); mkdirSync(path('.local'), {recursive:true});
  assert.ok(['init','up','provision','verify','verify-idempotency','verify-persistence','bootstrap'].includes(action));
  writeFileSync(path('.local/' + action + '.result.json'),JSON.stringify({action,status:'RUNNING',at:new Date().toISOString()}));
  const log = openSync(path('.local/' + action + '.log'), 'w', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url),action,'--worker'], {cwd:root,detached:true,stdio:['ignore',log,log],windowsHide:true});
  closeSync(log);
  child.unref(); console.log('Started isolated worker PID ' + child.pid + '; poll .local/' + action + '.result.json');
} else {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await main(action);
    if (flag === '--worker') {
      console.log('EXIT=0');
      writeFileSync(path('.local/' + action + '.result.json'),JSON.stringify({action,status:'PASS',exitCode:0,at:new Date().toISOString()}));
    }
  } catch (error) {
    console.error('FAIL ' + action + ' (' + error.name + '; ' + (error.message.startsWith('HTTP status') || error.message.startsWith('Command failed') ? error.message : 'sensitive diagnostics suppressed') + ')');
    if (flag === '--worker') {
      console.log('EXIT=1');
      writeFileSync(path('.local/' + action + '.result.json'),JSON.stringify({action,status:'FAIL',exitCode:1,at:new Date().toISOString()}));
    }
    process.exitCode=1;
  }
  finally { clearInterval(keepAlive); }
}
