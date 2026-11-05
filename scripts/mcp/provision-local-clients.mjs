import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ensure, normalized, assertSubset, internal, withLocalAdmin, mainRepositoryRoot } from './local-admin.mjs';

export const MCP_SCOPES = ['mcp', 'mcp:orders:read', 'mcp:agenda:read:self', 'mcp:agenda:read:team', 'mcp:executions:read:self', 'mcp:executions:read:team'];
export const API_AUDIENCES = ['autonexus-operations-api', 'autonexus-employees-api'];
export const RESOURCE = 'http://127.0.0.1:3006/mcp';
export const PATHS = {
  plan: 'output/mcp-read/fixture/client-plan.private.json', secret: 'output/mcp-read/fixture/idp-client.private.json',
  registry: 'output/mcp-read/fixture/clients.private.json', summary: 'output/mcp-read/client-provision.json',
  n8nSecret: 'output/mcp-read/fixture/n8n-client.private.json',
};
export const ROLES = [
  { name: 'mcp_read_self', account: 'mechanicA', permissions: ['agenda:read:self', 'executions:read:self'] },
  { name: 'mcp_read_team', account: 'chief', permissions: ['orders:read', 'agenda:read:team', 'executions:read:team'] },
];
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const bytes = value => JSON.stringify(value, null, 2) + String.fromCharCode(10);
function privateWrite(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, bytes(value), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}
export function stableWrite(path, value) {
  if (existsSync(path)) ensure(readFileSync(path, 'utf8') === bytes(value), 'PRIVATE_FILE_DRIFT');
  else writeFileSync(path, bytes(value), { flag: 'wx', mode: 0o600 });
}
const audience = (value, custom = false) => ({ name: value, protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config: {
  [custom ? 'included.custom.audience' : 'included.client.audience']: value, 'access.token.claim': 'true', 'id.token.claim': 'false', 'introspection.token.claim': 'true',
} });
const roleMapper = { name: 'read-realm-roles', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-realm-role-mapper', config: {
  'claim.name': 'realm_access.roles', 'jsonType.label': 'String', multivalued: 'true', 'access.token.claim': 'true', 'id.token.claim': 'false', 'introspection.token.claim': 'true',
} };

export function definitions(marker) {
  const client = (clientId, redirect, audiences) => ({ clientId, enabled: true, protocol: 'openid-connect', publicClient: clientId === 'autonexus-mcp-local-reader',
    bearerOnly: false, standardFlowEnabled: !!redirect, implicitFlowEnabled: false, directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false, fullScopeAllowed: false, consentRequired: false,
    redirectUris: redirect ? [redirect] : [], webOrigins: [],
    attributes: { 'mcp.fixture.owner': marker, 'access.token.lifespan': '60', ...(redirect ? { 'pkce.code.challenge.method': 'S256' } : { 'standard.token.exchange.enabled': 'true' }) },
    defaultClientScopes: clientId === 'autonexus-mcp-local-reader' ? ['basic', 'mcp'] : clientId === 'autonexus-n8n-reader' ? ['basic', 'n8n:api:read'] : ['basic'], optionalClientScopes: [], protocolMappers: [...audiences, roleMapper],
  });
  return [client('autonexus-mcp-server', null, API_AUDIENCES.map(x => audience(x))),
    client('autonexus-mcp-local-reader', 'http://127.0.0.1:4390/auth/callback', [audience(RESOURCE, true), audience('autonexus-mcp-server')]),
    client('autonexus-n8n-reader', 'http://127.0.0.1:5678/rest/oauth2-credential/callback', API_AUDIENCES.map(x => audience(x)))];
}
export function newPlan(origin) {
  return { version: 1, origin, ownerMarker: 'MCP-' + randomBytes(16).toString('hex'), intents: Object.fromEntries(ROLES.map(r => [r.name, { create: randomUUID(), assign: randomUUID() }])), initialized: {}, complete: false };
}
export function validatePlan(plan, origin) {
  ensure(plan.version === 1 && plan.origin === origin && /^MCP-[a-f0-9]{32}$/.test(plan.ownerMarker), 'PLAN_DRIFT');
  ensure(ROLES.every(r => ['create', 'assign'].every(k => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(plan.intents?.[r.name]?.[k]))), 'INTENT_DRIFT');
}
export function assertBaseline(employee, account, effective, permissions) {
  ensure(account.enabled !== false, 'ACCOUNT_DISABLED_IN_FIXTURE');
  ensure(employee.id === account.employeeId && employee.status === 'active' && employee.access?.status === 'synced' && employee.access.subject === account.subject, 'EMPLOYEE_IDENTITY_DRIFT');
  ensure(permissions.length > 0 && permissions.every(p => effective.includes(p)), 'USER_AUTHORITY_EXPANSION');
}
/** Keycloak adds `userinfo.token.claim` to its built-in mappers; nothing else may appear. */
const MAPPER_EXTRA_CONFIG = new Set(['userinfo.token.claim']);
export function compareMappers(actual, expected) {
  ensure(actual.length === expected.length, 'MAPPER_DRIFT');
  for (const wanted of expected) {
    const matches = actual.filter(m => m.name === wanted.name);
    ensure(matches.length === 1, 'MAPPER_DRIFT');
    const found = matches[0];
    ensure(found.protocol === wanted.protocol && found.protocolMapper === wanted.protocolMapper, 'MAPPER_DRIFT');
    const config = found.config ?? {};
    assertSubset(config, wanted.config, 'MAPPER_CONFIG_DRIFT');
    const extras = Object.keys(config).filter(key => !Object.hasOwn(wanted.config, key));
    ensure(extras.every(key => MAPPER_EXTRA_CONFIG.has(key) && ['true', 'false'].includes(String(config[key]))), 'MAPPER_CONFIG_DRIFT');
  }
}
export function assertOwnedClient(actual, definition) {
  ensure(actual.attributes?.['mcp.fixture.owner'] === definition.attributes['mcp.fixture.owner'], 'CLIENT_UNOWNED');
  const { attributes, protocolMappers, defaultClientScopes, optionalClientScopes, ...policy } = definition;
  assertSubset(actual, policy);
  assertSubset(actual.attributes, attributes);
  ensure(!Object.keys(actual.attributes).some(k => k.includes('refresh') || k.includes('exchange') && k !== 'standard.token.exchange.enabled'), 'UNAPPROVED_CLIENT_ATTRIBUTE');
  compareMappers(actual.protocolMappers ?? [], protocolMappers);
}

async function ownerRoles(plan, apply) {
  const { authorize } = await import('../../services/employees/scripts/local-pkce.mjs');
  const accounts = read('output/stack/cu16-proof.accounts.private.json').accounts;
  const fixture = read('output/cu27/fixture/admin-test.private.json');
  ensure(fixture.origin === plan.origin, 'ADMIN_ORIGIN_DRIFT');
  const issuer = plan.origin + '/identity/realms/autonexus';
  const config = { issuer, redirect: plan.origin + '/auth/callback' };
  const admin = (await authorize(fixture.accounts.adminTest, false, config)).access_token;
  const api = (path, token = admin, method = 'GET', body) => {
    ensure(apply || method === 'GET', 'READ_ONLY_OWNER');
    const response = internal('http://employees:3002' + path, { token, method, body });
    ensure([200, 201].includes(response.status), 'OWNER_HTTP_' + response.status);
    return response.data;
  };
  const catalog = api('/security/permissions');
  ensure(catalog.effective.includes('security:write'), 'SETUP_AUTHORITY_MISSING');
  const checks = [];
  for (const role of ROLES) {
    const account = accounts[role.account];
    ensure(account && /^[0-9a-f-]{36}$/.test(account.employeeId) && account.subject, 'ACCOUNT_MAPPING_MISSING');
    ensure(account.enabled !== false, 'ACCOUNT_DISABLED_IN_FIXTURE');
    const token = (await authorize({ ...account, enabled: true }, false, config)).access_token;
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    ensure(claims.sub === account.subject && claims.iss === issuer, 'ACCOUNT_CLAIMS_DRIFT');
    const effective = api('/security/permissions', token).effective;
    assertBaseline(api('/employees/' + account.employeeId), account, effective, role.permissions);
    ensure(role.permissions.every(p => catalog.catalog.some(c => c.id === p)), 'PERMISSION_CATALOG_DRIFT');
    checks.push({ role, account });
  }
  const roles = api('/security/roles');
  for (const role of ROLES) {
    const existing = roles.filter(r => r.name === role.name);
    ensure(existing.length <= 1, 'ROLE_COLLISION');
    if (existing.length) ensure(existing[0].description === plan.ownerMarker && !existing[0].system && existing[0].syncStatus === 'synced' && isDeepStrictEqual([...existing[0].permissions].sort(), [...role.permissions].sort()), 'ROLE_UNOWNED_OR_DRIFT');
  }
  for (const { role, account } of checks) {
    let actual = roles.find(r => r.name === role.name);
    if (!actual) {
      ensure(apply, 'ROLE_MISSING');
      actual = api('/security/roles', admin, 'POST', { operationId: plan.intents[role.name].create, name: role.name, description: plan.ownerMarker, permissions: role.permissions }).role;
    }
    ensure(actual.description === plan.ownerMarker && !actual.system && actual.syncStatus === 'synced' && isDeepStrictEqual([...actual.permissions].sort(), [...role.permissions].sort()), 'ROLE_UNOWNED_OR_DRIFT');
    const assignments = api('/security/employees/' + account.employeeId + '/roles');
    ensure(assignments.subject === account.subject, 'ASSIGNMENT_IDENTITY_DRIFT');
    const existing = assignments.items.filter(r => r.roleName === role.name);
    if (!existing.length) {
      ensure(apply, 'ASSIGNMENT_MISSING');
      const result = api('/security/employees/' + account.employeeId + '/roles', admin, 'POST', { operationId: plan.intents[role.name].assign, roleName: role.name });
      ensure(result.assignment.status === 'active' && result.assignment.syncStatus === 'synced' && result.assignment.subject === account.subject, 'ASSIGNMENT_NOT_SYNCED');
    } else ensure(existing.length === 1 && existing[0].status === 'active' && existing[0].syncStatus === 'synced' && existing[0].subject === account.subject, 'ASSIGNMENT_DRIFT');
  }
}

export function reconcileRoles(api, base, allowed, apply) {
  const mappings = api(base + '/scope-mappings');
  ensure(!Object.keys(mappings.clientMappings ?? {}).length, 'CLIENT_ROLE_SCOPE_DRIFT');
  const current = mappings.realmMappings ?? [];
  ensure(current.every(r => allowed.some(a => a.id === r.id)), 'REALM_ROLE_SCOPE_DRIFT');
  const missing = allowed.filter(r => !current.some(a => a.id === r.id));
  if (missing.length) { ensure(apply, 'READ_ROLE_SCOPE_MISSING'); api(base + '/scope-mappings/realm', 'POST', missing); }
}

export function preflightClients(api, plan) {
  for (const definition of definitions(plan.ownerMarker)) {
    const found = api('/clients?clientId=' + definition.clientId);
    ensure(found.length <= 1, 'CLIENT_COLLISION');
    if (found.length) assertOwnedClient(api('/clients/' + found[0].id), definition);
  }
  for (const scope of api('/client-scopes')) {
    if ([...MCP_SCOPES, 'n8n:api:read'].includes(scope.name)) ensure(scope.description === plan.ownerMarker, 'SCOPE_UNOWNED_OR_DRIFT');
  }
  for (const id of API_AUDIENCES) {
    const found = api('/clients?clientId=' + id);
    ensure(found.length === 1 && found[0].clientId === id, 'API_CLIENT_MISSING');
  }
}

export function preflightReadRoles(api, plan) {
  for (const role of ROLES) {
    let existing;
    try { existing = api('/roles/' + role.name); }
    catch (error) { if (error.message === 'IDP_HTTP_404') continue; throw error; }
    ensure(existing.name === role.name && existing.description === plan.ownerMarker && existing.composite === false && existing.clientRole === false, 'IDP_ROLE_UNOWNED_OR_DRIFT');
  }
}

async function configure(api, plan, apply) {
  const save = () => privateWrite(PATHS.plan, plan);
  for (const id of API_AUDIENCES) ensure(api('/clients?clientId=' + id).length === 1, 'API_CLIENT_MISSING');
  const roleObjects = Object.fromEntries(ROLES.map(r => [r.name, api('/roles/' + r.name)]));
  ensure(Object.values(roleObjects).every(r => r.composite === false && !r.clientRole), 'READ_ROLE_COMPOSITE');
  const scopes = [];
  for (const name of [...MCP_SCOPES, 'n8n:api:read']) {
    let found = api('/client-scopes').filter(s => s.name === name);
    const expected = { name, description: plan.ownerMarker, protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'true', 'display.on.consent.screen': 'false' } };
    if (!found.length) { ensure(apply, 'SCOPE_MISSING'); api('/client-scopes', 'POST', expected); found = api('/client-scopes').filter(s => s.name === name); }
    ensure(found.length === 1, 'SCOPE_COLLISION');
    const scope = api('/client-scopes/' + found[0].id);
    assertSubset(scope, expected, 'SCOPE_UNOWNED_OR_DRIFT');
    ensure((api('/client-scopes/' + scope.id + '/protocol-mappers/models') ?? []).length === 0, 'SCOPE_MAPPER_DRIFT');
    const allowed = name === 'mcp' ? [] : [roleObjects[name.endsWith(':self') ? 'mcp_read_self' : 'mcp_read_team']];
    reconcileRoles(api, '/client-scopes/' + scope.id, allowed, apply && !plan.complete);
    scopes.push(scope);
  }
  for (const definition of definitions(plan.ownerMarker)) {
    const key = definition.clientId;
    let found = api('/clients?clientId=' + key);
    if (!found.length) {
      ensure(apply && (!plan.initialized[key] || plan.initialized[key] === 'creating'), 'CLIENT_MISSING');
      plan.initialized[key] = 'creating'; save();
      api('/clients', 'POST', definition); found = api('/clients?clientId=' + key);
    }
    ensure(found.length === 1, 'CLIENT_COLLISION');
    const actual = api('/clients/' + found[0].id);
    assertOwnedClient(actual, definition);
    const base = '/clients/' + actual.id;
    const relevant = key === 'autonexus-n8n-reader' ? scopes.filter(s => s.name === 'n8n:api:read') : key === 'autonexus-mcp-local-reader' ? scopes.filter(s => s.name.startsWith('mcp')) : [];
    const basic = api('/client-scopes').filter(s => s.name === 'basic');
    ensure(basic.length === 1, 'BASIC_SCOPE_MISSING');
    const managed = name => MCP_SCOPES.includes(name) || name === 'n8n:api:read';
    for (const kind of ['default', 'optional']) {
      const expected = kind === 'default'
        ? [basic[0], ...relevant.filter(s => ['mcp', 'n8n:api:read'].includes(s.name))]
        : relevant.filter(s => !['mcp', 'n8n:api:read'].includes(s.name));
      const current = api(base + '/' + kind + '-client-scopes');
      for (const scope of current) if (managed(scope.name) && !expected.some(s => s.id === scope.id)) {
        ensure(apply && ['creating', 'ready'].includes(plan.initialized[key]), 'CLIENT_SCOPE_DRIFT');
        api(base + '/' + kind + '-client-scopes/' + scope.id, 'DELETE');
      }
      for (const scope of expected) if (!current.some(s => s.id === scope.id)) {
        ensure(apply && ['creating', 'ready'].includes(plan.initialized[key]), 'CLIENT_SCOPE_MISSING');
        api(base + '/' + kind + '-client-scopes/' + scope.id, 'PUT');
      }
    }
    reconcileRoles(api, base, key === 'autonexus-n8n-reader' ? [roleObjects.mcp_read_team] : Object.values(roleObjects), apply && ['creating', 'ready'].includes(plan.initialized[key]));
    if (!definition.publicClient) {
      const secret = api(base + '/client-secret');
      ensure(typeof secret.value === 'string' && secret.value.length >= 16, 'CLIENT_SECRET_MISSING');
      const value = { clientId: key, clientSecret: secret.value };
      const path = key === 'autonexus-mcp-server' ? PATHS.secret : PATHS.n8nSecret;
      if (apply) stableWrite(path, value);
      else ensure(readFileSync(path, 'utf8') === bytes(value), 'CLIENT_SECRET_DRIFT');
    }
    if (apply) { plan.initialized[key] = 'ready'; save(); }
  }
}

export async function main(args = process.argv.slice(2)) {
  ensure(args.length <= 1 && (!args.length || ['--plan', '--apply', '--verify'].includes(args[0])), 'USE_PLAN_APPLY_VERIFY');
  const mode = args[0] ?? '--plan';
  const root = resolve('.');
  ensure(execFileSync('git', ['branch', '--show-current']).toString().trim() === 'work/marcelo', 'BRANCH_MISMATCH');
  ensure(normalized(root).endsWith('/autonexus-ai/.worktrees/work-marcelo'), 'WORKTREE_MISMATCH');
  for (const path of Object.values(PATHS)) execFileSync('git', ['check-ignore', path], { stdio: 'pipe' });
  const origin = process.env.MCP_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4286';
  ensure([4285, 4286, 4280].some(p => origin === 'http://127.0.0.1:' + p), 'PUBLIC_ORIGIN_NOT_APPROVED');
  if (mode === '--plan') return { mode: 'plan', adminLogin: false, mutations: false, clientCount: 3, roleCount: 2, existingPrivateStateRead: false };
  const apply = mode === '--apply';
  if (apply) mkdirSync('output/mcp-read/fixture', { recursive: true, mode: 0o700 });
  let plan;
  if (existsSync(PATHS.plan)) plan = read(PATHS.plan);
  else { ensure(apply, 'PLAN_MISSING'); plan = newPlan(origin); stableWrite(PATHS.plan, plan); }
  validatePlan(plan, origin);
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).toString().trim();
  await withLocalAdmin(origin, mainRepositoryRoot(common), async api => {
    preflightClients(api, plan);
    preflightReadRoles(api, plan);
    await ownerRoles(plan, apply);
    await configure(api, plan, apply);
  }, apply, root);
  const registry = { version: 1, clients: [{ clientId: 'autonexus-mcp-local-reader', enabled: true, scopes: MCP_SCOPES }] };
  if (apply) { stableWrite(PATHS.registry, registry); plan.complete = true; privateWrite(PATHS.plan, plan); }
  else ensure(readFileSync(PATHS.registry, 'utf8') === bytes(registry), 'REGISTRY_DRIFT');
  const summary = { mode: apply ? 'apply' : 'verify', configurationVerified: true, runtimeVerified: false, clientCount: 3, roleCount: 2, windowsAclVerified: false, tokenExchangeVerified: false };
  if (apply) stableWrite(PATHS.summary, summary);
  return summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '') ? error.message : 'PRIVATE_PROVISION_FAILED';
    console.error('FAIL ' + code + '; private diagnostics omitted'); process.exitCode = 1;
  });
}
