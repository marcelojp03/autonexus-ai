/** CU02 real verification: owner API + PostgreSQL + Keycloak realm roles. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
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
const api = 'http://127.0.0.1:3002';
const idp = 'http://127.0.0.1:8180';
const realm = idp + '/admin/realms/autonexus';
const stages = [];
const suffix = randomUUID().slice(0, 8);
const supervisor = 'supervisor_' + suffix;
const limited = 'limitado_' + suffix;
const createdRoles = [supervisor, limited];
let employeeId, subject, password, secondEmployeeId;
const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });

const call = async (path, { method = 'GET', body, token, expected = 200 } = {}) => {
  const response = await fetch(api + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const parsed = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path} -> ${response.status} ${JSON.stringify(parsed)}`);
  return parsed;
};

const adminToken = async () => (await authorize(accounts.find(account => account.key === 'administrador'))).access_token;
const employeeToken = () => authorize({ username: 'employee-' + employeeId, password, enabled: true });

const adminHeader = async () => {
  const response = await fetch(idp + '/realms/autonexus/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: technical.clientId, client_secret: technical.clientSecret }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  return { Authorization: 'Bearer ' + (await response.json()).access_token, 'Content-Type': 'application/json' };
};
const idpCall = async (path, options = {}) => {
  const headers = await adminHeader();
  return fetch(realm + path, { ...options, headers: { ...headers, ...(options.headers ?? {}) }, signal: AbortSignal.timeout(10000) });
};

try {
  await db.connect();
  const admin = await adminToken();
  const mecanico = (await authorize(accounts.find(account => account.key === 'mecanico'))).access_token;

  const catalog = await call('/security/permissions', { token: admin });
  assert.equal(catalog.catalog.length, 6);
  assert.deepEqual([...catalog.effective].sort(), ['employees:read', 'employees:write', 'schedules:read', 'schedules:write', 'security:read', 'security:write']);
  const mecanicoCatalog = await call('/security/permissions', { token: mecanico });
  assert.deepEqual(mecanicoCatalog.effective, []);
  stages.push('catalog-and-effective-permissions');

  const roles = await call('/security/roles', { token: admin });
  assert.deepEqual(roles.map(role => role.name).sort(), ['administrador', 'jefe_taller', 'mecanico', 'recepcionista', 'responsable_financiero']);
  await call('/security/roles', { token: mecanico, expected: 403 });
  await call('/security/roles', { expected: 401 });
  stages.push('roles-read-and-denial');

  const document = 'CU02-' + suffix;
  const created = await call('/employees', {
    method: 'POST',
    body: {
      operationId: randomUUID(), firstName: 'Synthetic', lastName: 'Seguridad', document,
      email: document.toLowerCase() + '@example.invalid', phone: '+591 70000001',
      jobTitle: 'Supervisor', startDate: '2020-01-01', specialties: [], access: { requested: true },
    },
    token: admin,
    expected: 201,
  });
  employeeId = created.employee.id;
  let current = created.employee;
  for (let attempt = 0; attempt < 20 && current.access.status !== 'synced'; attempt += 1) {
    await new Promise(done => setTimeout(done, 500));
    current = await call('/employees/' + employeeId, { token: admin });
  }
  assert.equal(current.access.status, 'synced', 'employee identity must be linked');
  subject = current.access.subject;
  assert.ok(subject, 'linked subject expected');

  password = 'Cu02-' + randomBytes(12).toString('hex');
  const reset = await idpCall('/users/' + encodeURIComponent(subject) + '/reset-password', {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: password, temporary: false }),
  });
  assert.equal(reset.status, 204, 'temporary credential for the synthetic employee');
  const unprivileged = (await employeeToken()).access_token;
  await call('/security/roles', { token: unprivileged, expected: 403 });
  await call('/security/permissions', { token: unprivileged, expected: 403 });
  stages.push('employee-created-with-linked-identity');

  const role = await call('/security/roles', {
    method: 'POST',
    body: { operationId: randomUUID(), name: supervisor, description: 'Supervisión de pruebas', permissions: ['schedules:read'] },
    token: admin,
    expected: 201,
  });
  assert.equal(role.role.syncStatus, 'synced');
  assert.deepEqual(role.role.permissions, ['schedules:read']);
  const realmRole = await idpCall('/roles/' + encodeURIComponent(supervisor));
  assert.equal(realmRole.status, 200, 'realm role must exist');
  const realmProfile = await realmRole.json();
  assert.deepEqual(JSON.parse(realmProfile.attributes.permissions[0]), ['schedules:read']);
  await call('/security/roles', {
    method: 'POST',
    body: { operationId: randomUUID(), name: supervisor, permissions: ['schedules:read'] },
    token: admin,
    expected: 409,
  }).then(body => assert.equal(body.code, 'ROLE_DUPLICATE'));
  stages.push('role-created-and-materialized-in-idp');

  const adminAssignment = await call(`/security/employees/${employeeId}/roles`, {
    method: 'POST',
    body: { operationId: randomUUID(), roleName: 'administrador' },
    token: admin,
    expected: 201,
  });
  assert.equal(adminAssignment.assignment.syncStatus, 'synced');
  const mapping = await idpCall('/users/' + encodeURIComponent(subject) + '/role-mappings/realm');
  assert.ok((await mapping.json()).some(item => item.name === 'administrador'), 'realm mapping expected');
  const lastAdministrator = await call(`/security/employees/${employeeId}/roles/administrador/revoke`, {
    method: 'POST',
    body: { operationId: randomUUID(), expectedVersion: adminAssignment.assignment.version },
    token: admin,
    expected: 409,
  });
  assert.equal(lastAdministrator.code, 'LAST_ADMINISTRATOR');
  const reduceAdministrator = await call('/security/roles/administrador', {
    method: 'PUT',
    body: { operationId: randomUUID(), expectedVersion: 1, description: 'Administración completa de la plataforma', permissions: ['employees:read', 'employees:write', 'schedules:read', 'schedules:write', 'security:read'] },
    token: admin,
    expected: 409,
  });
  assert.equal(reduceAdministrator.code, 'LAST_ADMINISTRATOR');
  const untouched = await call('/security/roles/administrador', { token: admin });
  assert.equal(untouched.version, 1);
  assert.equal(untouched.permissions.includes('security:write'), true);
  stages.push('last-administrator-guard-blocks-revoke-and-reduction');

  const limitedRole = await call('/security/roles', {
    method: 'POST',
    body: { operationId: randomUUID(), name: limited, permissions: ['security:read', 'security:write'] },
    token: admin,
    expected: 201,
  });
  assert.equal(limitedRole.role.syncStatus, 'synced');
  await call(`/security/employees/${employeeId}/roles`, {
    method: 'POST',
    body: { operationId: randomUUID(), roleName: limited },
    token: admin,
    expected: 201,
  });
  const handover = await call(`/security/employees/${employeeId}/roles/administrador/revoke`, {
    method: 'POST',
    body: { operationId: randomUUID(), expectedVersion: adminAssignment.assignment.version },
    token: admin,
  });
  assert.equal(handover.assignment.status, 'revoked');
  assert.equal(handover.assignment.syncStatus, 'synced');
  const afterRevoke = await idpCall('/users/' + encodeURIComponent(subject) + '/role-mappings/realm');
  assert.equal((await afterRevoke.json()).some(item => item.name === 'administrador'), false);
  stages.push('administrator-handover-to-new-role');

  const limitedToken = (await employeeToken()).access_token;
  await call('/security/roles', { token: limitedToken });
  await call('/employees', { token: limitedToken, expected: 403 });
  await call('/staffing/employees', { token: limitedToken, expected: 403 });
  const escalation = await call('/security/roles', {
    method: 'POST',
    body: { operationId: randomUUID(), name: 'escalado_' + suffix, permissions: ['employees:write'] },
    token: limitedToken,
    expected: 409,
  });
  assert.equal(escalation.code, 'PERMISSION_ESCALATION');
  stages.push('new-role-is-enforced-and-escalation-blocked');

  const reduceOnlyAdministrator = await call('/security/roles/' + limited, {
    method: 'PUT',
    body: { operationId: randomUUID(), expectedVersion: limitedRole.role.version, permissions: ['security:read'] },
    token: admin,
    expected: 409,
  });
  assert.equal(reduceOnlyAdministrator.code, 'LAST_ADMINISTRATOR');
  stages.push('second-reduction-guard');

  // Concurrency: two administrators exist; removing both at once must leave exactly one.
  const secondDocument = 'CU2B-' + suffix;
  const second = await call('/employees', {
    method: 'POST',
    body: {
      operationId: randomUUID(), firstName: 'Synthetic', lastName: 'Concurrent', document: secondDocument,
      email: secondDocument.toLowerCase() + '@example.invalid', phone: '+591 70000004',
      jobTitle: 'Supervisor', startDate: '2020-01-01', specialties: [], access: { requested: true },
    },
    token: admin,
    expected: 201,
  });
  secondEmployeeId = second.employee.id;
  let secondRecord = second.employee;
  for (let attempt = 0; attempt < 20 && secondRecord.access.status !== 'synced'; attempt += 1) {
    await new Promise(done => setTimeout(done, 500));
    secondRecord = await call('/employees/' + secondEmployeeId, { token: admin });
  }
  assert.equal(secondRecord.access.status, 'synced');
  const firstAdmin = await call(`/security/employees/${employeeId}/roles`, {
    method: 'POST', body: { operationId: randomUUID(), roleName: 'administrador' }, token: admin, expected: 201,
  });
  const secondAdmin = await call(`/security/employees/${secondEmployeeId}/roles`, {
    method: 'POST', body: { operationId: randomUUID(), roleName: 'administrador' }, token: admin, expected: 201,
  });
  const attemptRevoke = async (id, version) => {
    const response = await fetch(`http://127.0.0.1:3002/security/employees/${id}/roles/administrador/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin },
      body: JSON.stringify({ operationId: randomUUID(), expectedVersion: version }),
      signal: AbortSignal.timeout(20000),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const concurrent = await Promise.all([
    attemptRevoke(employeeId, firstAdmin.assignment.version),
    attemptRevoke(secondEmployeeId, secondAdmin.assignment.version),
  ]);
  const statuses = concurrent.map(item => item.status).sort();
  assert.deepEqual(statuses, [200, 409], 'exactly one concurrent revocation may succeed: ' + JSON.stringify(concurrent));
  const blocked = concurrent.find(item => item.status === 409);
  assert.ok(['LAST_ADMINISTRATOR', 'CONCURRENT_OPERATION'].includes(blocked.body.code), 'safe contention code expected');
  const remaining = await db.query(
    `SELECT count(DISTINCT e.id)::int AS count FROM employees.security_role_assignments a
     JOIN employees.security_roles r ON r.name = a.role_name
     JOIN employees.employee_records e ON e.id = a.employee_id
     WHERE a.revoked_at IS NULL AND 'security:write' = ANY(r.permissions) AND e.record->>'status' = 'active'`,
  );
  assert.ok(remaining.rows[0].count >= 1, 'one administrator must remain');
  stages.push('concurrent-revocation-keeps-one-administrator');

  const assignment = await call(`/security/employees/${employeeId}/roles`, {
    method: 'POST',
    body: { operationId: randomUUID(), roleName: supervisor },
    token: admin,
    expected: 201,
  });
  assert.equal(assignment.assignment.syncStatus, 'synced');
  assert.equal(assignment.assignment.subject, subject);
  const supervisorToken = (await employeeToken()).access_token;
  await call('/staffing/employees', { token: supervisorToken });
  await call('/employees', { token: supervisorToken, expected: 403 });
  await call('/security/roles', { token: supervisorToken });
  stages.push('permissions-are-the-union-of-active-assignments');

  const revokeOperation = randomUUID();
  const revoke = await call(`/security/employees/${employeeId}/roles/${supervisor}/revoke`, {
    method: 'POST',
    body: { operationId: revokeOperation, expectedVersion: assignment.assignment.version },
    token: admin,
  });
  assert.equal(revoke.assignment.status, 'revoked');
  const replay = await call(`/security/employees/${employeeId}/roles/${supervisor}/revoke`, {
    method: 'POST',
    body: { operationId: revokeOperation, expectedVersion: assignment.assignment.version },
    token: admin,
  });
  assert.equal(replay.replayed, true);
  await call(`/security/employees/${employeeId}/roles/${supervisor}/revoke`, {
    method: 'POST',
    body: { operationId: randomUUID(), expectedVersion: assignment.assignment.version },
    token: admin,
    expected: 409,
  });
  await call('/staffing/employees', { token: supervisorToken, expected: 403 });
  stages.push('role-revocation-takes-effect-for-issued-token');
  const retry = await call('/security/roles/' + supervisor + '/retry-sync', {
    method: 'POST',
    body: { operationId: randomUUID(), expectedVersion: role.role.version },
    token: admin,
  });
  assert.equal(retry.role.syncStatus, 'synced');
  stages.push('role-retry-sync');

  const history = await call('/security/history?roleName=' + supervisor, { token: admin });
  const actions = history.items.map(item => item.action);
  for (const action of ['role-created', 'role-synced', 'role-assigned', 'role-revoked']) {
    assert.ok(actions.includes(action), 'audit action expected: ' + action);
  }
  const employeeHistory = await call(`/security/history?employeeId=${employeeId}`, { token: admin });
  assert.ok(employeeHistory.items.some(item => item.entity === 'assignment'));
  stages.push('audit-recorded-for-roles-and-assignments');

  await call(`/employees/${employeeId}/deactivate`, {
    method: 'POST',
    body: { operationId: randomUUID(), expectedVersion: (await call('/employees/' + employeeId, { token: admin })).version },
    token: admin,
  });
  const inactive = await call(`/security/employees/${employeeId}/roles`, {
    method: 'POST',
    body: { operationId: randomUUID(), roleName: supervisor },
    token: admin,
    expected: 409,
  });
  assert.equal(inactive.code, 'EMPLOYEE_INACTIVE');
  stages.push('inactive-employee-cannot-receive-roles');

  console.log(JSON.stringify({ pass: true, stages, employeeId, roles: createdRoles }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 300) }));
  process.exitCode = 1;
} finally {
  try {
    for (const id of [employeeId, secondEmployeeId].filter(Boolean)) {
      await db.query(
        "UPDATE employees.employee_records SET record=jsonb_set(record,'{status}','\"inactive\"') WHERE id=$1 AND record->>'status'='active'",
        [id],
      );
      await db.query('DELETE FROM employees.security_history WHERE employee_id=$1', [id]);
      await db.query('DELETE FROM employees.security_role_assignments WHERE employee_id=$1', [id]);
    }
    for (const name of createdRoles) {
      await db.query('DELETE FROM employees.security_history WHERE role_name=$1 AND employee_id IS NULL', [name]);
      await db.query("DELETE FROM employees.security_roles WHERE name=$1 AND system=false", [name]);
      const headers = await adminHeader().catch(() => null);
      if (headers) await fetch(realm + '/roles/' + encodeURIComponent(name), { method: 'DELETE', headers, signal: AbortSignal.timeout(8000) });
    }
    await db.end();
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}
