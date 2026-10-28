/** CU11/CU12 real verification: reception, inspection and work orders in Operations. */
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
const ids = { customer: null, vehicle: null, service: null, reception: null, order: null };

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

try {
  await db.connect();
  const admin = await token('administrador');
  const reception = await token('recepcionista');
  const head = await token('jefe_taller');
  const mechanic = await token('mecanico');

  await call('/receptions', { expected: 401 });
  const customer = await call('/customers', {
    method: 'POST', token: reception, expected: 201,
    body: { operationId: randomUUID(), firstName: 'Recepción', lastName: 'Flujo', document: 'C1' + suffix, phone: '+591 70000010' },
  });
  ids.customer = customer.customer.id;
  const vehicle = await call('/vehicles', {
    method: 'POST', token: reception, expected: 201,
    body: { operationId: randomUUID(), customerId: ids.customer, plate: 'R1' + suffix, make: 'Mazda', model: 'CX5', year: 2022, fuelType: 'gasolina' },
  });
  ids.vehicle = vehicle.vehicle.id;
  const service = await call('/services', {
    method: 'POST', token: head, expected: 201,
    body: { operationId: randomUUID(), name: 'Pastillas ' + suffix, description: 'Cambio de pastillas delanteras', category: 'reparacion', estimatedMinutes: 90, referenceRate: 320.75 },
  });
  ids.service = service.service.id;
  stages.push('fixtures-created');

  const received = await call('/receptions', {
    method: 'POST', token: mechanic, expected: 201,
    body: { operationId: randomUUID(), vehicleId: ids.vehicle, mileage: 84500, reason: 'Ruido al frenar en pendiente', symptoms: 'Vibración del pedal', visibleConditions: 'Pastillas al límite' },
  });
  ids.reception = received.reception.id;
  assert.equal(received.reception.mileage, 84500);
  assert.equal(received.reception.hasOrder, false);
  await call('/receptions', {
    method: 'POST', token: mechanic, expected: 409,
    body: { operationId: randomUUID(), vehicleId: ids.vehicle, mileage: 84600, reason: 'Segunda recepción abierta' },
  }).then(body => assert.equal(body.code, 'VEHICLE_ALREADY_IN_RECEPTION'));
  await call('/receptions', {
    method: 'POST', token: reception, expected: 400,
    body: { operationId: randomUUID(), vehicleId: ids.vehicle, mileage: 100, reason: 'ok' },
  });
  stages.push('reception-registered-with-open-guard');

  await call('/orders', {
    method: 'POST', token: mechanic, expected: 403,
    body: { operationId: randomUUID(), receptionId: ids.reception, description: 'Mecánico no crea órdenes', priority: 'normal', services: [{ serviceId: ids.service }] },
  });
  const order = await call('/orders', {
    method: 'POST', token: reception, expected: 201,
    body: { operationId: randomUUID(), receptionId: ids.reception, description: 'Cambio de pastillas y discos delanteros', priority: 'alta', notes: 'Cliente espera el vehículo', services: [{ serviceId: ids.service, quantity: 1 }] },
  });
  ids.order = order.order.id;
  assert.match(order.order.number, /^WO-\d{4}-\d{6}$/);
  assert.equal(order.order.status, 'pending_quote');
  assert.equal(order.order.items.length, 1);
  assert.equal(order.order.items[0].referenceRate, 320.75);
  assert.equal(order.order.vehiclePlate, 'R1' + suffix);
  stages.push('order-created-pending-quote');

  await call('/orders', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), receptionId: ids.reception, description: 'Orden repetida', priority: 'normal', services: [{ serviceId: ids.service }] },
  }).then(body => assert.equal(body.code, 'ORDER_ALREADY_EXISTS'));
  await call('/orders', {
    method: 'POST', token: reception, expected: 400,
    body: { operationId: randomUUID(), receptionId: ids.reception, description: 'Sin servicios', priority: 'normal', services: [] },
  });
  const inactive = await call('/services', {
    method: 'POST', token: admin, expected: 201,
    body: { operationId: randomUUID(), name: 'Retirado ' + suffix, description: 'Servicio retirado', category: 'otros', estimatedMinutes: 30, referenceRate: 50 },
  });
  await call('/services/' + inactive.service.id + '/deactivate', { method: 'POST', token: admin, body: { operationId: randomUUID(), expectedVersion: 1 } });
  const secondReception = await call('/receptions', {
    method: 'POST', token: reception, expected: 201,
    body: { operationId: randomUUID(), vehicleId: ids.vehicle, mileage: 84500, reason: 'Revisión posterior al trabajo' },
  });
  await call('/orders', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), receptionId: secondReception.reception.id, description: 'Servicio inactivo', priority: 'normal', services: [{ serviceId: inactive.service.id }] },
  }).then(body => assert.equal(body.code, 'SERVICE_INACTIVE'));
  stages.push('order-guards-and-inactive-service');

  await call('/receptions', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), vehicleId: ids.vehicle, mileage: 84000, reason: 'Kilometraje anterior al último' },
  }).then(body => assert.equal(body.code, 'MILEAGE_REGRESSION'));
  const lowMileage = await call('/receptions?vehicleId=' + ids.vehicle + '&open=false', { token: reception });
  assert.ok(lowMileage.items.length >= 1);
  stages.push('reception-history-query');

  const updated = await call('/services/' + ids.service, {
    method: 'PUT', token: head,
    body: { operationId: randomUUID(), expectedVersion: 1, name: 'Pastillas ' + suffix, description: 'Cambio de pastillas delanteras', category: 'reparacion', estimatedMinutes: 90, referenceRate: 999.99 },
  });
  assert.equal(updated.service.referenceRate, 999.99);
  const reread = await call('/orders/' + ids.order, { token: reception });
  assert.equal(reread.items[0].referenceRate, 320.75, 'the order must keep the rate copied at creation');
  stages.push('order-keeps-copied-rate');

  const audit = await db.query("SELECT entity, count(*)::int AS count FROM operations.operations_history WHERE entity IN ('reception','work-order') GROUP BY entity");
  assert.ok(audit.rows.length >= 2, 'reception and order audit expected');
  const items = await db.query('SELECT count(*)::int AS count FROM operations.work_order_items WHERE order_id=$1', [ids.order]);
  assert.equal(items.rows[0].count, 1);
  stages.push('audit-and-items-persisted');

  console.log(JSON.stringify({ pass: true, stages, ids }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 320) }));
  process.exitCode = 1;
} finally {
  try {
    if (ids.order) await db.query("UPDATE operations.work_orders SET status='cancelled' WHERE id=$1", [ids.order]);
    if (ids.vehicle) {
      await db.query('UPDATE operations.vehicle_receptions SET has_order = true WHERE vehicle_id = $1', [ids.vehicle]);
      await db.query("UPDATE operations.vehicles SET status='inactive' WHERE id=$1", [ids.vehicle]);
    }
    if (ids.customer) await db.query("UPDATE operations.customers SET status='inactive' WHERE id=$1", [ids.customer]);
    if (ids.service) await db.query('UPDATE operations.service_catalog SET active=false WHERE id=$1', [ids.service]);
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}

// Node keeps undici keep-alive sockets alive; do not let the wrapper wait on them.
setImmediate(() => process.exit(process.exitCode ?? 0));
