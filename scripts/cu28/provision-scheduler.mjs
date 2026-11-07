/** Local explicit setup: employee-owned OAuth delegation, never client_credentials automation.
 * Private ledger is separate from event/job evidence; no credential is printed. */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {randomBytes, randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {internal, withLocalAdmin, ensure, mainRepositoryRoot} from '../mcp/local-admin.mjs';
import {execFileSync} from 'node:child_process';
import {authorize} from '../../services/employees/scripts/local-pkce.mjs';

export const ROLE = 'cu28_read_due';
export const PERMISSIONS = ['appointments:read', 'quotes:read'];
export const CLIENT = 'autonexus-cu28-scheduler';
const origin = process.env.CU28_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4286';
const issuer = origin + '/identity/realms/autonexus';
const redirect = 'http://127.0.0.1:5678/rest/oauth2-credential/callback';
const dir = resolve('output/cu28/scheduler');
const ledgerPath = resolve(dir, 'identity.private.json');
const privateWrite = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + String.fromCharCode(10), {mode: 0o600});

export async function login(account, config = {}) {
  let failure;
  for (let n = 0; n < 5; n++) {
    try { return await authorize({...account, enabled: true}, false,
      {issuer, redirect: origin + '/auth/callback', ...config}); }
    catch (caught) { failure = caught; }
  }
  throw new Error('SCHEDULER_LOGIN_FAILED', {cause: failure});
}

export async function provision() {
  ensure(execFileSync('git', ['branch', '--show-current'], {encoding: 'utf8'}).trim() === 'work/marcelo', 'BRANCH_MISMATCH');
  mkdirSync(dir, {recursive: true, mode: 0o700});
  execFileSync('git', ['check-ignore', ledgerPath], {stdio: 'pipe'});
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {
    marker: 'CU28-' + randomUUID(), createEmployee: randomUUID(), createRole: randomUUID(),
    assignDue: randomUUID(), assignTeam: randomUUID(), password: randomBytes(32).toString('hex'),
  };
  privateWrite(ledgerPath, ledger);
  const fixture = JSON.parse(readFileSync('output/cu27/fixture/admin-test.private.json', 'utf8'));
  const admin = (await login(fixture.accounts.adminTest)).access_token;
  const owner = (path, method = 'GET', body) => {
    const result = internal('http://employees:3002' + path, {token: admin, method, body});
    ensure([200, 201].includes(result.status), 'EMPLOYEE_OWNER_HTTP_' + result.status + ':' + path + ':' + (result.data?.code ?? 'UNKNOWN'));
    return result.data;
  };
  ensure(PERMISSIONS.every(p => owner('/security/permissions').effective.includes(p)), 'SETUP_PERMISSION_EXPANSION');
  let role = owner('/security/roles').find(r => r.name === ROLE);
  if (!role) role = owner('/security/roles', 'POST', {operationId: ledger.createRole, name: ROLE,
    description: ledger.marker, permissions: PERMISSIONS}).role;
  ensure(role.description === ledger.marker && !role.system &&
    JSON.stringify([...role.permissions].sort()) === JSON.stringify([...PERMISSIONS].sort()), 'ROLE_OWNERSHIP_DRIFT');
  if (!ledger.employeeId) {
    const created = owner('/employees', 'POST', {operationId: ledger.createEmployee,
      firstName: 'Automatización', lastName: ledger.marker, document: ledger.marker.slice(0, 40),
      email: ledger.marker.toLowerCase() + '@example.invalid', phone: '+59170000000',
      jobTitle: 'Automatización local de lectura', startDate: new Date().toISOString().slice(0, 10),
      specialties: [], mechanicEnabled: false, access: {requested: true}}).employee;
    Object.assign(ledger, {employeeId: created.id, subject: created.access.subject, username: 'employee-' + created.id});
    privateWrite(ledgerPath, ledger);
  }
  let employee = owner('/employees/' + ledger.employeeId);
  for (let retry = 0; retry < 3 && employee.access.status !== 'synced'; retry++) {
    ensure(['failed', 'pending'].includes(employee.access.status), 'EMPLOYEE_IDENTITY_CONFLICT');
    owner('/employees/' + ledger.employeeId + '/access/retry', 'POST',
      {operationId: randomUUID(), expectedVersion: employee.version});
    employee = owner('/employees/' + ledger.employeeId);
  }
  ensure(employee.status === 'active' && employee.access.status === 'synced' && employee.access.subject, 'EMPLOYEE_BINDING_UNAVAILABLE');
  ensure(!ledger.subject || employee.access.subject === ledger.subject, 'EMPLOYEE_BINDING_DRIFT');
  ledger.subject = employee.access.subject; privateWrite(ledgerPath, ledger);
  const assignments = owner('/security/employees/' + ledger.employeeId + '/roles');
  for (const [roleName, intent] of [[ROLE, ledger.assignDue], ['mcp_read_team', ledger.assignTeam]]) {
    if (!assignments.items.some(a => a.roleName === roleName && a.status === 'active'))
      owner('/security/employees/' + ledger.employeeId + '/roles', 'POST', {operationId: intent, roleName});
  }
  const root = mainRepositoryRoot(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {encoding: 'utf8'}).trim());
  await withLocalAdmin(origin, root, api => {
    const user = api('/users/' + ledger.subject);
    ensure(user.username === ledger.username, 'USER_OWNERSHIP_DRIFT');
    if (!ledger.credentialSet) {
      api('/users/' + ledger.subject + '/reset-password', 'PUT', {type: 'password', value: ledger.password, temporary: false});
      ledger.credentialSet = true; privateWrite(ledgerPath, ledger);
    }
    let client = api('/clients?clientId=' + CLIENT)[0];
    if (!client) {
      const audiences = ['autonexus-operations-api', 'autonexus-employees-api', 'autonexus-finance-api'];
      api('/clients', 'POST', {clientId: CLIENT, enabled: true, protocol: 'openid-connect', publicClient: false,
        standardFlowEnabled: true, implicitFlowEnabled: false, directAccessGrantsEnabled: false,
        serviceAccountsEnabled: false, fullScopeAllowed: false, redirectUris: [redirect], webOrigins: [],
        defaultClientScopes: ['basic'], optionalClientScopes: [],
        attributes: {'cu28.owner': ledger.marker, 'pkce.code.challenge.method': 'S256', 'access.token.lifespan': '60'},
        protocolMappers: [
          ...audiences.map(a => ({name: a, protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
            config: {'included.custom.audience': a, 'access.token.claim': 'true', 'id.token.claim': 'false'}})),
          {name: 'cu28-roles', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-realm-role-mapper',
            config: {'claim.name': 'realm_access.roles', 'jsonType.label': 'String', multivalued: 'true',
              'access.token.claim': 'true', 'id.token.claim': 'false'}},
        ]});
      client = api('/clients?clientId=' + CLIENT)[0];
    }
    const configured = api('/clients/' + client.id);
    ensure(configured.attributes?.['cu28.owner'] === ledger.marker && !configured.serviceAccountsEnabled
      && !configured.directAccessGrantsEnabled && !configured.fullScopeAllowed, 'CLIENT_POLICY_DRIFT');
    const roles = [ROLE, 'mcp_read_team'].map(name => api('/roles/' + name));
    const current = api('/clients/' + client.id + '/scope-mappings/realm');
    ensure(current.every(r => roles.some(a => a.id === r.id)), 'CLIENT_SCOPE_EXPANSION');
    const missing = roles.filter(r => !current.some(a => a.id === r.id));
    if (missing.length) api('/clients/' + client.id + '/scope-mappings/realm', 'POST', missing);
    ledger.clientId = CLIENT; ledger.clientSecret = api('/clients/' + client.id + '/client-secret').value;
    privateWrite(ledgerPath, ledger);
  }, true, resolve('.'));
  return renewCredential(ledger);
}

export async function renewCredential(ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))) {
  const tokens = await login(ledger, {client: CLIENT, clientSecret: ledger.clientSecret, redirect, scope: 'openid'});
  const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url'));
  ensure(claims.sub === ledger.subject && !claims.realm_access.roles.some(r => ['administrador', 'jefe_taller'].includes(r)), 'TOKEN_SCOPE_ESCALATION');
  const effective = internal('http://employees:3002/security/permissions', {token: tokens.access_token}).data.effective;
  ensure(effective.every(p => [...PERMISSIONS, 'orders:read', 'agenda:read:team', 'executions:read:team'].includes(p)), 'PERMISSION_EXPANSION');
  const credential = [{id: 'autonexusCu28Scheduler', name: 'CU28 empleado delegado', type: 'oAuth2Api',
    data: {grantType: 'pkce', authUrl: issuer + '/protocol/openid-connect/auth',
      accessTokenUrl: 'http://keycloak:8080/identity/realms/autonexus/protocol/openid-connect/token',
      clientId: CLIENT, clientSecret: ledger.clientSecret, scope: 'openid', authentication: 'body',
      sendAdditionalCredentialsToTokenUrl: true, oauthTokenData: tokens}}];
  privateWrite(resolve(dir, 'credential.private.json'), credential);
  console.log(JSON.stringify({employeeId: ledger.employeeId, subject: ledger.subject, client: CLIENT, permissions: effective,
    accessTokenSeconds: claims.exp - claims.iat, hasRefresh: !!tokens.refresh_token, secretPrinted: false}));
  return ledger;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  (process.argv[2] === '--renew' ? renewCredential() : provision())
    .catch(error => { console.error(error.message); process.exitCode = 1; });
