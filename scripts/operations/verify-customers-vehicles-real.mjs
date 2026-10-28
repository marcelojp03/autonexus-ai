/** CU06/CU07 real verification: Operations REST + PostgreSQL + Keycloak + Employee permission catalog. */
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
const suffix = randomUUID().slice(0, 8);
const document = ('C6' + suffix).toUpperCase();
const plate = ('P' + suffix).toUpperCase();
const stages = [];
const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });
let customerId, secondCustomerId, vehicleId, customerOperation;

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

  await call('/customers', { expected: 401 });
  await call('/customers', { token: mechanic, expected: 403 });
  const headList = await call('/customers', { token: head });
  assert.equal(headList.limit, 20);
  await call('/customers', { method: 'POST', token: head, body: { operationId: randomUUID(), firstName: 'A', lastName: 'B', document: ('ZZ' + suffix).toUpperCase(), phone: '+591 70000000' }, expected: 403 });
  stages.push('permissions-per-operation');

  const created = await call('/customers', {
    method: 'POST',
    token: reception,
    expected: 201,
    body: {
      operationId: randomUUID(), firstName: 'Lucía', lastName: 'Áñez', document,
      phone: '+591 712 34567', email: 'lucia@example.invalid', address: 'Av. Siempre Viva 123',
    },
  });
  customerId = created.customer.id;
  customerOperation = { operationId: randomUUID() };
  assert.equal(created.customer.document, document);
  assert.equal(created.customer.status, 'active');
  assert.equal(created.customer.version, 1);
  stages.push('customer-created-by-reception');

  await call('/customers', {
    method: 'POST', token: admin, expected: 409,
    body: { operationId: randomUUID(), firstName: 'Otro', lastName: 'Cliente', document, phone: '+591 70000001' },
  }).then(body => assert.equal(body.code, 'DUPLICATE_DOCUMENT'));
  await call('/customers', {
    method: 'POST', token: admin, expected: 400,
    body: { operationId: randomUUID(), firstName: 'Sin', lastName: 'Documento', phone: '+591 70000001' },
  });
  await call('/customers', {
    method: 'POST', token: admin, expected: 400,
    body: { operationId: randomUUID(), firstName: 'Con', lastName: 'Extra', document: ('X' + suffix).toUpperCase(), phone: '+591 70000001', status: 'active' },
  });
  stages.push('customer-validations');

  const found = await call('/customers?search=' + document, { token: admin });
  assert.ok(found.items.some(item => item.id === customerId));
  const byStatus = await call('/customers?status=active&limit=5', { token: admin });
  assert.ok(byStatus.items.length <= 5);

  const update = {
    operationId: randomUUID(), expectedVersion: 1, firstName: 'Lucía', lastName: 'Áñez Vargas',
    document, phone: '+591 712 34567', email: 'lucia.vargas@example.invalid', address: 'Av. Siempre Viva 123',
  };
  const updated = await call('/customers/' + customerId, { method: 'PUT', token: admin, body: update });
  assert.equal(updated.customer.version, 2);
  assert.equal(updated.customer.lastName, 'Áñez Vargas');
  await call('/customers/' + customerId, {
    method: 'PUT', token: admin, expected: 409,
    body: { ...update, operationId: randomUUID(), expectedVersion: 1 },
  }).then(body => assert.equal(body.code, 'VERSION_CONFLICT'));
  const replay = await call('/customers/' + customerId, { method: 'PUT', token: admin, body: update });
  assert.equal(replay.replayed, true);
  stages.push('customer-updated-with-version-and-replay');

  const vehicle = await call('/vehicles', {
    method: 'POST', token: reception, expected: 201,
    body: { operationId: randomUUID(), customerId, plate, make: 'Toyota', model: 'Corolla', year: 2019, fuelType: 'gasolina', color: 'Blanco' },
  });
  vehicleId = vehicle.vehicle.id;
  assert.equal(vehicle.vehicle.plate, plate);
  assert.equal(vehicle.vehicle.customerId, customerId);
  stages.push('vehicle-created-with-owner');

  await call('/vehicles', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), customerId, plate, make: 'Toyota', model: 'Hilux', year: 2020, fuelType: 'diesel' },
  }).then(body => assert.equal(body.code, 'DUPLICATE_PLATE'));
  await call('/vehicles', {
    method: 'POST', token: reception, expected: 404,
    body: { operationId: randomUUID(), customerId: randomUUID(), plate: ('Q' + suffix).toUpperCase(), make: 'Ford', model: 'F100', year: 2010, fuelType: 'diesel' },
  }).then(body => assert.equal(body.code, 'CUSTOMER_NOT_FOUND'));
  await call('/vehicles', {
    method: 'POST', token: reception, expected: 400,
    body: { operationId: randomUUID(), customerId, plate: ('R' + suffix).toUpperCase(), make: 'Ford', model: 'F100', year: 1900, fuelType: 'diesel' },
  });
  stages.push('vehicle-validations');

  const second = await call('/customers', {
    method: 'POST', token: reception, expected: 201,
    body: { operationId: randomUUID(), firstName: 'Marco', lastName: 'Rojas', document: ('C7' + suffix).toUpperCase(), phone: '+591 70000002' },
  });
  secondCustomerId = second.customer.id;
  const owner = await call('/vehicles/' + vehicleId, {
    method: 'PUT', token: admin,
    body: { operationId: randomUUID(), expectedVersion: 1, customerId: secondCustomerId, plate, make: 'Toyota', model: 'Corolla', year: 2019, fuelType: 'gasolina', color: 'Blanco' },
  });
  assert.equal(owner.vehicle.customerId, secondCustomerId);
  assert.equal(owner.vehicle.version, 2);
  const history = await db.query('SELECT customer_id, to_at FROM operations.vehicle_owners WHERE vehicle_id=$1 ORDER BY from_at', [vehicleId]);
  assert.equal(history.rows.length, 2);
  assert.equal(history.rows[0].customer_id, customerId);
  assert.ok(history.rows[0].to_at);
  assert.equal(history.rows[1].customer_id, secondCustomerId);
  assert.equal(history.rows[1].to_at, null);
  stages.push('vehicle-owner-change-is-traced');

  await call('/customers/' + customerId + '/deactivate', { method: 'POST', token: admin, body: { operationId: randomUUID(), expectedVersion: 2 } });
  await call('/vehicles', {
    method: 'POST', token: admin, expected: 409,
    body: { operationId: randomUUID(), customerId, plate: ('S' + suffix).toUpperCase(), make: 'Fiat', model: 'Uno', year: 2015, fuelType: 'gasolina' },
  }).then(body => assert.equal(body.code, 'CUSTOMER_INACTIVE'));
  stages.push('inactive-customer-blocks-new-vehicles');

  const audit = await db.query("SELECT count(*)::int AS count FROM operations.operations_history WHERE entity IN ('customer','vehicle')");
  assert.ok(audit.rows[0].count >= 4, 'audit rows expected');
  const operations = await db.query('SELECT count(*)::int AS count FROM operations.operations_operations');
  assert.ok(operations.rows[0].count >= 3, 'idempotency rows expected');
  stages.push('audit-and-idempotency-persisted');

  console.log(JSON.stringify({ pass: true, stages, customerId, vehicleId, document, plate, customerOperation: customerOperation.operationId }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 320) }));
  process.exitCode = 1;
} finally {
  try {
    for (const id of [vehicleId].filter(Boolean)) {
      await db.query("UPDATE operations.vehicles SET status='inactive' WHERE id=$1", [id]);
    }
    for (const id of [customerId, secondCustomerId].filter(Boolean)) {
      await db.query("UPDATE operations.customers SET status='inactive' WHERE id=$1", [id]);
    }
    await db.end();
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}
