import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const approvedOrigins = [4285, 4286, 4280].map(port => 'http://127.0.0.1:' + port);
const origin = process.env.CU27_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4286';
const issuer = origin + '/identity/realms/autonexus';
const directory = 'output/cu27/fixture';
const fixturePath = directory + '/admin-test.private.json';
const evidencePath = directory + '/admin-preflight.private.json';
const accountsPath = 'output/stack/cu16-proof.accounts.private.json';
const username = 'cu27-synthetic-admin-test';
const ensure = (condition, code) => { if (!condition) throw new Error(code); };
const docker = args => execFileSync('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function privateWrite(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}

function inspect(service) {
  const container = 'cu16-proof-' + service + '-1';
  const metadata = JSON.parse(docker(['inspect', container, '--format', '{{json .Config.Labels}}']).toString());
  ensure(metadata['com.docker.compose.project'] === 'cu16-proof' && metadata['com.docker.compose.service'] === service, 'CONTAINER_OWNERSHIP');
  return container;
}

function bootstrapPassword() {
  const container = inspect('provision');
  const mounts = JSON.parse(docker(['inspect', container, '--format', '{{json .Mounts}}']).toString());
  ensure(mounts.some(m => m.Name === 'cu16-proof_bootstrap-state' && m.Destination === '/state'), 'BOOTSTRAP_VOLUME_OWNERSHIP');
  const tar = docker(['cp', container + ':/state/bootstrap.json', '-']);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/s, '').trim(), 8);
    if (name.endsWith('bootstrap.json')) {
      const state = JSON.parse(tar.subarray(offset + 512, offset + 512 + size));
      ensure(state.publicOrigin === origin && /^[a-f0-9]{64}$/.test(state.secrets?.keycloak), 'BOOTSTRAP_STATE_MISMATCH');
      return state.secrets.keycloak;
    }
    ensure(Number.isSafeInteger(size), 'BOOTSTRAP_ARCHIVE_INVALID');
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('EXISTING_BOOTSTRAP_AUTHORITY_UNAVAILABLE');
}

// Private HTTP values enter the one-shot test process through stdin, never argv or env.
function internal(url, { token, method = 'GET', body, form } = {}) {
  const source = "let input='';for await(const c of process.stdin)input+=c;const v=JSON.parse(input);try{const r=await fetch(v.url,{method:v.method,headers:{...(v.token?{Authorization:'Bearer '+v.token}:{}),...(v.body!==undefined?{'Content-Type':v.form?'application/x-www-form-urlencoded':'application/json'}:{})},...(v.body===undefined?{}:{body:v.form?new URLSearchParams(v.body):JSON.stringify(v.body)}),redirect:'error',signal:AbortSignal.timeout(12000)});const t=await r.text();process.stdout.write(JSON.stringify({status:r.status,data:t?JSON.parse(t):null}));}catch{process.stdout.write(JSON.stringify({status:0,data:null}));process.exitCode=1;}";
  return JSON.parse(execFileSync('docker', ['exec', '-i', 'cu16-proof-employees-1', 'node', '--input-type=module', '-e', source], {
    input: JSON.stringify({ url, token, method, body, form }), stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000,
  }).toString());
}

async function provision(fixture) {
  const master = 'http://keycloak:8080/identity/realms/master/protocol/openid-connect';
  const session = internal(master + '/token', { method: 'POST', form: true, body: { grant_type: 'password', client_id: 'admin-cli', username: 'bootstrap', password: bootstrapPassword() } });
  ensure(session.status === 200 && session.data.access_token, 'EXISTING_BOOTSTRAP_AUTHORITY_REJECTED');
  const api = (path, method = 'GET', body) => {
    const result = internal('http://keycloak:8080/identity/admin/realms/autonexus' + path, { token: session.data.access_token, method, body });
    ensure([200, 201, 204].includes(result.status), 'IDP_HTTP_' + result.status);
    return result.data;
  };
  try {
    const find = () => api('/users?exact=true&username=' + encodeURIComponent(username));
    let users = find();
    ensure(users.length <= 1, 'ACCOUNT_NOT_UNIQUE');
    if (!users.length) {
      api('/users', 'POST', { username, firstName: 'Synthetic', lastName: fixture.ownerMarker, email: username + '@example.invalid', emailVerified: true, enabled: true, requiredActions: [], credentials: [{ type: 'password', value: fixture.accounts.adminTest.password, temporary: false }] });
      users = find();
    }
    ensure(users.length === 1, 'ACCOUNT_NOT_UNIQUE');
    const user = users[0];
    ensure(user.firstName === 'Synthetic' && user.lastName === fixture.ownerMarker && user.email === username + '@example.invalid', 'EXISTING_ACCOUNT_UNOWNED');
    ensure(user.enabled && user.requiredActions.length === 0, 'OWNED_ACCOUNT_DRIFT');
    const role = api('/roles/administrador');
    ensure(role.name === 'administrador' && role.composite === false, 'ADMIN_ROLE_DRIFT');
    const realm = api('');
    const roles = api('/users/' + user.id + '/role-mappings/realm');
    ensure(roles.every(r => r.name === 'administrador' || r.id === realm.defaultRole?.id), 'OWNED_ACCOUNT_ROLE_DRIFT');
    if (!roles.some(r => r.id === role.id)) api('/users/' + user.id + '/role-mappings/realm', 'POST', [role]);
    fixture.accounts.adminTest.subject = user.id;
    privateWrite(fixturePath, fixture);
  } finally {
    const logout = internal(master + '/logout', { method: 'POST', form: true, body: { client_id: 'admin-cli', refresh_token: session.data.refresh_token } });
    ensure(logout.status === 204, 'BOOTSTRAP_SESSION_LOGOUT_FAILED');
  }
}

async function main() {
  ensure(approvedOrigins.includes(origin), 'PUBLIC_ORIGIN_NOT_APPROVED');
  ensure(process.argv.length === 3 && ['--provision', '--verify', '--migrate-fixture-origin'].includes(process.argv[2]), 'USE_PROVISION_VERIFY_OR_MIGRATE_FIXTURE_ORIGIN');
  const migrateOrigin = process.argv[2] === '--migrate-fixture-origin';
  ensure(execFileSync('git', ['branch', '--show-current']).toString().trim() === 'work/marcelo', 'BRANCH_MISMATCH');
  ensure(resolve('.').replaceAll('\\', '/').endsWith('/.worktrees/work-marcelo'), 'WORKTREE_MISMATCH');
  for (const path of [fixturePath, evidencePath]) execFileSync('git', ['check-ignore', path], { stdio: 'pipe' });
  inspect('employees'); inspect('keycloak');
  const original = readFileSync(accountsPath);
  const mechanic = JSON.parse(original).accounts.mechanicA;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let fixture;
  const fixtureBytes = existsSync(fixturePath) ? readFileSync(fixturePath) : null;
  if (fixtureBytes) fixture = JSON.parse(fixtureBytes);
  else {
    ensure(process.argv[2] === '--provision', 'FIXTURE_MISSING');
    fixture = { version: 1, origin, ownerMarker: 'CU27-' + randomBytes(16).toString('hex'), accounts: { adminTest: { username, password: randomBytes(32).toString('hex'), enabled: true, roles: ['administrador'] } } };
    privateWrite(fixturePath, fixture);
  }
  ensure(fixture.version === 1 && approvedOrigins.includes(fixture.origin) && fixture.accounts.adminTest.username === username && /^CU27-[a-f0-9]{32}$/.test(fixture.ownerMarker), 'FIXTURE_DRIFT');
  ensure(migrateOrigin || fixture.origin === origin, 'FIXTURE_ORIGIN_MISMATCH_USE_EXPLICIT_MIGRATION');
  if (migrateOrigin) ensure(typeof fixture.accounts.adminTest.subject === 'string' && fixture.accounts.adminTest.subject.length > 0, 'FIXTURE_SUBJECT_MISSING');
  if (process.argv[2] === '--provision') await provision(fixture);
  const adminToken = (await authorize(fixture.accounts.adminTest, false, { issuer, redirect: origin + '/auth/callback' })).access_token;
  const claims = JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64url'));
  ensure(claims.sub === fixture.accounts.adminTest.subject && claims.iss === issuer && claims.realm_access.roles.includes('administrador'), 'ADMIN_PKCE_CLAIMS');
  const gql = async query => {
    const response = await fetch(origin + '/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(15000) });
    const value = await response.json();
    ensure(response.status === 200 && !value.errors, 'ADMIN_GRAPHQL_DENIED');
    return value.data;
  };
  const catalog = (await gql('{securityCatalog{effective roles}}')).securityCatalog;
  ensure(catalog.effective.includes('security:write') && catalog.effective.includes('security:read'), 'ADMIN_EFFECTIVE_PERMISSIONS');
  if (migrateOrigin) {
    ensure(hash(fixtureBytes) === hash(readFileSync(fixturePath)), 'FIXTURE_CHANGED_DURING_VERIFICATION');
    const previousOrigin = fixture.origin;
    if (previousOrigin !== origin) privateWrite(fixturePath, { ...fixture, origin });
    ensure(hash(original) === hash(readFileSync(accountsPath)), 'ORIGINAL_ACCOUNTS_CHANGED');
    console.log(JSON.stringify({ pass: true, fixturePath, accountKey: 'adminTest', previousOrigin, origin, fixtureOriginMigrated: previousOrigin !== origin, pkce: true, sameSubject: true, securityWrite: true, credentialsUnchanged: true, ownerMarkerUnchanged: true, bootstrapUsed: false, revocationPerformed: false }));
    return;
  }
  const mechanicToken = (await authorize({ ...mechanic, enabled: true }, false, { issuer, redirect: origin + '/auth/callback' })).access_token;
  const mechanicClaims = JSON.parse(Buffer.from(mechanicToken.split('.')[1], 'base64url'));
  ensure(mechanicClaims.sub === mechanic.subject && mechanic.employeeId, 'MECHANIC_FIXTURE_MAPPING');
  const employeeId = mechanic.employeeId;
  ensure(/^[0-9a-f-]{36}$/.test(employeeId), 'EMPLOYEE_ID_INVALID');
  const employee = (await gql('{employee(id:"' + employeeId + '"){id status version access{status subject}}}')).employee;
  ensure(employee.status === 'active' && employee.access.status === 'synced' && employee.access.subject === mechanicClaims.sub, 'TARGET_EMPLOYEE_ACCESS_DRIFT');
  const fields = '{employeeId subject items{id roleName employeeId subject status syncStatus version}}';
  const snapshot = await gql('{employeeRoles(employeeId:"' + employeeId + '")' + fields + ' securityRole(name:"mecanico"){name permissions version syncStatus}}');
  ensure(snapshot.employeeRoles.subject === mechanicClaims.sub, 'MECHANIC_OWNER_MAPPING');
  const active = snapshot.employeeRoles.items.filter(r => r.roleName === 'mecanico' && r.status === 'active');
  ensure(active.length === 1 && active[0].subject === mechanicClaims.sub && active[0].syncStatus === 'synced', 'MECHANIC_ASSIGNMENT_NOT_RESTORABLE');
  ensure(snapshot.securityRole.permissions.every(p => catalog.effective.includes(p)), 'RESTORE_PERMISSION_ESCALATION');
  const route = 'http://employees:3002/security/employees/' + employeeId + '/roles';
  const before = JSON.stringify(snapshot.employeeRoles);
  const probe = internal(route, { token: adminToken, method: 'POST', body: {} });
  ensure(probe.status === 400 && probe.data.code === 'VALIDATION_ERROR', 'RESTORE_ROUTE_NOT_AUTHORIZED');
  const denied = internal(route, { token: mechanicToken, method: 'POST', body: {} });
  ensure(denied.status === 403, 'MECHANIC_WRITE_NOT_DENIED');
  const after = (await gql('{employeeRoles(employeeId:"' + employeeId + '")' + fields + '}')).employeeRoles;
  ensure(before === JSON.stringify(after), 'ASSIGNMENT_CHANGED');
  ensure(hash(original) === hash(readFileSync(accountsPath)), 'ORIGINAL_ACCOUNTS_CHANGED');
  const report = { verifiedAt: new Date().toISOString(), fixturePath, accountKey: 'adminTest', pkce: true, securityWrite: true, securityRead: true, noEmployeeAssociationRequired: true, targetEmployeeId: employeeId, targetSubject: mechanicClaims.sub, assignment: active[0], roleVersion: snapshot.securityRole.version, restoration: { method: 'POST', url: route, body: { operationId: 'FRESH_UUID_PER_RESTORE_INTENT', roleName: 'mecanico' }, graphql: 'assignRole(employeeId: UUID!, input: RoleAssignmentInput!)', authorizationProbeStatus: probe.status, authorizationProbeCode: probe.data.code, mechanicDeniedStatus: denied.status, executed: false }, originalAccountsUnchanged: true, targetAssignmentsUnchanged: true, revocationPerformed: false };
  report.roleSyncStatus = snapshot.securityRole.syncStatus;
  report.employee = employee;
  privateWrite(evidencePath, report);
  console.log(JSON.stringify({ pass: true, fixturePath, evidencePath, accountKey: 'adminTest', pkce: true, securityWrite: true, targetEmployeeId: employeeId, assignmentVersion: active[0].version, roleVersion: snapshot.securityRole.version, restoreRouteAuthorized: true, originalAccountsUnchanged: true, revocationPerformed: false }));
}

main().catch(error => {
  const code = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '') ? error.message : 'PRIVATE_PROVISION_OR_PREFLIGHT_FAILED';
  console.error('FAIL ' + code + '; private diagnostics omitted');
  process.exitCode = 1;
});
