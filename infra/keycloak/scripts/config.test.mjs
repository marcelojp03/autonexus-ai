import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const realm = JSON.parse(read('realm.json'));
test('public seed has only approved workshop roles, no users or credentials', () => {
  assert.deepEqual(realm.roles.realm.map(r => r.name), ['administrador','recepcionista','mecanico','jefe_taller','responsable_financiero']);
  assert.ok(realm.roles.realm.every(r => r.composite === false));
  assert.equal(realm.users, undefined);
  assert.ok(!/"(password|secret|credentials)"/.test(JSON.stringify(realm)));
});
test('exact clients and access-only audience claims', () => {
  assert.equal(realm.clients.length,5);
  for (const [i,c] of realm.clients.slice(0,3).entries()) {
    const origin = 'http://127.0.0.1:' + (4200+i);
    assert.deepEqual(c.redirectUris,[origin+'/auth/callback']);
    assert.deepEqual(c.webOrigins,[origin]);
    assert.equal(c.attributes['post.logout.redirect.uris'],origin+'/');
    assert.equal(c.attributes['pkce.code.challenge.method'],'S256');
    assert.equal(c.publicClient,true); assert.equal(c.standardFlowEnabled,true);
    for (const key of ['implicitFlowEnabled','directAccessGrantsEnabled','serviceAccountsEnabled']) assert.equal(c[key],false);
    assert.deepEqual(c.protocolMappers.map(m=>m.config['included.client.audience']),['autonexus-operations-api','autonexus-employees-api']);
    for (const m of c.protocolMappers) { assert.equal(m.config['access.token.claim'],'true'); assert.equal(m.config['id.token.claim'],'false'); }
  }
  assert.ok(realm.clients.slice(3).every(c => c.bearerOnly && !c.standardFlowEnabled));
});
test('bounded local session and rotating refresh tokens', () => {
  assert.equal(realm.accessTokenLifespan,60);
  assert.equal(realm.ssoSessionIdleTimeout,900); assert.equal(realm.ssoSessionMaxLifespan,3600);
  assert.equal(realm.revokeRefreshToken,true); assert.equal(realm.refreshTokenMaxReuse,0);
});
test('compose is isolated and does not publish PostgreSQL or management', () => {
  const c=read('compose.yaml');
  assert.match(c,/name: autonexus-keycloak-dev/);
  assert.match(c,/image: quay.io\/keycloak\/keycloak:26\.8\.1/);
  assert.match(c,/image: postgres:17\.11-bookworm/);
  assert.equal((c.match(/ports:/g)||[]).length,1);
  assert.match(c,/127\.0\.0\.1:8180:8080/);
  assert.doesNotMatch(c,/55432|operations|employees|external:|container_name:/);
  assert.match(read('postgres-init.sh'),/NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.doesNotMatch(read('postgres-init.sh'),/--set=.*PASSWORD/);
});
test('private paths ignored before credentials can be generated', () => {
  for (const p of ['.env','.local/test-accounts.json']) {
    const r=spawnSync('git',['check-ignore','--quiet',p],{cwd:root});
    assert.equal(r.status,0);
  }
});
test('generated credentials are absent from public files and sanitized worker artifacts', t => {
  if (!existsSync(new URL('../.env', import.meta.url))) return t.skip('Run init to check private values in memory');
  const values = read('.env').trim().split(/\r?\n/).map(line => line.slice(line.indexOf('=') + 1));
  const accounts = JSON.parse(read('.local/test-accounts.json'));
  values.push(...accounts.flatMap(a => [a.username,a.password]));
  const publicFiles = ['.gitignore','.env.example','compose.yaml','postgres-init.sh','realm.json','README.md','scripts/manage.mjs','scripts/config.test.mjs'];
  const artifacts = readdirSync(new URL('../.local/',import.meta.url)).filter(n => /\.(log|result\.json)$/.test(n)).map(n => '.local/' + n);
  assert.ok(values.every(v => v.length >= 16));
  for (const f of [...publicFiles,...artifacts]) assert.ok(!values.some(v => read(f).includes(v)), 'Private value leaked to a public file or worker artifact');
});
