import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { expect, civilDate, pause } from './runtime.mjs';

export async function createFixtures(session, store) {
  const { api } = session;
  const date = civilDate(), marker = 'CU05-TEST-' + store.state.runId.slice(0, 8).toUpperCase();
  const create = async (owner, path, body, key, status = 201) => {
    const operationId = randomUUID();
    store.state.ownedResources.push({ owner, path, operationId, state: 'prepared' }); store.save();
    const value = expect(await api(owner, path, 'POST', { operationId, ...body }), status)[key];
    assert.ok(value?.id, 'Created resource must have an ID');
    Object.assign(store.state.ownedResources.at(-1), { id: value.id, state: 'created' }); store.save();
    return value;
  };
  async function employee(key, roleName, mechanicEnabled = false) {
    let e = await create('employees', '/employees', { firstName: 'CU05 TEST', lastName: marker + '-' + key, document: marker + '-' + key, email: (marker + '-' + key).toLowerCase() + '@example.invalid', phone: '+59170000005', jobTitle: 'Synthetic CU05 TEST', startDate: civilDate(0), specialties: ['CU05 diagnóstico'], mechanicEnabled, access: { requested: true } }, 'employee');
    const record = { key, employeeId: e.id, username: 'employee-' + e.id, password: 'Cu05-' + randomBytes(24).toString('hex'), createdInRun: true };
    store.state.accounts.push(record); store.save();
    for (let i = 0; i < 60 && e.access.status !== 'synced'; i++) { await pause(500); e = expect(await api('employees', '/employees/' + e.id), 200); }
    assert.equal(e.access.status, 'synced', 'Wait for CU03 IdP synchronization');
    assert.ok(e.access.subject); record.subject = e.access.subject; store.save();
    await session.setNewCredential(record);
    if (roleName) {
      const assignment = expect(await api('employees', '/security/employees/' + e.id + '/roles', 'POST', { operationId: randomUUID(), roleName }), 201).assignment;
      assert.equal(assignment.syncStatus, 'synced'); record.roleName = roleName; record.roleVersion = assignment.version; store.save();
    }
    await session.token(record, true);
    return { account: record, employee: e };
  }
  const a = await employee('A', 'mecanico', true), b = await employee('B', 'mecanico', true);
  const chief = await employee('CHIEF', 'jefe_taller');
  const noPermission = await employee('NOPERM', null);
  const inactive = await employee('INACTIVE', 'mecanico');
  const revoked = await employee('REVOKED', 'jefe_taller');
  assert.equal(new Set([a.account.subject, b.account.subject, chief.account.subject]).size, 3, 'Distinct human subjects required');
  for (const f of [a, b]) {
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay() || 7;
    expect(await api('employees', '/staffing/employees/' + f.employee.id + '/shifts', 'POST', { operationId: randomUUID(), weekday, startsAt: '22:00', endsAt: '23:59' }), 201);
  }
  async function createFlow(f, hour, quoteApproved = true, start = true, slot = {}) {
    const suffix = randomUUID().slice(0, 8).toUpperCase(), tag = marker + '-' + suffix;
    const flowDate = slot.date ?? date, customerDocument = 'C5' + suffix + store.state.runId.replaceAll('-', '').slice(0, 8).toUpperCase();
    const customer = await create('operations', '/customers', { firstName: 'CU05 TEST', lastName: tag, document: customerDocument, email: tag.toLowerCase() + '@example.invalid', phone: '+59170000005' }, 'customer');
    const vehicle = await create('operations', '/vehicles', { customerId: customer.id, plate: 'C5' + suffix, make: 'Kia', model: 'Synthetic CU05 TEST', year: 2024, fuelType: 'gasolina' }, 'vehicle');
    const service = await create('operations', '/services', { name: tag, description: 'Synthetic CU05 TEST', category: 'reparacion', estimatedMinutes: 30, referenceRate: 100 }, 'service');
    const reception = await create('operations', '/receptions', { vehicleId: vehicle.id, mileage: 15000, reason: tag, symptoms: 'Synthetic TEST', visibleConditions: 'No private photographs' }, 'reception');
    const priority = f === a ? 'alta' : 'normal';
    const order = await create('operations', '/orders', { receptionId: reception.id, description: tag, priority, notes: 'CU05 TEST <b>texto no HTML</b>', services: [{ serviceId: service.id, quantity: 1 }] }, 'order');
    let quote = await create('finance', '/quotes', { orderReference: order.id, orderNumber: order.number, customerReference: customer.id, vehicleReference: vehicle.id, vehiclePlate: vehicle.plate, validUntil: flowDate, notes: tag, items: [{ serviceReference: service.id, description: service.name, quantity: 1, unitPrice: 100 }] }, 'quote');
    if (quoteApproved) quote = await create('finance', '/quotes/' + quote.id + '/decision', { decision: 'approved', evidence: 'Synthetic explicit approval ' + tag }, 'quote', 200);
    const e = expect(await api('employees', '/employees/' + f.employee.id), 200);
    const startsAt = flowDate + 'T' + hour + ':00:00-04:00', endsAt = flowDate + 'T' + hour + ':30:00-04:00';
    const command = { operationId: randomUUID(), expectedVersion: order.version, quoteId: quote.id, quoteVersion: quote.version, employeeId: e.id, employeeVersion: e.version, requiredSpecialty: e.specialties[0], startsAt, endsAt };
    const flow = { marker: tag, date: flowDate, employeeId: e.id, orderId: order.id, orderNumber: order.number, quoteId: quote.id, vehicleId: vehicle.id, plate: vehicle.plate, serviceId: service.id, serviceName: service.name, startsAt, endsAt, priority, command };
    store.state.flows.push(flow); store.save();
    if (!start) return flow;
    const started = expect(await api('operations', '/orders/' + order.id + '/confirmations', 'POST', command), 202);
    assert.ok(started.sagaId); flow.sagaId = started.sagaId; store.save();
    let saga;
    for (let i = 0; i < 180; i++) {
      saga = expect(await api('operations', '/confirmations/' + flow.sagaId), 200);
      if (['confirmed', 'rejected'].includes(saga.status)) break;
      await pause(500);
    }
    assert.equal(saga.status, quoteApproved ? 'confirmed' : 'rejected', 'CU15 must reach a real terminal outcome');
    flow.terminalStatus = saga.status; store.save();
    if (!quoteApproved) {
      const steps = saga.steps;
      assert.ok(Array.isArray(steps), 'CU15 steps required as rejection evidence');
      assert.ok(steps.some(s => s.command === 'reserve_assignment' && s.outcome === 'applied'), 'E must reserve before F rejects');
      assert.ok(steps.some(s => s.command === 'authorize_quote' && s.outcome === 'rejected'), 'Real F rejection required');
    }
    return flow;
  }
  const jobs = [await createFlow(a, '23'), await createFlow(b, '23')];
  const rejected = await createFlow(a, '22', false);
  return { marker, date, a, b, chief, noPermission, inactive, revoked, jobs, rejected, createFlow, createEmployee: employee };
}
