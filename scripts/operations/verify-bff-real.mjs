/** Operations block through the BFF: GraphQL -> Operations REST -> PostgreSQL. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const { Client } = createRequire(resolve(root, 'services/employees/package.json'))('pg');
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
const primary = resolve(common.stdout.trim(), '..');
const accounts = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8'));
const env = {};
for (const line of readFileSync(resolve(primary, 'services/operations/.env'), 'utf8').split(/\r?\n/)) {
  const at = line.indexOf('=');
  if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1);
}
const bff = 'http://127.0.0.1:3004/graphql';
const suffix = randomUUID().slice(0, 8).toUpperCase();
const stages = [];
const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });
const ids = { customer: null, vehicle: null, service: null, appointment: null };

const graphql = async (token, query, variables) => {
  const response = await fetch(bff, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(25000),
  });
  assert.equal(response.status, 200);
  return response.json();
};
const token = async key => (await authorize(accounts.find(account => account.key === key))).access_token;

try {
  await db.connect();
  const admin = await token('administrador');
  const reception = await token('recepcionista');
  const head = await token('jefe_taller');
  const mechanic = await token('mecanico');

  const denied = await graphql(mechanic, '{ customers { total } }');
  assert.equal(denied.errors[0].extensions.code, 'FORBIDDEN');
  const listed = await graphql(reception, '{ customers(limit: 5) { total limit } }');
  assert.equal(listed.errors, undefined);
  assert.equal(listed.data.customers.limit, 5);
  stages.push('customers-through-graphql-with-permissions');

  const customer = await graphql(admin,
    'mutation ($input: CreateCustomerInput!) { createCustomer(input: $input) { customer { id document status version } replayed } }',
    { input: { operationId: randomUUID(), firstName: 'Bff', lastName: 'Cliente', document: 'C9' + suffix, phone: '+591 70123456' } });
  assert.equal(customer.errors, undefined);
  ids.customer = customer.data.createCustomer.customer.id;
  assert.equal(customer.data.createCustomer.customer.version, 1);
  const duplicate = await graphql(admin,
    'mutation ($input: CreateCustomerInput!) { createCustomer(input: $input) { customer { id } } }',
    { input: { operationId: randomUUID(), firstName: 'Bff', lastName: 'Duplicado', document: 'C9' + suffix, phone: '+591 70123456' } });
  assert.equal(duplicate.errors[0].extensions.code, 'DUPLICATE_DOCUMENT');
  stages.push('customer-created-through-graphql');

  const vehicle = await graphql(reception,
    'mutation ($input: CreateVehicleInput!) { createVehicle(input: $input) { vehicle { id plate customerId customerName } replayed } }',
    { input: { operationId: randomUUID(), customerId: ids.customer, plate: 'G' + suffix, make: 'Nissan', model: 'Versa', year: 2022, fuelType: 'gasolina' } });
  assert.equal(vehicle.errors, undefined);
  ids.vehicle = vehicle.data.createVehicle.vehicle.id;
  assert.equal(vehicle.data.createVehicle.vehicle.customerName, 'Bff Cliente');
  stages.push('vehicle-created-through-graphql');

  const service = await graphql(head,
    'mutation ($input: CreateServiceInput!) { createService(input: $input) { service { id name estimatedMinutes referenceRate active } replayed } }',
    { input: { operationId: randomUUID(), name: 'Revisión ' + suffix, description: 'Revisión de 20 puntos', category: 'mantenimiento', estimatedMinutes: 45, referenceRate: 90.25 } });
  assert.equal(service.errors, undefined);
  ids.service = service.data.createService.service.id;
  assert.equal(service.data.createService.service.estimatedMinutes, 45);
  stages.push('service-created-through-graphql');

  const appointment = await graphql(reception,
    'mutation ($input: CreateAppointmentInput!) { createAppointment(input: $input) { appointment { id startsAt endsAt status customerName vehiclePlate serviceName version } replayed } }',
    { input: { operationId: randomUUID(), customerId: ids.customer, vehicleId: ids.vehicle, serviceId: ids.service, startsAt: '2026-12-15T10:00:00-04:00', notes: 'Cita desde GraphQL' } });
  assert.equal(appointment.errors, undefined);
  const created = appointment.data.createAppointment.appointment;
  ids.appointment = created.id;
  assert.equal(created.status, 'scheduled');
  assert.equal(new Date(created.endsAt).getTime(), new Date(created.startsAt).getTime() + 45 * 60000);
  stages.push('appointment-scheduled-through-graphql');

  const window = await graphql(head, 'query ($from: DateTime, $to: DateTime) { appointments(from: $from, to: $to) { total items { id status serviceName } } }',
    { from: '2026-12-15T00:00:00-04:00', to: '2026-12-16T00:00:00-04:00' });
  assert.ok(window.data.appointments.items.some(item => item.id === ids.appointment));
  stages.push('appointment-window-query');

  const rescheduled = await graphql(reception,
    'mutation ($id: UUID!, $input: RescheduleAppointmentInput!) { rescheduleAppointment(id: $id, input: $input) { appointment { id startsAt version } } }',
    { id: ids.appointment, input: { operationId: randomUUID(), expectedVersion: 1, startsAt: '2026-12-15T15:00:00-04:00' } });
  assert.equal(rescheduled.errors, undefined);
  assert.equal(rescheduled.data.rescheduleAppointment.appointment.version, 2);
  const cancelled = await graphql(reception,
    'mutation ($id: UUID!, $input: CancelAppointmentInput!) { cancelAppointment(id: $id, input: $input) { appointment { id status cancelReason version } } }',
    { id: ids.appointment, input: { operationId: randomUUID(), expectedVersion: 2, reason: 'Reprogramación del cliente' } });
  assert.equal(cancelled.data.cancelAppointment.appointment.status, 'cancelled');
  stages.push('appointment-rescheduled-and-cancelled');

  await graphql(admin, 'mutation ($id: UUID!, $input: OperationsCommandInput!) { deactivateService(id: $id, input: $input) { service { active } } }',
    { id: ids.service, input: { operationId: randomUUID(), expectedVersion: 1 } });
  const inactive = await graphql(reception,
    'mutation ($input: CreateAppointmentInput!) { createAppointment(input: $input) { appointment { id } } }',
    { input: { operationId: randomUUID(), customerId: ids.customer, vehicleId: ids.vehicle, serviceId: ids.service, startsAt: '2026-12-16T11:00:00-04:00' } });
  assert.equal(inactive.errors[0].extensions.code, 'SERVICE_INACTIVE');
  stages.push('inactive-service-rejected-through-graphql');

  const audit = await db.query("SELECT count(*)::int AS count FROM operations.operations_history WHERE entity IN ('customer','vehicle','service','appointment')");
  assert.ok(audit.rows[0].count >= 5);
  stages.push('operations-audit-persisted');

  console.log(JSON.stringify({ pass: true, stages, ids }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 320) }));
  process.exitCode = 1;
} finally {
  try {
    if (ids.appointment) await db.query("UPDATE operations.appointments SET status='cancelled', cancel_reason=coalesce(cancel_reason,'cleanup') WHERE id=$1", [ids.appointment]);
    if (ids.vehicle) await db.query("UPDATE operations.vehicles SET status='inactive' WHERE id=$1", [ids.vehicle]);
    if (ids.customer) await db.query("UPDATE operations.customers SET status='inactive' WHERE id=$1", [ids.customer]);
    if (ids.service) await db.query("UPDATE operations.service_catalog SET active=false WHERE id=$1", [ids.service]);
    await db.end();
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}
