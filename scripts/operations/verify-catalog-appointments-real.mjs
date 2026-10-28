/** CU09/CU10 real verification: service catalog and appointments against PostgreSQL. */
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
const api = 'http://127.0.0.1:8081';
const suffix = randomUUID().slice(0, 8).toUpperCase();
const stages = [];
const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });
const created = { customers: [], vehicles: [], services: [], appointments: [] };

const call = async (path, { method = 'GET', body, token, expected = 200 } = {}) => {
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
const token = async key => (await authorize(accounts.find(account => account.key === key))).access_token;
const at = (hour, minute = 0) => `2026-12-01T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-04:00`;

try {
  await db.connect();
  const admin = await token('administrador');
  const reception = await token('recepcionista');
  const head = await token('jefe_taller');
  const mechanic = await token('mecanico');

  await call('/services', { token: mechanic, expected: 403 });
  await call('/services', { method: 'POST', token: reception, expected: 403, body: { operationId: randomUUID(), name: 'X ' + suffix, description: 'd', category: 'otros', estimatedMinutes: 30, referenceRate: 10 } });
  const catalog = await call('/services', { token: reception });
  assert.ok(Array.isArray(catalog.items));
  stages.push('catalog-permissions');

  const service = await call('/services', {
    method: 'POST', token: head, expected: 201,
    body: { operationId: randomUUID(), name: 'Alineación ' + suffix, description: 'Alineación y balanceo', category: 'mantenimiento', estimatedMinutes: 60, referenceRate: 180.5 },
  });
  created.services.push(service.service.id);
  assert.equal(service.service.estimatedMinutes, 60);
  await call('/services', {
    method: 'POST', token: admin, expected: 409,
    body: { operationId: randomUUID(), name: 'alineación ' + suffix, description: 'Duplicado por nombre', category: 'mantenimiento', estimatedMinutes: 45, referenceRate: 100 },
  }).then(body => assert.equal(body.code, 'DUPLICATE_SERVICE'));
  await call('/services', {
    method: 'POST', token: admin, expected: 400,
    body: { operationId: randomUUID(), name: 'Corto ' + suffix, description: 'd', category: 'otros', estimatedMinutes: 5, referenceRate: 10 },
  });
  await call('/services', {
    method: 'POST', token: admin, expected: 400,
    body: { operationId: randomUUID(), name: 'Tarifa ' + suffix, description: 'd', category: 'otros', estimatedMinutes: 30, referenceRate: 10.555 },
  });
  stages.push('service-created-with-validations');

  const shortService = await call('/services', {
    method: 'POST', token: admin, expected: 201,
    body: { operationId: randomUUID(), name: 'Diagnóstico ' + suffix, description: 'Escaneo de códigos', category: 'diagnostico', estimatedMinutes: 30, referenceRate: 60 },
  });
  created.services.push(shortService.service.id);
  const inactiveService = await call('/services', {
    method: 'POST', token: admin, expected: 201,
    body: { operationId: randomUUID(), name: 'Retirado ' + suffix, description: 'Servicio retirado', category: 'otros', estimatedMinutes: 60, referenceRate: 40 },
  });
  created.services.push(inactiveService.service.id);
  const deactivated = await call('/services/' + inactiveService.service.id + '/deactivate', {
    method: 'POST', token: admin, body: { operationId: randomUUID(), expectedVersion: 1 },
  });
  assert.equal(deactivated.service.active, false);
  stages.push('service-deactivation-keeps-the-row');

  const customers = [];
  for (const index of [1, 2, 3]) {
    const customer = await call('/customers', {
      method: 'POST', token: reception, expected: 201,
      body: { operationId: randomUUID(), firstName: 'Cliente', lastName: 'Cita' + index, document: 'C8' + index + suffix, phone: '+591 7000000' + index },
    });
    created.customers.push(customer.customer.id);
    const vehicle = await call('/vehicles', {
      method: 'POST', token: reception, expected: 201,
      body: { operationId: randomUUID(), customerId: customer.customer.id, plate: 'V' + index + suffix, make: 'Suzuki', model: 'Swift', year: 2021, fuelType: 'gasolina' },
    });
    created.vehicles.push(vehicle.vehicle.id);
    customers.push({ id: customer.customer.id, vehicleId: vehicle.vehicle.id });
  }
  stages.push('synthetic-customers-and-vehicles');

  const first = await call('/appointments', {
    method: 'POST', token: reception, expected: 201,
    body: { operationId: randomUUID(), customerId: customers[0].id, vehicleId: customers[0].vehicleId, serviceId: service.service.id, startsAt: at(9), notes: 'Primera cita' },
  });
  created.appointments.push(first.appointment.id);
  assert.equal(first.appointment.status, 'scheduled');
  assert.equal(new Date(first.appointment.endsAt).getTime(), new Date(first.appointment.startsAt).getTime() + 3600000);
  assert.ok(first.appointment.customerName && first.appointment.vehiclePlate && first.appointment.serviceName);
  stages.push('appointment-scheduled-with-duration');

  await call('/appointments', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), customerId: customers[0].id, vehicleId: customers[0].vehicleId, serviceId: service.service.id, startsAt: at(9) },
  }).then(body => assert.equal(body.code, 'APPOINTMENT_DUPLICATE'));
  await call('/appointments', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), customerId: customers[0].id, vehicleId: customers[0].vehicleId, serviceId: shortService.service.id, startsAt: at(9, 30) },
  }).then(body => assert.equal(body.code, 'APPOINTMENT_OVERLAP'));
  await call('/appointments', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), customerId: customers[0].id, vehicleId: customers[1].vehicleId, serviceId: service.service.id, startsAt: at(14) },
  }).then(body => assert.equal(body.code, 'VEHICLE_OWNERSHIP_MISMATCH'));
  await call('/appointments', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), customerId: customers[0].id, vehicleId: customers[0].vehicleId, serviceId: inactiveService.service.id, startsAt: at(16) },
  }).then(body => assert.equal(body.code, 'SERVICE_INACTIVE'));
  await call('/appointments', {
    method: 'POST', token: reception, expected: 400,
    body: { operationId: randomUUID(), customerId: customers[0].id, vehicleId: customers[0].vehicleId, serviceId: service.service.id, startsAt: '2026-12-01T09:00:00' },
  });
  stages.push('appointment-conflicts-and-validation');

  const second = await call('/appointments', {
    method: 'POST', token: reception, expected: 201,
    body: { operationId: randomUUID(), customerId: customers[1].id, vehicleId: customers[1].vehicleId, serviceId: service.service.id, startsAt: at(9) },
  });
  created.appointments.push(second.appointment.id);
  await call('/appointments', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), customerId: customers[2].id, vehicleId: customers[2].vehicleId, serviceId: service.service.id, startsAt: at(9) },
  }).then(body => assert.equal(body.code, 'WORKSHOP_CAPACITY_EXCEEDED'));
  stages.push('workshop-capacity-enforced');

  const late = await call('/appointments', {
    method: 'POST', token: head, expected: 201,
    body: { operationId: randomUUID(), customerId: customers[0].id, vehicleId: customers[0].vehicleId, serviceId: service.service.id, startsAt: at(13) },
  });
  created.appointments.push(late.appointment.id);
  await call('/appointments/' + first.appointment.id, {
    method: 'PUT', token: reception, expected: 409,
    body: { operationId: randomUUID(), expectedVersion: 1, startsAt: at(13, 30) },
  }).then(body => assert.equal(body.code, 'APPOINTMENT_OVERLAP'));
  const rescheduled = await call('/appointments/' + first.appointment.id, {
    method: 'PUT', token: reception,
    body: { operationId: randomUUID(), expectedVersion: 1, startsAt: at(11), notes: 'Reprogramada' },
  });
  assert.equal(rescheduled.appointment.version, 2);
  assert.equal(rescheduled.appointment.notes, 'Reprogramada');
  stages.push('reschedule-validates-availability');

  await call('/appointments/' + second.appointment.id + '/cancel', {
    method: 'POST', token: reception, expected: 400,
    body: { operationId: randomUUID(), expectedVersion: 1 },
  });
  const cancelled = await call('/appointments/' + second.appointment.id + '/cancel', {
    method: 'POST', token: reception,
    body: { operationId: randomUUID(), expectedVersion: 1, reason: 'El cliente no asistió' },
  });
  assert.equal(cancelled.appointment.status, 'cancelled');
  assert.equal(cancelled.appointment.cancelReason, 'El cliente no asistió');
  const freed = await call('/appointments', {
    method: 'POST', token: reception, expected: 201,
    body: { operationId: randomUUID(), customerId: customers[2].id, vehicleId: customers[2].vehicleId, serviceId: service.service.id, startsAt: at(9) },
  });
  created.appointments.push(freed.appointment.id);
  stages.push('cancellation-frees-the-slot');

  const window = await call('/appointments?from=' + encodeURIComponent(at(8)) + '&to=' + encodeURIComponent(at(15)), { token: reception });
  assert.ok(window.items.length >= 3);
  const cancelledOnly = await call('/appointments?status=cancelled', { token: head });
  assert.ok(cancelledOnly.items.every(item => item.status === 'cancelled'));
  await call('/appointments/00000000-0000-4000-8000-000000000000', { token: reception, expected: 404 });
  stages.push('appointment-queries');

  const audit = await db.query("SELECT count(*)::int AS count FROM operations.operations_history WHERE entity='appointment'");
  assert.ok(audit.rows[0].count >= 4);
  const serviceAudit = await db.query("SELECT count(*)::int AS count FROM operations.operations_history WHERE entity='service'");
  assert.ok(serviceAudit.rows[0].count >= 3);
  const unique = await db.query("SELECT count(*)::int AS count FROM operations.appointments WHERE status='scheduled' AND starts_at='2026-12-01T13:00:00Z'");
  assert.ok(unique.rows[0].count >= 1);
  stages.push('appointment-and-service-audit');

  console.log(JSON.stringify({ pass: true, stages, created }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 320) }));
  process.exitCode = 1;
} finally {
  try {
    for (const id of created.appointments) await db.query("UPDATE operations.appointments SET status='cancelled', cancel_reason=coalesce(cancel_reason,'cleanup') WHERE id=$1", [id]);
    for (const id of created.vehicles) await db.query("UPDATE operations.vehicles SET status='inactive' WHERE id=$1", [id]);
    for (const id of created.customers) await db.query("UPDATE operations.customers SET status='inactive' WHERE id=$1", [id]);
    for (const id of created.services) await db.query("UPDATE operations.service_catalog SET active=false WHERE id=$1", [id]);
    await db.end();
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}
