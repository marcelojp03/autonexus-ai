import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request, userToken, technicalToken } from './runtime.mjs';

const cache = new Map();
const refreshing = new Map();
export async function tokenFor(role = 'administrador') {
  const previous = cache.get(role);
  if (previous && previous.expiresAt > Date.now() + 20000) return previous.token;
  if (!refreshing.has(role)) refreshing.set(role, (async () => {
    const token = role === 'technical' ? await technicalToken() : await userToken(role);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    assert.ok(Number.isFinite(claims.exp), 'Token must have an expiry');
    cache.set(role, { token, expiresAt: claims.exp * 1000 });
    return token;
  })().finally(() => refreshing.delete(role)));
  return refreshing.get(role);
}

export async function api(owner, path, method = 'GET', body, role = 'administrador') {
  const ports = { operations: 8081, employees: 3002, finance: 8000, bff: 3004 };
  assert.ok(Object.hasOwn(ports, owner));
  return request('http://127.0.0.1:' + ports[owner] + path, await tokenFor(role), method, body);
}

function laPazDate(offset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + offset * 86400000));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
async function create(owner, path, body, key, status = 201) {
  const response = await api(owner, path, 'POST', { operationId: randomUUID(), ...body });
  assert.equal(response.status, status, owner + path + ': ' + (response.body.code ?? 'unexpected response'));
  assert.ok(response.body[key]?.id, path + ' must return the real ' + key);
  return response.body[key];
}

export async function createFlow({ prefix = 'CU15', mechanicEnabled = true, quoteApproved = true, employee: suppliedEmployee, slot = {} } = {}) {
  assert.equal(process.versions.node, '22.22.3', 'Use Node 22.22.3');
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const marker = 'CU15-' + prefix.replace(/[^a-z0-9]/gi, '').slice(0, 10) + '-' + suffix;
  const date = slot.date ?? laPazDate(7);
  const startsAt = slot.startsAt ?? date + 'T10:00:00-04:00';
  const endsAt = slot.endsAt ?? date + 'T11:00:00-04:00';
  const customer = await create('operations', '/customers', { firstName: 'CU15', lastName: marker, document: 'CU15' + suffix, email: marker.toLowerCase() + '@example.invalid', phone: '+59170000015' }, 'customer');
  const vehicle = await create('operations', '/vehicles', { customerId: customer.id, plate: 'C1' + suffix, make: 'Kia', model: 'Sintético CU15', year: 2024, fuelType: 'gasolina' }, 'vehicle');
  const service = await create('operations', '/services', { name: marker, description: 'Servicio 100% sintético CU15', category: 'reparacion', estimatedMinutes: 60, referenceRate: 100 }, 'service');
  const reception = await create('operations', '/receptions', { vehicleId: vehicle.id, mileage: 15000, reason: marker, symptoms: 'Prueba sintética', visibleConditions: 'Sin fotografías privadas' }, 'reception');
  const order = await create('operations', '/orders', { receptionId: reception.id, description: marker, priority: 'normal', notes: 'Prerrequisito sintético CU15', services: [{ serviceId: service.id, quantity: 1 }] }, 'order');
  let quote = await create('finance', '/quotes', { orderReference: order.id, orderNumber: order.number, customerReference: customer.id, vehicleReference: vehicle.id, vehiclePlate: vehicle.plate, validUntil: date, notes: marker, items: [{ serviceReference: service.id, description: service.name, quantity: 1, unitPrice: 100 }] }, 'quote');
  if (quoteApproved) {
    quote = await create('finance', '/quotes/' + quote.id + '/decision', { decision: 'approved', evidence: 'Aprobación sintética explícita ' + marker }, 'quote', 200);
    assert.equal(quote.status, 'approved');
  }
  let employee;
  if (suppliedEmployee) {
    const actual = await api('employees', '/employees/' + suppliedEmployee.id);
    assert.equal(actual.status, 200);
    employee = actual.body;
  } else {
    employee = await create('employees', '/employees', { firstName: 'CU15', lastName: marker, document: marker, email: marker.toLowerCase() + '@example.invalid', phone: '+59170000015', jobTitle: 'Mecánico sintético CU15', startDate: laPazDate(), specialties: ['CU15 diagnóstico'], mechanicEnabled, access: { requested: false } }, 'employee');
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay() || 7;
    const shift = await api('employees', '/staffing/employees/' + employee.id + '/shifts', 'POST', { operationId: randomUUID(), weekday, startsAt: '09:00', endsAt: '18:00', breakStart: '12:00', breakEnd: '13:00' });
    assert.equal(shift.status, 201, 'Synthetic shift must be persisted');
  }
  const requiredSpecialty = employee.specialties[0];
  assert.ok(requiredSpecialty);
  const command = { operationId: randomUUID(), expectedVersion: order.version, quoteId: quote.id, quoteVersion: quote.version, employeeId: employee.id, employeeVersion: employee.version, requiredSpecialty, startsAt, endsAt };
  return { marker, customer, vehicle, service, reception, order, quote, employee, date, startsAt, endsAt, requiredSpecialty, command };
}
