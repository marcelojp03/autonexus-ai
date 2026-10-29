import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { ensure, httpApi, retry, preserve, json } from '../bootstrap.mjs';
import { coordinatorClientId, coordinatorOwner, technicalScopes, participantAudiences } from '../../keycloak/scripts/cu15-identity.mjs';

const internal = 'http://keycloak:8080/identity';
const realmSpec = JSON.parse(readFileSync(new URL('../../keycloak/realm.json', import.meta.url), 'utf8'));
const equal = isDeepStrictEqual;
function policy(actual, expected, code) {
  ensure(Object.entries(expected).every(([key, value]) => equal(actual[key], value)), code);
}
const audienceMapper = audience => ({ name: audience, protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config: { 'included.client.audience': audience, 'access.token.claim': 'true', 'id.token.claim': 'false', 'introspection.token.claim': 'true' } });
export function canReconcileInitialDefaults(defaults, accountId, initialized) {
  return Array.isArray(defaults) && (defaults.length === 0 || (!initialized && defaults.every(role =>
    (role.clientRole === false && ['offline_access', 'uma_authorization'].includes(role.name)) ||
    (role.clientRole === true && role.containerId === accountId && ['manage-account', 'view-profile'].includes(role.name)))));
}
export function clientScopesExpected(defaults, optional, names, serviceAccount) {
  return optional.length === 0 && defaults.every(scope => names.includes(scope.name) || (serviceAccount && scope.name === 'service_account'));
}
export async function provisionIdentity(state, configDir, initialized = false) {
  const token = await retry(async () => {
    const response = await fetch(internal + '/realms/master/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'bootstrap', password: state.secrets.keycloak }), signal: AbortSignal.timeout(5000), redirect: 'error' });
    ensure(response.status === 200, 'IDP_NOT_READY');
    const value = await response.json(); ensure(typeof value.access_token === 'string', 'IDP_TOKEN_INVALID'); return value.access_token;
  });
  const request = httpApi(internal + '/admin/realms', 'Bearer ' + token);
  const api = (path, ...args) => request('/autonexus' + path, ...args);
  const { roles, clients: unused, ...settings } = realmSpec;
  settings.sslRequired = state.publicOrigin.startsWith('https:') ? 'external' : 'none';
  const existingRealm = await request('/autonexus', 'GET', undefined, [200, 404]);
  if (!existingRealm) await request('', 'POST', settings);
  else policy(existingRealm, settings, 'REALM_POLICY_DRIFT');
  for (const role of roles.realm) {
    const existing = await api('/roles/' + role.name, 'GET', undefined, [200, 404]);
    if (!existing) await api('/roles', 'POST', role);
    else policy(existing, role, 'REALM_ROLE_DRIFT');
  }
  const realm = await api('');
  if (realm.defaultRole) {
    const defaults = await api('/roles-by-id/' + realm.defaultRole.id + '/composites');
    const account = (await api('/clients?clientId=account'))[0];
    ensure(canReconcileInitialDefaults(defaults, account?.id, initialized), 'DEFAULT_ROLE_POLICY_DRIFT');
    if (defaults.length) await api('/roles-by-id/' + realm.defaultRole.id + '/composites', 'DELETE', defaults);
  }
  async function client(definition) {
    let found = await api('/clients?clientId=' + encodeURIComponent(definition.clientId));
    if (!found.length) { await api('/clients', 'POST', definition); found = await api('/clients?clientId=' + encodeURIComponent(definition.clientId)); }
    ensure(found.length === 1, 'CLIENT_NOT_UNIQUE');
    let actual = await api('/clients/' + found[0].id);
    const { defaultClientScopes, optionalClientScopes, protocolMappers, attributes, secret, ...expected } = definition;
    if (!initialized && definition.clientId === 'autonexus-shell' && definition.fullScopeAllowed === true && actual.fullScopeAllowed === false) {
      const { fullScopeAllowed, ...unchanged } = expected;
      policy(actual, unchanged, 'CLIENT_POLICY_DRIFT');
      policy(actual.attributes ?? {}, attributes, 'CLIENT_ATTRIBUTE_DRIFT');
      await api('/clients/' + actual.id, 'PUT', { ...actual, fullScopeAllowed: true });
      actual = await api('/clients/' + actual.id);
    }
    policy(actual, expected, 'CLIENT_POLICY_DRIFT');
    if (attributes) policy(actual.attributes ?? {}, attributes, 'CLIENT_ATTRIBUTE_DRIFT');
    return actual;
  }
  async function scopes(client, names) {
    const available = await api('/client-scopes');
    const defaults = await api('/clients/' + client.id + '/default-client-scopes');
    const optional = await api('/clients/' + client.id + '/optional-client-scopes');
    // Keycloak26.8 attaches this built-in identity scope automatically to service accounts.
    // Token audiences, technical scopes and management authority are checked below as well.
    ensure(clientScopesExpected(defaults, optional, names, client.serviceAccountsEnabled === true), 'CLIENT_SCOPE_DRIFT');
    for (const name of names) {
      const scope = available.find(item => item.name === name); ensure(scope, 'CLIENT_SCOPE_MISSING');
      if (!defaults.some(item => item.id === scope.id)) await api('/clients/' + client.id + '/default-client-scopes/' + scope.id, 'PUT');
    }
  }
  async function mappers(client, expected) {
    const actual = await api('/clients/' + client.id + '/protocol-mappers/models');
    ensure(actual.every(item => expected.some(mapper => mapper.name === item.name)), 'CLIENT_MAPPER_DRIFT');
    for (const mapper of expected) {
      const current = actual.find(item => item.name === mapper.name);
      if (!current) await api('/clients/' + client.id + '/protocol-mappers/models', 'POST', mapper);
      else { policy(current, { name: mapper.name, protocol: mapper.protocol, protocolMapper: mapper.protocolMapper }, 'CLIENT_MAPPER_DRIFT'); policy(current.config, mapper.config, 'CLIENT_MAPPER_DRIFT'); }
    }
  }
  const audiences = ['autonexus-operations-api', ...participantAudiences];
  for (const clientId of audiences) await client({ clientId, enabled: true, protocol: 'openid-connect', bearerOnly: true, publicClient: false, standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: false });
  // Preserve the existing public-client policy so CU02 custom roles can be emitted.
  // Roles remain metadata: current owner permissions and linkage authorize every request.
  const shell = await client({ clientId: 'autonexus-shell', enabled: true, protocol: 'openid-connect', publicClient: true, standardFlowEnabled: true, implicitFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: false, fullScopeAllowed: true, defaultClientScopes: ['basic', 'profile', 'roles'], optionalClientScopes: [], redirectUris: [state.publicOrigin + '/auth/callback'], webOrigins: [state.publicOrigin], attributes: { 'pkce.code.challenge.method': 'S256', 'post.logout.redirect.uris': state.publicOrigin + '/' } });
  await scopes(shell, ['basic', 'profile', 'roles']);
  await mappers(shell, audiences.map(audienceMapper));
  const workshopRoles = await Promise.all(roles.realm.map(role => api('/roles/' + role.name)));
  const assignedScope = await api('/clients/' + shell.id + '/scope-mappings/realm');
  ensure(assignedScope.every(role => workshopRoles.some(item => item.id === role.id)), 'SHELL_ROLE_SCOPE_DRIFT');
  const missingRoles = workshopRoles.filter(role => !assignedScope.some(item => item.id === role.id));
  if (missingRoles.length) await api('/clients/' + shell.id + '/scope-mappings/realm', 'POST', missingRoles);
  const availableScopes = await api('/client-scopes');
  const roleScope = availableScopes.find(scope => scope.name === 'roles');
  const roleMappers = await api('/client-scopes/' + roleScope.id + '/protocol-mappers/models');
  ensure(roleMappers.some(mapper => mapper.protocolMapper === 'oidc-usermodel-realm-role-mapper' && mapper.config['claim.name'] === 'realm_access.roles' && mapper.config['access.token.claim'] === 'true'), 'ROLE_MAPPER_MISSING');
  const management = (await api('/clients?clientId=realm-management'))[0];
  ensure(management, 'REALM_MANAGEMENT_MISSING');
  const machine = async (clientId, owner, defaults, secret) => {
    const result = await client({ clientId, secret, protocol: 'openid-connect', enabled: true, publicClient: false, serviceAccountsEnabled: true, standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: false, fullScopeAllowed: false, defaultClientScopes: defaults, optionalClientScopes: [], attributes: { 'autonexus.owner': owner } });
    await scopes(result, defaults);
    const account = await api('/clients/' + result.id + '/service-account-user');
    const assigned = await api('/users/' + account.id + '/role-mappings/realm');
    ensure(assigned.every(role => role.id === realm.defaultRole?.id), 'TECHNICAL_REALM_ROLE_DRIFT');
    if (assigned.length) await api('/users/' + account.id + '/role-mappings/realm', 'DELETE', assigned);
    return result;
  };
  const employees = await machine('autonexus-employees-admin', 'cu03-employees', ['basic', 'roles'], state.secrets.employeesClient);
  const employeeAccount = await api('/clients/' + employees.id + '/service-account-user');
  const allowed = ['manage-users', 'view-realm', 'manage-realm'];
  const managementRoles = await Promise.all(allowed.map(name => api('/clients/' + management.id + '/roles/' + name)));
  for (const path of ['/users/' + employeeAccount.id + '/role-mappings/clients/' + management.id, '/clients/' + employees.id + '/scope-mappings/clients/' + management.id]) {
    const current = await api(path); ensure(current.every(role => allowed.includes(role.name)), 'EMPLOYEES_AUTHORITY_DRIFT');
    const missing = managementRoles.filter(role => !current.some(item => item.id === role.id));
    if (missing.length) await api(path, 'POST', missing);
  }
  for (const path of ['/users/' + employeeAccount.id + '/role-mappings', '/clients/' + employees.id + '/scope-mappings']) {
    const mapping = await api(path);
    ensure((mapping.realmMappings ?? []).length === 0 && Object.keys(mapping.clientMappings ?? {}).every(name => name === 'realm-management'), 'EMPLOYEES_AUTHORITY_DRIFT');
  }
  const profile = await api('/users/profile');
  const attribute = { name: 'employeeId', displayName: 'Employee UUID', multivalued: false, permissions: { view: ['admin'], edit: ['admin'] }, validations: { length: { min: 36, max: 36 }, pattern: { pattern: '^[0-9a-f-]{36}$' } } };
  const oldAttribute = profile.attributes.find(item => item.name === attribute.name);
  if (oldAttribute) { policy(oldAttribute, { permissions: attribute.permissions, validations: attribute.validations, multivalued: false }, 'EMPLOYEE_ATTRIBUTE_DRIFT'); }
  else { profile.attributes.push(attribute); await api('/users/profile', 'PUT', profile); }
  for (const name of technicalScopes) {
    const existing = availableScopes.find(scope => scope.name === name);
    const attributes = { 'include.in.token.scope': 'true', 'display.on.consent.screen': 'false', 'autonexus.owner': coordinatorOwner };
    if (!existing) await api('/client-scopes', 'POST', { name, protocol: 'openid-connect', attributes });
    else policy(existing.attributes, attributes, 'TECHNICAL_SCOPE_DRIFT');
  }
  const coordinator = await machine(coordinatorClientId, coordinatorOwner, ['basic', ...technicalScopes], state.secrets.coordinatorClient);
  await mappers(coordinator, participantAudiences.map(audienceMapper));
  const coordinatorAccount = await api('/clients/' + coordinator.id + '/service-account-user');
  for (const path of ['/users/' + coordinatorAccount.id + '/role-mappings/clients/' + management.id, '/clients/' + coordinator.id + '/scope-mappings/clients/' + management.id, '/users/' + coordinatorAccount.id + '/role-mappings/realm', '/clients/' + coordinator.id + '/scope-mappings/realm']) ensure((await api(path)).length === 0, 'COORDINATOR_AUTHORITY_DRIFT');
  for (const path of ['/users/' + coordinatorAccount.id + '/role-mappings', '/clients/' + coordinator.id + '/scope-mappings']) {
    const mapping = await api(path);
    ensure((mapping.realmMappings ?? []).length === 0 && Object.keys(mapping.clientMappings ?? {}).length === 0, 'COORDINATOR_AUTHORITY_DRIFT');
  }
  for (const [clientValue, path] of [[employees, 'employees/employees-client.json'], [coordinator, 'operations/cu15-coordinator-client.json']]) {
    const secret = await api('/clients/' + clientValue.id + '/client-secret'); ensure(typeof secret.value === 'string' && secret.value.length >= 16, 'CLIENT_SECRET_INVALID');
    ensure(secret.value === state.secrets[clientValue.id === coordinator.id ? 'coordinatorClient' : 'employeesClient'], 'CLIENT_SECRET_DRIFT');
    preserve(resolve(configDir, path), json({ clientId: clientValue.clientId, clientSecret: secret.value }), 0o444);
    const response = await fetch(internal + '/realms/autonexus/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientValue.clientId, client_secret: secret.value }), signal: AbortSignal.timeout(5000), redirect: 'error' });
    ensure(response.status === 200, 'TECHNICAL_TOKEN_FAILED');
    const issued = await response.json();
    const claims = JSON.parse(Buffer.from(issued.access_token.split('.')[1], 'base64url').toString());
    ensure(claims.azp === clientValue.clientId && claims.typ === 'Bearer' && claims.iss === state.publicOrigin + '/identity/realms/autonexus' && !(claims.realm_access?.roles?.length), 'TECHNICAL_TOKEN_POLICY_DRIFT');
    if (clientValue.id === coordinator.id) {
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      const scopes = String(claims.scope ?? '').split(' ').filter(Boolean);
      ensure(equal([...audiences].sort(), [...participantAudiences].sort()) && technicalScopes.every(scope => scopes.includes(scope)) && scopes.every(scope => ['basic', ...technicalScopes].includes(scope)) && !claims.resource_access, 'COORDINATOR_TOKEN_POLICY_DRIFT');
    } else {
      ensure(equal([...(claims.resource_access?.['realm-management']?.roles ?? [])].sort(), [...allowed].sort()) && Object.keys(claims.resource_access ?? {}).every(name => name === 'realm-management'), 'EMPLOYEES_TOKEN_POLICY_DRIFT');
    }
  }
  const account = state.admin;
  let users = await api('/users?exact=true&username=' + encodeURIComponent(account.username));
  if (!users.length) {
    await api('/users', 'POST', { username: account.username, firstName: 'Local', lastName: 'Administrator', email: account.username + '@example.invalid', emailVerified: true, enabled: true, requiredActions: [], credentials: [{ type: 'password', value: account.password, temporary: false }] });
    users = await api('/users?exact=true&username=' + encodeURIComponent(account.username));
  }
  ensure(users.length === 1 && users[0].enabled && users[0].requiredActions.length === 0, 'ADMIN_ACCOUNT_DRIFT');
  const assigned = await api('/users/' + users[0].id + '/role-mappings/realm');
  ensure(assigned.every(role => role.name === 'administrador' || role.id === realm.defaultRole?.id), 'ADMIN_ROLE_DRIFT');
  if (!assigned.some(role => role.name === 'administrador')) await api('/users/' + users[0].id + '/role-mappings/realm', 'POST', [workshopRoles.find(role => role.name === 'administrador')]);
}
