/** CU02 real verification through the BFF: Angular contract -> GraphQL -> REST -> PostgreSQL. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const requireApp = createRequire(resolve(root, 'services/employees/package.json'));
const { Client } = requireApp('pg');
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
const primary = resolve(common.stdout.trim(), '..');
const accounts = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8'));
const technical = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/employees-client.json'), 'utf8'));
const env = {};
for (const line of readFileSync(resolve(primary, 'services/employees/.env'), 'utf8').split(/\r?\n/)) {
  const at = line.indexOf('=');
  if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1);
}
const bff = 'http://127.0.0.1:3004/graphql';
const api = 'http://127.0.0.1:3002';
const idp = 'http://127.0.0.1:8180';
const stages = [];
const suffix = randomUUID().slice(0, 8);
const roleName = 'bff_' + suffix;
let employeeId;
const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });

const graphql = async (token, query, variables) => {
  const response = await fetch(bff, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, 200, 'GraphQL transport must answer 200');
  return response.json();
};
const rest = async (path, { method = 'GET', body, token } = {}) => {
  const response = await fetch(api + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const adminHeaders = async () => {
  const response = await fetch(idp + '/realms/autonexus/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: technical.clientId, client_secret: technical.clientSecret }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  return { Authorization: 'Bearer ' + (await response.json()).access_token };
};

try {
  await db.connect();
  const admin = (await authorize(accounts.find(account => account.key === 'administrador'))).access_token;
  const head = (await authorize(accounts.find(account => account.key === 'jefe_taller'))).access_token;

  const catalog = await graphql(admin, '{ securityCatalog { catalog { id module operation } effective roles } }');
  assert.equal(catalog.errors, undefined);
  assert.equal(catalog.data.securityCatalog.catalog.length, 6);
  assert.equal(catalog.data.securityCatalog.effective.length, 6);
  stages.push('catalog-through-graphql');

  const roles = await graphql(admin, '{ securityRoles { name system permissions version syncStatus assignedCount } }');
  assert.equal(roles.errors, undefined);
  assert.equal(roles.data.securityRoles.length, 5);
  const denied = await graphql(head, '{ securityRoles { name } }');
  assert.equal(denied.errors[0].extensions.code, 'FORBIDDEN');
  stages.push('roles-read-and-head-denial');

  const document = 'CB-' + suffix;
  const created = await rest('/employees', {
    method: 'POST',
    token: admin,
    body: {
      operationId: randomUUID(), firstName: 'Synthetic', lastName: 'Bff', document,
      email: document.toLowerCase() + '@example.invalid', phone: '+591 70000002',
      jobTitle: 'Supervisor', startDate: '2020-01-01', specialties: [], access: { requested: true },
    },
  });
  assert.equal(created.status, 201);
  employeeId = created.body.employee.id;
  let employee = created.body.employee;
  for (let attempt = 0; attempt < 20 && employee.access.status !== 'synced'; attempt += 1) {
    await new Promise(done => setTimeout(done, 500));
    employee = (await rest('/employees/' + employeeId, { token: admin })).body;
  }
  assert.equal(employee.access.status, 'synced');

  const role = await graphql(admin, 'mutation ($input: RoleCreateInput!) { createRole(input: $input) { role { name permissions syncStatus version } replayed } }', {
    input: { operationId: randomUUID(), name: roleName, description: 'Verificación BFF', permissions: ['schedules:read'] },
  });
  assert.equal(role.errors, undefined);
  assert.equal(role.data.createRole.role.syncStatus, 'synced');
  const assignment = await graphql(admin, 'mutation ($id: UUID!, $input: RoleAssignmentInput!) { assignRole(employeeId: $id, input: $input) { assignment { id roleName status syncStatus version } replayed } }', {
    id: employeeId,
    input: { operationId: randomUUID(), roleName },
  });
  assert.equal(assignment.errors, undefined);
  assert.equal(assignment.data.assignRole.assignment.syncStatus, 'synced');
  const assignmentId = assignment.data.assignRole.assignment.id;

  const employeeRoles = await graphql(admin, 'query ($id: UUID!) { employeeRoles(employeeId: $id) { employeeId subject items { roleName status syncStatus } } }', { id: employeeId });
  assert.equal(employeeRoles.data.employeeRoles.items.filter(item => item.status === 'active').length, 1);
  stages.push('role-assigned-through-graphql');

  const ledger = await graphql(admin, 'query ($role: String) { securityHistory(roleName: $role, limit: 10) { total items { action entity } } }', { role: roleName });
  const actions = ledger.data.securityHistory.items.map(item => item.action);
  assert.ok(actions.includes('role-created') && actions.includes('role-assigned'));
  stages.push('audit-through-graphql');

  const revocation = await graphql(admin, 'mutation ($id: UUID!, $name: String!, $input: RoleRevocationInput!) { revokeRole(employeeId: $id, roleName: $name, input: $input) { assignment { status syncStatus } replayed } }', {
    id: employeeId,
    name: roleName,
    input: { operationId: randomUUID(), expectedVersion: 1 },
  });
  assert.equal(revocation.data.revokeRole.assignment.status, 'revoked');
  stages.push('role-revoked-through-graphql');

  const headAttempt = await graphql(head, 'mutation ($input: RoleCreateInput!) { createRole(input: $input) { role { name } } }', {
    input: { operationId: randomUUID(), name: 'bff_head_' + suffix, permissions: ['schedules:read'] },
  });
  assert.equal(headAttempt.errors[0].extensions.code, 'FORBIDDEN');
  const headEmployees = await graphql(head, '{ employees { total } }');
  assert.equal(headEmployees.errors[0].extensions.code, 'FORBIDDEN');
  stages.push('cu03-still-administrator-only');

  const current = (await rest('/employees/' + employeeId, { token: admin })).body;
  const deactivated = await rest('/employees/' + employeeId + '/deactivate', {
    method: 'POST', token: admin, body: { operationId: randomUUID(), expectedVersion: current.version },
  });
  assert.equal(deactivated.status, 200);
  stages.push('synthetic-employee-deactivated');

  console.log(JSON.stringify({ pass: true, stages, employeeId, roleName, assignmentId }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 300) }));
  process.exitCode = 1;
} finally {
  try {
    if (employeeId) {
      await db.query('DELETE FROM employees.security_history WHERE employee_id=$1', [employeeId]);
      await db.query('DELETE FROM employees.security_role_assignments WHERE employee_id=$1', [employeeId]);
    }
    await db.query('DELETE FROM employees.security_history WHERE role_name=$1 AND employee_id IS NULL', [roleName]);
    await db.query('DELETE FROM employees.security_roles WHERE name=$1 AND system=false', [roleName]);
    const headers = await adminHeaders().catch(() => null);
    if (headers) await fetch(idp + '/admin/realms/autonexus/roles/' + encodeURIComponent(roleName), { method: 'DELETE', headers, signal: AbortSignal.timeout(8000) });
    await db.end();
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}
