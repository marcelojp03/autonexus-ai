/** Real owner-API fixture and assertions. Output is ignored and append-only across phases.
 * No SQL business writes; command operation IDs survive verifier retries. */
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {login} from './provision-scheduler.mjs';
import {internal} from '../mcp/local-admin.mjs';

const dir = resolve('output/cu28/catalogue'); mkdirSync(dir, {recursive: true});
const file = resolve(dir, 'fixture.json');
const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
  runId: randomUUID(), operations: {}, resources: {}, observations: [],
};
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
const accounts = JSON.parse(readFileSync('output/stack/live-demo/accounts.json', 'utf8')).accounts;
accounts.admin = JSON.parse(readFileSync('output/cu27/fixture/admin-test.private.json', 'utf8')).accounts.adminTest;
accounts.scheduler = JSON.parse(readFileSync('output/cu28/scheduler/identity.private.json', 'utf8'));
const tokens = new Map();
const bases = {operations: 'http://operations:8081', finance: 'http://finance:8000', employees: 'http://employees:3002', agent: 'http://agent:3099'};
export async function api(service, path, account = 'chief', method = 'GET', body) {
  let issued = tokens.get(account);
  if (!issued || issued.expiresAt < Date.now() + 10000) {
    const issuedTokens = await login(accounts[account]);
    issued = {token: issuedTokens.access_token, expiresAt: Date.now() + issuedTokens.expires_in * 1000};
    tokens.set(account, issued);
  }
  const result = internal(bases[service] + path, {token: issued.token, method, body});
  if (![200, 201, 202].includes(result.status))
    throw new Error(service + ':' + path + ':HTTP_' + result.status + ':' + (result.data?.code ?? result.data?.error?.code ?? 'UNKNOWN'));
  return result.data;
}
async function command(key, service, path, account, body, field) {
  state.operations[key] ??= randomUUID(); save();
  if (state.resources[key]) return state.resources[key];
  const result = await api(service, path, account, 'POST', {...body, operationId: state.operations[key]});
  state.resources[key] = field ? result[field] : result; save();
  assert.ok(state.resources[key], key + ' missing response field ' + field);
  return state.resources[key];
}
const date = (days) => {
  const civil = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  return new Date(Date.parse(civil + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
};
const observe = (name, detail) => {const result = {name, observedAt: new Date().toISOString(), ...detail};
  state.observations.push(result); save(); console.log(JSON.stringify(result));};

async function fixture() {
  const tag = 'CU28-' + state.runId.slice(0, 8);
  const customer = await command('customer', 'operations', '/customers', 'reception',
    {firstName: 'Cliente', lastName: tag, document: tag, email: tag.toLowerCase() + '@example.invalid', phone: '+59170000001'}, 'customer');
  const vehicle = await command('vehicle', 'operations', '/vehicles', 'reception',
    {customerId: customer.id, plate: 'AT' + state.runId.slice(0, 6).toUpperCase(), make: 'Toyota', model: 'Prueba', year: 2024, fuelType: 'gasolina'}, 'vehicle');
  const service = await command('service', 'operations', '/services', 'chief',
    {name: tag, description: 'Fixture de automatización local', category: 'reparacion', estimatedMinutes: 30, referenceRate: 150}, 'service');
  const reception = await command('reception', 'operations', '/receptions', 'reception',
    {vehicleId: vehicle.id, mileage: 1000, reason: tag, symptoms: 'Prueba', visibleConditions: 'Sintético'}, 'reception');
  const order = await command('order', 'operations', '/orders', 'reception',
    {receptionId: reception.id, description: tag, priority: 'normal', notes: 'Conservar fixture CU28', services: [{serviceId: service.id, quantity: 1}]}, 'order');
  for (const key of ['quote', 'quoteDue', 'quoteStale']) {
    let quoteOrder = order;
    if (key !== 'quote') {
      const quoteReception = await command(key + 'Reception', 'operations', '/receptions', 'reception',
        {vehicleId: vehicle.id, mileage: 1000, reason: tag + key, symptoms: 'Prueba', visibleConditions: 'Sintético'}, 'reception');
      quoteOrder = await command(key + 'Order', 'operations', '/orders', 'reception',
        {receptionId: quoteReception.id, description: tag + key, priority: 'normal', notes: tag, services: [{serviceId: service.id, quantity: 1}]}, 'order');
    }
    await command(key, 'finance', '/quotes', 'finance', {orderReference: quoteOrder.id, orderNumber: quoteOrder.number,
      customerReference: customer.id, vehicleReference: vehicle.id, vehiclePlate: vehicle.plate,
      validUntil: date(14), notes: tag + ':' + key, items: [{serviceReference: service.id, description: tag, quantity: 1, unitPrice: 150}]}, 'quote');
  }
  for (const [key, hour] of [['appointment', '10:00'], ['appointmentStale', '11:00']])
    await command(key, 'operations', '/appointments', 'reception', {customerId: customer.id, vehicleId: vehicle.id, serviceId: service.id, startsAt: date(1) + 'T' + hour + ':00-04:00', notes: tag}, 'appointment');
  observe('real-fixture-created', {customerId: customer.id, orderId: order.id,
    appointmentId: state.resources.appointment.id, quoteId: state.resources.quoteDue.id});
}

async function assignment() {
  const order = state.resources.order, quote = state.resources.quote;
  const approved = await command('quoteApproval', 'finance', '/quotes/' + quote.id + '/decision', 'finance',
    {expectedVersion: quote.version, decision: 'approved', evidence: 'Aprobación explícita sintética CU28'}, 'quote');
  const mechanic = await api('employees', '/employees/' + accounts.mechanicB.employeeId, 'admin');
  const day = date(2), weekday = new Date(day + 'T12:00:00Z').getUTCDay() || 7;
  const schedule = await api('employees', '/staffing/employees/' + mechanic.id + '/schedule', 'chief');
  if (!schedule.shifts.some(s => s.weekday === weekday && s.active && s.startsAt <= '14:00' && s.endsAt >= '14:30'))
    await command('mechanicShift', 'employees', '/staffing/employees/' + mechanic.id + '/shifts', 'chief', {weekday, startsAt: '08:00', endsAt: '17:00'}, 'shift');
  const currentOrder = await api('operations', '/orders/' + order.id);
  const saga = await command('confirmation', 'operations', '/orders/' + order.id + '/confirmations', 'chief',
    {expectedVersion: currentOrder.version, quoteId: approved.id, quoteVersion: approved.version, employeeId: mechanic.id, employeeVersion: mechanic.version,
      requiredSpecialty: 'Diagnóstico general', startsAt: day + 'T14:00:00-04:00', endsAt: day + 'T14:30:00-04:00'});
  observe('saga-triggered', {orderId: order.id, sagaId: saga.sagaId, operationId: state.operations.confirmation});
}

async function triggers() {
  const reminders = await api('operations', '/automations/appointments/reminders', 'scheduler', 'POST', {});
  const quotes = await api('finance', '/automations/quotes/pending', 'scheduler', 'POST', {});
  state.reminders = reminders; state.quoteNotices = quotes; save();
  observe('due-owner-triggers', {reminders, quotes});
  const repeatReminder = await api('operations', '/automations/appointments/reminders', 'scheduler', 'POST', {});
  const repeatQuote = await api('finance', '/automations/quotes/pending', 'scheduler', 'POST', {});
  assert.deepEqual(repeatReminder.events, reminders.events);
  assert.deepEqual(repeatQuote.events, quotes.events);
  observe('owner-trigger-repeat-same-identifiers', {pass: true});
}

async function invalidate() {
  const staleAppointment = state.resources.appointmentStale;
  const current = await api('operations', '/appointments/' + staleAppointment.id, 'reception');
  await command('cancelStale', 'operations', '/appointments/' + staleAppointment.id + '/cancel', 'reception',
    {expectedVersion: current.version, reason: 'Cancelación explícita del fixture antes del aviso'}, 'appointment');
  const staleQuote = state.resources.quoteStale;
  const quote = await api('finance', '/quotes/' + staleQuote.id, 'finance');
  await command('rejectStaleQuote', 'finance', '/quotes/' + staleQuote.id + '/decision', 'finance',
    {expectedVersion: quote.version, decision: 'rejected', evidence: 'Rechazo explícito del fixture antes del aviso', reason: 'No continuar'}, 'quote');
  observe('business-records-invalidated-before-retry', {appointmentId: staleAppointment.id, quoteId: staleQuote.id});
}

const phase = process.argv[2];
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) try {
  if (phase === 'fixture') await fixture();
  else if (phase === 'assignment') await assignment();
  else if (phase === 'triggers') await triggers();
  else if (phase === 'invalidate') await invalidate();
  else throw new Error('use fixture | assignment | triggers | invalidate');
} catch (error) { observe('verifier-abort', {phase, message: error.message}); process.exitCode = 1; }
