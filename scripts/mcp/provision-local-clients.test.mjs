import test from 'node:test';
import assert from 'node:assert/strict';
import { assertContainer, assertSubset } from './local-admin.mjs';
import { mainRepositoryRoot } from './local-admin.mjs';
import { resolve } from 'node:path';
import { preflightReadRoles } from './provision-local-clients.mjs';
import { definitions, newPlan, validatePlan, assertBaseline, assertOwnedClient, reconcileRoles, preflightClients, compareMappers, MCP_SCOPES, API_AUDIENCES, RESOURCE, PATHS, ROLES, main } from './provision-local-clients.mjs';

const origin = 'http://127.0.0.1:4286';
const plan = newPlan(origin);
test('linked-worktree common git directory resolves the canonical runtime root', () => {
  const root = process.cwd();
  const separator = root.includes('\\') ? '\\' : '/';
  assert.equal(mainRepositoryRoot(root + separator + '.git'), root);
  assert.throws(() => mainRepositoryRoot(root + separator + '.git' + separator + 'worktrees' + separator + 'work-marcelo'), /COMMON_GIT_DIRECTORY_INVALID/);
});
test('Keycloak-only role collision is rejected before owner role mutations', () => {
  assert.throws(() => preflightReadRoles(path => ({name:path.split('/').at(-1),description:'foreign',composite:false,clientRole:false}),plan), /IDP_ROLE_UNOWNED_OR_DRIFT/);
  preflightReadRoles(() => {throw new Error('IDP_HTTP_404');},plan);
  preflightReadRoles(path => ({name:path.split('/').at(-1),description:plan.ownerMarker,composite:false,clientRole:false}),plan);
});
test('persistent intents and random private ownership without passwords', () => {
  validatePlan(plan, origin);
  assert.equal(new Set(Object.values(plan.intents).flatMap(Object.values)).size, 4);
  assert.notEqual(newPlan(origin).ownerMarker, plan.ownerMarker);
  assert.doesNotMatch(JSON.stringify(plan), /password|clientSecret/);
  assert.throws(() => validatePlan(plan, 'other'), /PLAN_DRIFT/);
  assert.throws(() => validatePlan({ ...plan, intents: {} }, origin), /INTENT_DRIFT/);
});
test('exchange client is confidential and pure standard exchange', () => {
  const server = definitions(plan.ownerMarker)[0];
  for (const key of ['publicClient', 'bearerOnly', 'standardFlowEnabled', 'implicitFlowEnabled', 'directAccessGrantsEnabled', 'serviceAccountsEnabled', 'fullScopeAllowed']) assert.equal(server[key], false);
  assert.equal(server.attributes['standard.token.exchange.enabled'], 'true');
  assert.ok(!Object.keys(server.attributes).some(k => k.includes('refresh')));
  assert.deepEqual(server.protocolMappers.filter(m => m.protocolMapper === 'oidc-audience-mapper').map(m => m.config['included.client.audience']), API_AUDIENCES);
});
test('external public reader exact incoming audience pair and PKCE', () => {
  const client = definitions(plan.ownerMarker)[1];
  assert.equal(client.publicClient, true);
  assert.equal(client.attributes['pkce.code.challenge.method'], 'S256');
  assert.deepEqual(client.redirectUris, ['http://127.0.0.1:4390/auth/callback']);
  const aud = client.protocolMappers.filter(m => m.protocolMapper === 'oidc-audience-mapper').map(m => m.config['included.client.audience'] ?? m.config['included.custom.audience']);
  assert.deepEqual(aud, [RESOURCE, 'autonexus-mcp-server']);
});
test('n8n confidential PKCE with separate secret output and API audiences', () => {
  const client = definitions(plan.ownerMarker)[2];
  assert.equal(client.publicClient, false);
  assert.equal(client.standardFlowEnabled, true);
  assert.equal(client.attributes['pkce.code.challenge.method'], 'S256');
  assert.equal(client.attributes['standard.token.exchange.enabled'], undefined);
  assert.notEqual(PATHS.secret, PATHS.n8nSecret);
  assert.deepEqual(client.redirectUris, ['http://127.0.0.1:5678/rest/oauth2-credential/callback']);
  assert.deepEqual(client.protocolMappers.filter(m => m.protocolMapper === 'oidc-audience-mapper').map(m => m.config['included.client.audience']), API_AUDIENCES);
});
test('all clients limited lifetime, scopes, realm role mapper, no implicit/M2M', () => {
  for (const client of definitions(plan.ownerMarker)) {
    assert.equal(client.attributes['access.token.lifespan'], '60');
    const expectedDefaults = client.clientId === 'autonexus-mcp-local-reader' ? ['basic', 'mcp'] : client.clientId === 'autonexus-n8n-reader' ? ['basic', 'n8n:api:read'] : ['basic'];
    assert.deepEqual(client.defaultClientScopes, expectedDefaults);
    assert.deepEqual(client.optionalClientScopes, []);
    assert.equal(client.protocolMappers.at(-1).protocolMapper, 'oidc-usermodel-realm-role-mapper');
    assert.equal(client.protocolMappers.at(-1).config['claim.name'], 'realm_access.roles');
    for (const key of ['fullScopeAllowed', 'implicitFlowEnabled', 'directAccessGrantsEnabled', 'serviceAccountsEnabled']) assert.equal(client[key], false);
  }
});
test('mapper comparison accepts Keycloak userinfo default and rejects unknown config or identity drift', () => {
  const expected = definitions(plan.ownerMarker)[0].protocolMappers;
  const keycloak = structuredClone(expected).map(m => ({ ...m, config: { ...m.config, 'userinfo.token.claim': 'true' } }));
  compareMappers(keycloak, expected);
  for (const change of [list => { list[0].config['userinfo.token.claim'] = 'maybe'; },
    list => { list[0].config['included.client.audience'] = 'autonexus-intelligence-api'; },
    list => { list[0].config['userinfo.address'] = 'true'; },
    list => { list[0].protocolMapper = 'oidc-hardcoded-claim-mapper'; },
    list => { list.push({ name: 'extra', protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config: {} }); },
    list => { list.splice(0, 1); }]) {
    const copy = structuredClone(keycloak); change(copy);
    assert.throws(() => compareMappers(copy, expected));
  }
});test('reject ownership, config, mapper and refresh drift', () => {
  const expected = definitions(plan.ownerMarker)[0];
  assertOwnedClient(structuredClone(expected), expected);
  for (const change of [c => { c.attributes['mcp.fixture.owner'] = 'other'; }, c => { c.fullScopeAllowed = true; }, c => { c.protocolMappers.push({ name: 'evil', config: {} }); }, c => { c.attributes['use.refresh.tokens'] = 'true'; }]) {
    const actual = structuredClone(expected); change(actual);
    assert.throws(() => assertOwnedClient(actual, expected));
  }
});
test('active current identity and already effective read permission required', () => {
  const account = { employeeId: 'one', subject: 'subject' };
  const employee = { id: 'one', status: 'active', access: { status: 'synced', subject: 'subject' } };
  assertBaseline(employee, account, ROLES[0].permissions, ROLES[0].permissions);
  assert.throws(() => assertBaseline(employee, { ...account, enabled: false }, ROLES[0].permissions, ROLES[0].permissions), /ACCOUNT_DISABLED_IN_FIXTURE/);
  assert.throws(() => assertBaseline(employee, account, [], ROLES[0].permissions), /USER_AUTHORITY_EXPANSION/);
  assert.throws(() => assertBaseline({ ...employee, status: 'inactive' }, account, ROLES[0].permissions, ROLES[0].permissions), /EMPLOYEE_IDENTITY_DRIFT/);
  assert.throws(() => assertBaseline(employee, { ...account, subject: 'different' }, ROLES[0].permissions, ROLES[0].permissions), /EMPLOYEE_IDENTITY_DRIFT/);
});
test('read-only role reconciliation never writes missing mapping', () => {
  const calls = [];
  assert.throws(() => reconcileRoles((path, method = 'GET') => { calls.push(method); return {}; }, '/clients/id', [{ id: 'read' }], false), /READ_ROLE_SCOPE_MISSING/);
  assert.deepEqual(calls, ['GET']);
});
test('no initial or client role scope mappings accepted or removed', () => {
  for (const mapping of [{ realmMappings: [{ id: 'admin' }] }, { clientMappings: { account: {} } }]) {
    const calls = [];
    assert.throws(() => reconcileRoles((path, method = 'GET') => { calls.push(method); return mapping; }, '/clients/id', [{ id: 'read' }], true));
    assert.deepEqual(calls, ['GET']);
  }
});
test('only add explicitly allowed missing read roles, existing is idempotent', () => {
  const allowed = [{ id: 'read', name: 'mcp_read_self' }];
  const calls = [];
  reconcileRoles((path, method = 'GET', body) => { calls.push({ method, body }); return {}; }, '/clients/id', allowed, true);
  assert.deepEqual(calls.at(-1), { method: 'POST', body: allowed });
  reconcileRoles(() => ({ realmMappings: allowed }), '/clients/id', allowed, false);
});
test('container project/service/workdir exact ownership guards', () => {
  const root = process.cwd();
  const labels = { 'com.docker.compose.project': 'cu16-proof', 'com.docker.compose.service': 'employees', 'com.docker.compose.project.working_dir': root };
  assertContainer(labels, 'employees', root);
  assert.throws(() => assertContainer({ ...labels, 'com.docker.compose.project': 'other' }, 'employees', root), /CONTAINER_OWNERSHIP/);
  assert.throws(() => assertContainer({ ...labels, 'com.docker.compose.project.working_dir': root + '/other' }, 'employees', root), /CONTAINER_WORKDIR/);
  assert.throws(() => assertSubset({ enabled: true }, { enabled: false }), /CONFIG_DRIFT/);
});
test('existing linked fixture source is admitted only explicitly and within the same exact root', () => {
  const root = process.cwd(); const source = resolve(root, '.worktrees/work-marcelo');
  const labels = {'com.docker.compose.project':'cu16-proof','com.docker.compose.service':'employees','com.docker.compose.project.working_dir':source};
  assert.throws(() => assertContainer(labels,'employees',root),/CONTAINER_WORKDIR/);
  assertContainer(labels,'employees',root,source);
  assert.throws(() => assertContainer({...labels,'com.docker.compose.project.working_dir':undefined},'employees',root,source),/CONTAINER_WORKDIR/);
  assert.throws(() => assertContainer({...labels,'com.docker.compose.project.working_dir':'.'},'employees',root,source),/CONTAINER_WORKDIR/);
  assert.throws(() => assertContainer(labels,'employees',root,resolve(root,'other')),/LINKED_FIXTURE_SOURCE_INVALID/);
  assert.throws(() => assertContainer({...labels,'com.docker.compose.project.working_dir':resolve(root,'.worktrees/other')},'employees',root,source),/CONTAINER_WORKDIR/);
});
test('unowned client preflight fails before owner writes', () => {
  const client = definitions('unowned')[0];
  assert.throws(() => preflightClients(path => path.startsWith('/clients?') ? [{ id: 'bad' }] : client, plan), /CLIENT_UNOWNED/);
  assert.equal(MCP_SCOPES.length, 6);
});
test('invalid CLI rejected before external operations', async () => {
  await assert.rejects(main(['--apply', '--verify']), /USE_PLAN_APPLY_VERIFY/);
  await assert.rejects(main(['--reset']), /USE_PLAN_APPLY_VERIFY/);
});
