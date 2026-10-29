/** Provision only CU15 machine authority; never a runtime bootstrap credential. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { coordinatorClientId as clientId, coordinatorOwner as owner, technicalScopes, participantAudiences, interactiveClients } from './cu15-identity.mjs';

const requireCondition = (condition, code) => { if (!condition) throw new Error(code); };
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
  requireCondition(result.status === 0, 'INFRASTRUCTURE_COMMAND_FAILED'); return result.stdout.trim();
};
const primary = resolve(run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']), '..');
const directory = resolve(primary, 'infra/keycloak');
const privateFile = resolve(directory, '.local/cu15-coordinator-client.json');
const normalize = value => value.split(String.fromCharCode(92)).join('/').toLowerCase();
const base = 'http://127.0.0.1:8180';
async function request(path, options = {}, allowed = [200, 201, 204]) {
  let response;
  try { response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
  catch { throw new Error('IDP_UNAVAILABLE'); }
  requireCondition(allowed.includes(response.status), 'IDP_STATUS_' + response.status); return response;
}
try {
  for (const name of ['autonexus-keycloak-dev-keycloak-1', 'autonexus-keycloak-dev-postgres-1']) {
    const labels = JSON.parse(run('docker', ['inspect', '--format', '{{json .Config.Labels}}', name]));
    requireCondition(labels['com.docker.compose.project'] === 'autonexus-keycloak-dev' && normalize(labels['com.docker.compose.project.working_dir']) === normalize(directory), 'KEYCLOAK_OWNERSHIP_MISMATCH');
  }
  run('git', ['-C', primary, 'check-ignore', '--quiet', privateFile]);
  const watched = ['.env', '.local/test-accounts.json', '.local/employees-client.json'].map(path => resolve(directory, path)).filter(existsSync).map(path => ({ path, bytes: readFileSync(path) }));
  const environment = Object.fromEntries(readFileSync(resolve(directory, '.env'), 'utf8').split(String.fromCharCode(10)).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
  const bootstrap = await (await request('/realms/master/protocol/openid-connect/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: environment.KC_BOOTSTRAP_ADMIN_USERNAME, password: environment.KC_BOOTSTRAP_ADMIN_PASSWORD }),
  })).json();
  const headers = { Authorization: 'Bearer ' + bootstrap.access_token, 'Content-Type': 'application/json' };
  const api = async (path, method = 'GET', body) => {
    const response = await request('/admin/realms/autonexus' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return response.status === 200 ? response.json() : null;
  };
  let clients = await api('/clients?clientId=' + clientId);
  if (!clients.length) {
    await api('/clients', 'POST', { clientId, protocol: 'openid-connect', enabled: true, publicClient: false, serviceAccountsEnabled: true, standardFlowEnabled: false, implicitFlowEnabled: false, directAccessGrantsEnabled: false, fullScopeAllowed: false, defaultClientScopes: ['basic'], optionalClientScopes: [], attributes: { 'autonexus.owner': owner } });
    clients = await api('/clients?clientId=' + clientId);
  }
  requireCondition(clients.length === 1, 'COORDINATOR_CLIENT_NOT_UNIQUE');
  const client = await api('/clients/' + clients[0].id);
  requireCondition(client.attributes?.['autonexus.owner'] === owner && client.publicClient === false && client.serviceAccountsEnabled === true && client.fullScopeAllowed === false && client.standardFlowEnabled === false && client.directAccessGrantsEnabled === false && client.implicitFlowEnabled === false, 'COORDINATOR_CLIENT_POLICY_MISMATCH');
  const scopes = await api('/client-scopes');
  for (const name of technicalScopes) {
    if (!scopes.some(scope => scope.name === name)) await api('/client-scopes', 'POST', { name, protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'true', 'display.on.consent.screen': 'false', 'autonexus.owner': owner } });
  }
  const available = await api('/client-scopes');
  const defaults = await api('/clients/' + client.id + '/default-client-scopes');
  for (const name of ['basic', ...technicalScopes]) {
    const scope = available.find(item => item.name === name);
    requireCondition(scope && (name === 'basic' || scope.attributes?.['autonexus.owner'] === owner), 'TECHNICAL_SCOPE_POLICY_MISMATCH');
    if (!defaults.some(item => item.id === scope.id)) await api('/clients/' + client.id + '/default-client-scopes/' + scope.id, 'PUT');
  }
  const mappers = await api('/clients/' + client.id + '/protocol-mappers/models');
  for (const audience of participantAudiences) {
    const name = 'cu15-' + audience;
    const existing = mappers.find(mapper => mapper.name === name);
    const definition = { name, protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper', config: { 'included.client.audience': audience, 'access.token.claim': 'true', 'id.token.claim': 'false', 'introspection.token.claim': 'true' } };
    if (!existing) await api('/clients/' + client.id + '/protocol-mappers/models', 'POST', definition);
    else requireCondition(existing.protocolMapper === definition.protocolMapper && Object.entries(definition.config).every(([key, value]) => existing.config[key] === value), 'COORDINATOR_AUDIENCE_MISMATCH');
  }
  const account = await api('/clients/' + client.id + '/service-account-user');
  const realmManagement = (await api('/clients?clientId=realm-management'))[0];
  requireCondition((await api('/users/' + account.id + '/role-mappings/clients/' + realmManagement.id)).length === 0, 'UNEXPECTED_COORDINATOR_MANAGEMENT_AUTHORITY');
  requireCondition((await api('/clients/' + client.id + '/scope-mappings/clients/' + realmManagement.id)).length === 0, 'UNEXPECTED_COORDINATOR_MANAGEMENT_SCOPE');
  for (const publicId of interactiveClients) {
    const publicClient = (await api('/clients?clientId=' + publicId))[0];
    requireCondition(publicClient && publicClient.publicClient === true, 'PUBLIC_CLIENT_MISSING');
    const defaults = await api('/clients/' + publicClient.id + '/default-client-scopes');
    const optional = await api('/clients/' + publicClient.id + '/optional-client-scopes');
    requireCondition([...defaults, ...optional].every(scope => !technicalScopes.includes(scope.name)), 'TECHNICAL_SCOPE_EXPOSED_TO_BROWSER');
  }
  const credentials = { clientId, clientSecret: (await api('/clients/' + client.id + '/client-secret')).value };
  requireCondition(typeof credentials.clientSecret === 'string' && credentials.clientSecret.length >= 16, 'COORDINATOR_SECRET_INVALID');
  if (existsSync(privateFile)) {
    let current; try { current = JSON.parse(readFileSync(privateFile, 'utf8')); } catch { throw new Error('PRIVATE_CLIENT_FILE_INVALID'); }
    requireCondition(current.clientId === clientId && current.clientSecret === credentials.clientSecret, 'PRESERVE_EXISTING_COORDINATOR_SECRET');
  }
  const token = await (await request('/realms/autonexus/protocol/openid-connect/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: credentials.clientSecret }) })).json();
  const claims = JSON.parse(Buffer.from(token.access_token.split('.')[1], 'base64url').toString());
  requireCondition(claims.azp === clientId && typeof claims.sub === 'string' && claims.typ === 'Bearer', 'TECHNICAL_IDENTITY_CLAIMS_INVALID');
  const granted = String(claims.scope ?? '').split(' ');
  requireCondition(technicalScopes.every(scope => granted.includes(scope)), 'TECHNICAL_SCOPES_MISSING_FROM_TOKEN');
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  requireCondition(participantAudiences.every(name => audience.includes(name)), 'TECHNICAL_AUDIENCE_INVALID');
  requireCondition(!claims.resource_access?.['realm-management'] && !claims.realm_access?.roles?.some(role => ['administrador', 'jefe_taller', 'mecanico', 'recepcionista', 'responsable_financiero'].includes(role)), 'TECHNICAL_HUMAN_AUTHORITY_EXPOSED');
  if (!existsSync(privateFile)) writeFileSync(privateFile, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
  requireCondition(watched.every(item => item.bytes.equals(readFileSync(item.path))), 'LEGACY_PRIVATE_CONFIGURATION_CHANGED');
  console.log('PASS CU15 client_credentials identity, seven participant-only scopes, audiences and no realm-management/browser authority; existing private files unchanged.');
} catch (error) { const code = typeof error?.message === 'string' && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PROVISION_FAILED'; console.error('FAIL CU15 technical identity: ' + code + '; private diagnostics omitted.'); process.exitCode = 1; }
