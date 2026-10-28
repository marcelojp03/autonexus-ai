/** CU13/CU14 real verification: versioned quotes and client decision in Finanzas. */
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
for (const line of readFileSync(resolve(primary, 'services/finance/.env'), 'utf8').split(/\r?\n/)) {
  const at = line.indexOf('=');
  if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1);
}
const api = 'http://127.0.0.1:8000';
const suffix = randomUUID().slice(0, 8);
const stages = [];
const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_DATABASE, user: env.DB_USERNAME, password: env.DB_PASSWORD });
const ids = { quote: null, version2: null };
const orderReference = 'order-' + suffix;

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
const validUntil = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

try {
  await db.connect();
  const finance = await token('responsable_financiero');
  const reception = await token('recepcionista');
  const mechanic = await token('mecanico');

  await call('/quotes', { expected: 401 });
  await call('/quotes', { token: mechanic, expected: 403 });
  const catalog = await call('/quotes', { token: reception });
  assert.equal(catalog.limit, 20);
  stages.push('permissions-per-operation');

  const payload = {
    orderReference,
    orderNumber: 'WO-2026-000777',
    customerReference: 'customer-' + suffix,
    vehicleReference: 'vehicle-' + suffix,
    vehiclePlate: 'F1' + suffix.toUpperCase().slice(0, 6),
    discountPercent: 10,
    taxPercent: 13,
    validUntil: validUntil(),
    items: [
      { serviceReference: 'service-a', description: 'Cambio de pastillas', quantity: 2, unitPrice: 150.5 },
      { serviceReference: 'service-b', description: 'Alineación', quantity: 1, unitPrice: 99.99 },
    ],
  };
  const operationId = randomUUID();
  const created = await call('/quotes', { method: 'POST', token: finance, body: { operationId, ...payload }, expected: 201 });
  ids.quote = created.quote.id;
  assert.equal(created.quote.status, 'pending');
  assert.equal(created.quote.version, 1);
  assert.equal(created.quote.items.length, 2);
  const subtotal = 2 * 150.5 + 99.99;
  assert.equal(created.quote.subtotal, subtotal);
  assert.equal(created.quote.discountAmount, Math.round(subtotal * 0.1 * 100) / 100);
  assert.equal(created.quote.total, Math.round((subtotal * 0.9 * 1.13) * 100) / 100);
  const replay = await call('/quotes', { method: 'POST', token: finance, body: { operationId, ...payload }, expected: 200 });
  assert.equal(replay.replayed, true);
  stages.push('quote-created-with-server-side-calculations');

  await call('/quotes', {
    method: 'POST', token: finance, expected: 400,
    body: { operationId: randomUUID(), ...payload, discountPercent: 25 },
  }).then(body => assert.equal(body.code, 'DISCOUNT_NOT_AUTHORIZED'));
  await call('/quotes', {
    method: 'POST', token: finance, expected: 400,
    body: { operationId: randomUUID(), ...payload, orderReference: orderReference + '-b', total: 1 },
  }).then(body => assert.equal(body.code, 'QUOTE_TOTAL_MISMATCH'));
  await call('/quotes', {
    method: 'POST', token: finance, expected: 400,
    body: { operationId: randomUUID(), ...payload, orderReference: orderReference + '-c', items: [] },
  }).then(body => assert.equal(body.code, 'QUOTE_ITEMS_INVALID'));
  stages.push('quote-validation');

  const revised = await call('/quotes/' + ids.quote + '/revisions', {
    method: 'POST', token: finance,
    body: {
      operationId: randomUUID(), expectedVersion: 1, discountPercent: 5, taxPercent: 13, validUntil: validUntil(),
      items: [{ serviceReference: 'service-a', description: 'Cambio de pastillas', quantity: 2, unitPrice: 150.5 }],
    },
  });
  ids.version2 = revised.quote.id;
  assert.equal(revised.quote.version, 2);
  const superseded = await call('/quotes/' + ids.quote, { token: finance });
  assert.equal(superseded.status, 'superseded');
  await call('/quotes/' + ids.quote + '/revisions', {
    method: 'POST', token: finance, expected: 409,
    body: { operationId: randomUUID(), expectedVersion: 1, items: [{ serviceReference: 'service-a', quantity: 1, unitPrice: 100 }] },
  }).then(body => assert.equal(body.code, 'QUOTE_NOT_PENDING'));
  stages.push('quote-versioning');

  await call('/quotes/' + ids.version2 + '/decision', {
    method: 'POST', token: reception, expected: 400,
    body: { operationId: randomUUID(), decision: 'approved' },
  });
  await call('/quotes/' + ids.version2 + '/decision', {
    method: 'POST', token: mechanic, expected: 403,
    body: { operationId: randomUUID(), decision: 'approved', evidence: 'Presencial' },
  });
  const approved = await call('/quotes/' + ids.version2 + '/decision', {
    method: 'POST', token: reception,
    body: { operationId: randomUUID(), decision: 'approved', evidence: 'Aprobación presencial en recepción' },
  });
  assert.equal(approved.quote.status, 'approved');
  assert.equal(approved.quote.decision.decision, 'approved');
  assert.equal(approved.orderStatusHint, 'quote_approved');
  await call('/quotes/' + ids.version2 + '/decision', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), decision: 'rejected', evidence: 'Cambio de opinión' },
  }).then(body => assert.equal(body.code, 'QUOTE_ALREADY_DECIDED'));
  await call('/quotes/' + ids.version2 + '/revisions', {
    method: 'POST', token: finance, expected: 409,
    body: { operationId: randomUUID(), expectedVersion: 2, items: [{ serviceReference: 'service-a', quantity: 1, unitPrice: 100 }] },
  }).then(body => assert.equal(body.code, 'QUOTE_APPROVED_IMMUTABLE'));
  stages.push('decision-approved-and-immutable');

  const expiring = await call('/quotes', {
    method: 'POST', token: finance, expected: 201,
    body: { operationId: randomUUID(), ...payload, orderReference: orderReference + '-exp', validUntil: validUntil() },
  });
  await db.query('UPDATE quotes SET valid_until = $2 WHERE id = $1', [expiring.quote.id, '2020-01-01']);
  await call('/quotes/' + expiring.quote.id + '/decision', {
    method: 'POST', token: reception, expected: 409,
    body: { operationId: randomUUID(), decision: 'rejected', evidence: 'Rechazo telefónico' },
  }).then(body => assert.equal(body.code, 'QUOTE_EXPIRED'));
  stages.push('expired-quote-rejected');

  const rejectedQuote = await call('/quotes', {
    method: 'POST', token: finance, expected: 201,
    body: { operationId: randomUUID(), ...payload, orderReference: orderReference + '-rej' },
  });
  const rejected = await call('/quotes/' + rejectedQuote.quote.id + '/decision', {
    method: 'POST', token: finance,
    body: { operationId: randomUUID(), decision: 'rejected', evidence: 'El cliente rechazó por teléfono', reason: 'Precio alto' },
  });
  assert.equal(rejected.quote.status, 'rejected');
  assert.equal(rejected.orderStatusHint, 'quote_rejected');
  stages.push('decision-rejected-keeps-evidence');

  const stored = await db.query('SELECT count(*)::int AS count FROM quote_decisions WHERE quote_id = ANY($1::uuid[])', [[ids.version2, rejectedQuote.quote.id]]);
  assert.equal(stored.rows[0].count, 2);
  const operations = await db.query('SELECT count(*)::int AS count FROM finance_operations');
  assert.ok(operations.rows[0].count >= 4);
  const versions = await db.query('SELECT version_number, status FROM quotes WHERE order_reference = $1 ORDER BY version_number', [orderReference]);
  assert.deepEqual(versions.rows.map(row => row.status), ['superseded', 'approved']);
  stages.push('decisions-and-versions-persisted');

  console.log(JSON.stringify({ pass: true, stages, ids, orderReference }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 320) }));
  process.exitCode = 1;
} finally {
  try {
    await db.end();
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}

setImmediate(() => process.exit(process.exitCode ?? 0));
