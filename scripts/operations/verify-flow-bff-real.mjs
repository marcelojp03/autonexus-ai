/** Real BFF journey: reception -> work order -> quote -> decision through GraphQL. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
const primary = resolve(common.stdout.trim(), '..');
const accounts = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8'));
const bff = 'http://127.0.0.1:3004/graphql';
const suffix = randomUUID().slice(0, 8).toUpperCase();
const stages = [];

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
  const reception = await token('recepcionista');
  const finance = await token('responsable_financiero');
  const mechanic = await token('mecanico');
  const head = await token('jefe_taller');

  const customer = await graphql(reception,
    'mutation ($input: CreateCustomerInput!) { createCustomer(input: $input) { customer { id } } }',
    { input: { operationId: randomUUID(), firstName: 'Flujo', lastName: 'Completo', document: 'F9' + suffix, phone: '+591 70000020' } });
  const customerId = customer.data.createCustomer.customer.id;
  const vehicle = await graphql(reception,
    'mutation ($input: CreateVehicleInput!) { createVehicle(input: $input) { vehicle { id } } }',
    { input: { operationId: randomUUID(), customerId, plate: 'F9' + suffix, make: 'Kia', model: 'Rio', year: 2021, fuelType: 'gasolina' } });
  const vehicleId = vehicle.data.createVehicle.vehicle.id;
  const service = await graphql(head,
    'mutation ($input: CreateServiceInput!) { createService(input: $input) { service { id } } }',
    { input: { operationId: randomUUID(), name: 'Frenos ' + suffix, description: 'Servicio de frenos', category: 'reparacion', estimatedMinutes: 60, referenceRate: 200 } });
  const serviceId = service.data.createService.service.id;
  stages.push('graphql-fixtures');

  const received = await graphql(mechanic,
    'mutation ($input: CreateReceptionInput!) { createReception(input: $input) { reception { id mileage hasOrder version } } }',
    { input: { operationId: randomUUID(), vehicleId, mileage: 55000, reason: 'Ruido al frenar' } });
  assert.equal(received.errors, undefined);
  const receptionId = received.data.createReception.reception.id;
  stages.push('reception-through-graphql');

  const denied = await graphql(mechanic,
    'mutation ($input: CreateWorkOrderInput!) { createWorkOrder(input: $input) { order { id } } }',
    { input: { operationId: randomUUID(), receptionId, description: 'Sin permiso', priority: 'normal', services: [{ serviceId }] } });
  assert.equal(denied.errors[0].extensions.code, 'FORBIDDEN');

  const order = await graphql(reception,
    'mutation ($input: CreateWorkOrderInput!) { createWorkOrder(input: $input) { order { id number status items { serviceId referenceRate } } } }',
    { input: { operationId: randomUUID(), receptionId, description: 'Cambio de discos y pastillas', priority: 'alta', services: [{ serviceId, quantity: 1 }] } });
  assert.equal(order.errors, undefined);
  const created = order.data.createWorkOrder.order;
  assert.equal(created.status, 'pending_quote');
  assert.match(created.number, /^WO-\d{4}-\d{6}$/);
  assert.equal(created.items[0].referenceRate, 200);
  stages.push('order-through-graphql');

  const quote = await graphql(finance,
    'mutation ($input: CreateQuoteInput!) { createQuote(input: $input) { quote { id version status subtotal total } } }',
    { input: {
      operationId: randomUUID(), orderReference: created.id, orderNumber: created.number,
      customerReference: customerId, vehicleReference: vehicleId, vehiclePlate: 'F9' + suffix,
      discountPercent: 0, taxPercent: 13, validUntil: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      items: [{ serviceReference: serviceId, description: 'Cambio de discos y pastillas', quantity: 1, unitPrice: 200 }],
    } });
  assert.equal(quote.errors, undefined);
  const quoteId = quote.data.createQuote.quote.id;
  assert.equal(quote.data.createQuote.quote.subtotal, 200);
  assert.equal(quote.data.createQuote.quote.total, 226);
  stages.push('quote-through-graphql');

  const deniedDecision = await graphql(mechanic,
    'mutation ($id: UUID!, $input: DecideQuoteInput!) { decideQuote(id: $id, input: $input) { quote { id } } }',
    { id: quoteId, input: { operationId: randomUUID(), decision: 'approved', evidence: 'Presencial' } });
  assert.equal(deniedDecision.errors[0].extensions.code, 'FORBIDDEN');

  const decided = await graphql(reception,
    'mutation ($id: UUID!, $input: DecideQuoteInput!) { decideQuote(id: $id, input: $input) { quote { id status decision { decision evidence } } orderStatusHint } }',
    { id: quoteId, input: { operationId: randomUUID(), decision: 'approved', evidence: 'Aprobación presencial' } });
  assert.equal(decided.errors, undefined);
  assert.equal(decided.data.decideQuote.quote.status, 'approved');
  assert.equal(decided.data.decideQuote.orderStatusHint, 'quote_approved');
  stages.push('decision-through-graphql');

  const orders = await graphql(reception, '{ orders(limit: 5) { total items { number status } } }');
  assert.ok(orders.data.orders.items.some(item => item.number === created.number));
  const quotes = await graphql(finance, 'query ($ref: String) { quotes(orderReference: $ref) { total items { status } } }', { ref: created.id });
  assert.equal(quotes.data.quotes.items[0].status, 'approved');
  stages.push('queries-through-graphql');

  console.log(JSON.stringify({ pass: true, stages, orderNumber: created.number, quoteId }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 320) }));
  process.exitCode = 1;
}

setImmediate(() => process.exit(process.exitCode ?? 0));
