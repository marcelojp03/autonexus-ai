/** CU04 real verification: owner API + PostgreSQL + Keycloak roles. */
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
const env = {};
for (const line of readFileSync(resolve(primary, 'services/employees/.env'), 'utf8').split(/\r?\n/)) {
  const at = line.indexOf('=');
  if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1);
}
const api = 'http://127.0.0.1:3002';
const stages = [];
let employeeId, shiftA, shiftB, absenceId, assignmentId;
const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });

const call = async (path, method = 'GET', body, token, expected = 200) => {
  const response = await fetch(api + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const parsed = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path} -> ${response.status} ${JSON.stringify(parsed)}`);
  return parsed;
};

try {
  await db.connect();
  const admin = (await authorize(accounts.find(a => a.key === 'administrador'))).access_token;
  const jefe = (await authorize(accounts.find(a => a.key === 'jefe_taller'))).access_token;
  const mecanico = (await authorize(accounts.find(a => a.key === 'mecanico'))).access_token;

  const document = 'CU04-' + randomUUID().slice(0, 8);
  const created = await call('/employees', 'POST', {
    operationId: randomUUID(), firstName: 'Synthetic', lastName: 'Scheduling', document,
    email: document.toLowerCase() + '@example.invalid', phone: '+591 70000000',
    jobTitle: 'Mecánico', startDate: '2020-01-01', specialties: [],
  }, admin, 201);
  employeeId = created.employee.id;

  await call('/staffing/employees', 'GET', undefined, undefined, 401);
  await call('/staffing/employees', 'GET', undefined, mecanico, 403);
  await call('/employees?limit=1', 'GET', undefined, jefe, 403);
  stages.push('permissions-admin-jefe-mechanic');

  const list = await call('/staffing/employees', 'GET', undefined, jefe);
  assert.ok(list.some(item => item.id === employeeId));
  assert.equal(Object.keys(list[0]).sort().join(','), 'fullName,id,jobTitle,status');
  stages.push('minimal-projection-for-head');

  shiftA = (await call(`/staffing/employees/${employeeId}/shifts`, 'POST', {
    operationId: randomUUID(), weekday: 1, startsAt: '09:00', endsAt: '17:00', breakStart: '12:00', breakEnd: '13:00',
  }, admin, 201)).shift;
  await call(`/staffing/employees/${employeeId}/shifts`, 'POST', {
    operationId: randomUUID(), weekday: 1, startsAt: '16:00', endsAt: '18:00',
  }, admin, 409).then(body => assert.equal(body.code, 'SHIFT_OVERLAP'));
  await call(`/staffing/employees/${employeeId}/shifts`, 'POST', {
    operationId: randomUUID(), weekday: 2, startsAt: '18:00', endsAt: '09:00',
  }, admin, 400);
  await call(`/staffing/employees/${employeeId}/shifts`, 'POST', {
    operationId: randomUUID(), weekday: 2, startsAt: '09:00', endsAt: '13:00', breakStart: '12:00', breakEnd: '14:00',
  }, admin, 400);
  stages.push('shift-create-overlap-and-validation');

  shiftB = (await call(`/staffing/employees/${employeeId}/shifts`, 'POST', {
    operationId: randomUUID(), weekday: 2, startsAt: '09:00', endsAt: '13:00',
  }, jefe, 201)).shift;
  stages.push('head-can-plan');

  const availability = await call(`/staffing/employees/${employeeId}/availability?date=2026-11-02`, 'GET', undefined, jefe);
  assert.equal(availability.absent, false);
  assert.deepEqual(availability.available, [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }]);
  stages.push('availability-excludes-break');

  absenceId = (await call(`/staffing/employees/${employeeId}/absences`, 'POST', {
    operationId: randomUUID(), startsOn: '2026-11-04', endsOn: '2026-11-05', reason: 'Capacitación',
  }, jefe, 201)).absence.id;
  await call(`/staffing/employees/${employeeId}/absences`, 'POST', {
    operationId: randomUUID(), startsOn: '2026-11-05', endsOn: '2026-11-06',
  }, jefe, 409).then(body => assert.equal(body.code, 'ABSENCE_OVERLAP'));
  const absent = await call(`/staffing/employees/${employeeId}/availability?date=2026-11-04`, 'GET', undefined, admin);
  assert.equal(absent.absent, true);
  assert.deepEqual(absent.available, []);
  stages.push('absence-blocks-availability');

  assignmentId = randomUUID();
  await db.query(
    "INSERT INTO employees.employee_assignments(id, employee_id, starts_at, ends_at, status, reference, created_at) VALUES($1,$2,$3,$4,'confirmed',$5,now())",
    [assignmentId, employeeId, '2026-11-06 10:00:00-04', '2026-11-06 11:00:00-04', 'OT-CU04-1'],
  );
  await call(`/staffing/employees/${employeeId}/shifts`, 'POST', {
    operationId: randomUUID(), weekday: 5, startsAt: '09:30', endsAt: '10:30',
  }, admin, 409).then(body => assert.equal(body.code, 'AFFECTS_CONFIRMED_ASSIGNMENT'));
  const friday = await call(`/staffing/employees/${employeeId}/shifts`, 'POST', {
    operationId: randomUUID(), weekday: 5, startsAt: '09:30', endsAt: '10:30', acknowledgeConfirmedAssignments: true,
  }, admin, 201);
  assert.equal(friday.acknowledgedAssignments, true);
  const availabilityFriday = await call(`/staffing/employees/${employeeId}/availability?date=2026-11-06`, 'GET', undefined, admin);
  assert.equal(availabilityFriday.assignments.length, 1);
  stages.push('confirmed-assignment-conflict-and-acknowledgement');

  const opId = randomUUID();
  const deactivated = await call(`/staffing/shifts/${shiftB.id}/deactivate`, 'POST', { operationId: opId, expectedVersion: shiftB.version }, admin);
  assert.equal(deactivated.shift.active, false);
  const replayDeactivate = await call(`/staffing/shifts/${shiftB.id}/deactivate`, 'POST', { operationId: opId, expectedVersion: shiftB.version }, admin);
  assert.equal(replayDeactivate.replayed, true);
  await call(`/staffing/shifts/${shiftB.id}/deactivate`, 'POST', { operationId: randomUUID(), expectedVersion: shiftB.version }, admin, 409);
  stages.push('deactivation-version-and-replay');

  const schedule = await call(`/staffing/employees/${employeeId}/schedule`, 'GET', undefined, jefe);
  assert.equal(schedule.timezone, 'America/La_Paz');
  assert.ok(schedule.shifts.some(item => item.id === shiftA.id && item.active));
  assert.ok(schedule.absences.some(item => item.id === absenceId));
  stages.push('schedule-read');

  const audit = await db.query('SELECT count(*)::int AS count FROM employees.staffing_audit WHERE employee_id=$1', [employeeId]);
  assert.ok(audit.rows[0].count >= 4, 'audit rows expected');
  stages.push('audit-recorded');

  const current = await call(`/employees/${employeeId}`, 'GET', undefined, admin);
  await call(`/employees/${employeeId}/deactivate`, 'POST', { operationId: randomUUID(), expectedVersion: current.version }, admin);
  const inactive = await call(`/staffing/employees/${employeeId}/shifts`, 'POST', {
    operationId: randomUUID(), weekday: 3, startsAt: '09:00', endsAt: '10:00',
  }, admin, 409);
  assert.equal(inactive.code, 'EMPLOYEE_INACTIVE');
  stages.push('inactive-employee-rejected');

  console.log(JSON.stringify({ pass: true, stages, employeeId }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 260) }));
  process.exitCode = 1;
} finally {
  try {
    if (assignmentId) await db.query('DELETE FROM employees.employee_assignments WHERE id=$1', [assignmentId]);
    if (employeeId) {
      await db.query('UPDATE employees.employee_shifts SET active=false WHERE employee_id=$1', [employeeId]);
      await db.query('UPDATE employees.employee_absences SET active=false WHERE employee_id=$1', [employeeId]);
    }
    await db.end();
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}
