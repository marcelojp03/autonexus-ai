/** Optional, privileged test-runner flow. Never a business service or startup seed. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

export async function main(args = process.argv.slice(2)) {
  assert.ok(args.includes('--run'));
  const { command, session } = await import('./demo.mjs');
  const phase = args.find(a => a.startsWith('--phase='))?.slice(8);
  assert.ok(['prepare', 'start', 'finish'].includes(phase));
  const demo = JSON.parse(readFileSync('/demo-state/manifest.json', 'utf8'));
  assert.ok(demo.completedAt);
  const admin = JSON.parse(readFileSync('/run/config/admin-account.json', 'utf8'));
  const transport = session(demo.publicOrigin, admin, {});
  const file = '/evidence/recovery.private.json';
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, demoScenarioId: demo.scenarioId, marker: 'RECOVERY-' + randomUUID().slice(0, 8).toUpperCase(), steps: {} };
  assert.equal(state.demoScenarioId, demo.scenarioId);
  const save = () => writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  const ledger = { state, save }; save();
  const report = { phase, INJECTED: phase !== 'prepare', pass: false, sameSaga: true };
  const poll = async (read, ready) => {
    for (let i = 0; i < 180; i++) { const value = await read(); if (ready(value)) return value; await pause(500); }
    throw new Error('RECOVERY_PROOF_TIMEOUT');
  };
  try {
    if (phase === 'prepare') {
      const { api } = transport, key = state.marker;
      const create = (name, owner, path, body, resultKey) => command(ledger, api, name, owner, path, body, resultKey);
      const customer = await create('customer', 'operations', '/customers', { firstName: 'Recuperación', lastName: key, document: key, email: key.toLowerCase() + '@example.invalid', phone: '+59170000000' }, 'customer');
      const vehicle = await create('vehicle', 'operations', '/vehicles', { customerId: customer.id, plate: key.replace('RECOVERY-', 'RC'), make: 'Kia', model: 'Prueba de recuperación', year: 2024, fuelType: 'gasolina' }, 'vehicle');
      const reception = await create('reception', 'operations', '/receptions', { vehicleId: vehicle.id, mileage: 10000, reason: key, symptoms: 'Control sintético de recuperación', visibleConditions: 'Sin fotografías' }, 'reception');
      const service = demo.steps['mechanicA.service'].result;
      const order = await create('order', 'operations', '/orders', { receptionId: reception.id, description: key, priority: 'normal', notes: 'Prueba de recuperación Docker, no dato demo inicial', services: [{ serviceId: service.id, quantity: 1 }] }, 'order');
      const quote = await create('quote', 'finance', '/quotes', { orderReference: order.id, orderNumber: order.number, customerReference: customer.id, vehicleReference: vehicle.id, vehiclePlate: vehicle.plate, validUntil: demo.date, notes: key, items: [{ serviceReference: service.id, description: service.name, quantity: 1, unitPrice: service.referenceRate }] }, 'quote');
      const approved = await create('approval', 'finance', '/quotes/' + quote.id + '/decision', { decision: 'approved', evidence: 'Aprobación sintética para ' + key }, 'quote');
      const employee = await api('employees', '/employees/' + demo.accounts.mechanicA.employeeId);
      state.startCommand ??= { operationId: randomUUID(), expectedVersion: order.version, quoteId: approved.id, quoteVersion: approved.version, employeeId: employee.id, employeeVersion: employee.version, requiredSpecialty: 'Diagnóstico general', startsAt: demo.date + 'T10:00:00-04:00', endsAt: demo.date + 'T10:30:00-04:00' };
      state.orderId = order.id; state.prepared = true; save();
      report.fixtureOnly = true;
    } else if (phase === 'start') {
      assert.equal(state.prepared, true);
      let financeAvailable = false;
      try { financeAvailable = (await fetch('http://finance:8000/health/ready', { signal: AbortSignal.timeout(2000) })).ok; } catch {}
      assert.equal(financeAvailable, false, 'Main must stop only the isolated Finance before starting this case');
      const result = await transport.api('operations', '/orders/' + state.orderId + '/confirmations', 'POST', state.startCommand);
      assert.ok(result.sagaId); if (state.sagaId) assert.equal(result.sagaId, state.sagaId);
      state.sagaId = result.sagaId; save();
      const pending = await poll(() => transport.api('operations', '/confirmations/' + state.sagaId), s => s.status === 'recovery_pending');
      assert.ok(pending.steps.some(step => step.command === 'reserve_assignment' && step.outcome === 'applied'));
      assert.ok(!pending.steps.some(step => step.outcome === 'rejected'));
      const actor = await transport.login(demo.accounts.mechanicA);
      const agenda = await fetch('http://operations:8081/agenda/me?from=' + demo.date + '&to=' + demo.date, { headers: { Authorization: 'Bearer ' + actor.token }, signal: AbortSignal.timeout(15000) });
      assert.equal(agenda.status, 200);
      assert.ok(!(await agenda.json()).items.some(item => item.orderId === state.orderId), 'A provisional reservation must not appear as globally confirmed work');
      state.pendingObserved = true; save(); report.status = pending.status;
      report.provisionalWorkHidden = true;
    } else {
      assert.equal(state.pendingObserved, true);
      const saga = await poll(() => transport.api('operations', '/confirmations/' + state.sagaId), s => ['confirmed', 'rejected'].includes(s.status));
      assert.equal(saga.status, 'confirmed');
      const order = await transport.api('operations', '/orders/' + state.orderId);
      assert.equal(order.status, 'confirmed');
      let job;
      await poll(async () => {
        const identity = await transport.login(demo.accounts.mechanicA);
        const response = await fetch('http://operations:8081/agenda/me?from=' + demo.date + '&to=' + demo.date, { headers: { Authorization: 'Bearer ' + identity.token }, signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200);
        const page = await response.json(); const matches = page.items.filter(item => item.orderId === state.orderId);
        assert.ok(matches.length <= 1); job = matches[0]; return job;
      }, item => item?.confirmationObservation === 'observed');
      state.confirmedObserved = true; state.assignmentId = job.assignmentId; save();
      report.status = saga.status; report.orderConfirmed = true; report.inboxObserved = true;
    }
    report.pass = true; report.sagaId = state.sagaId; report.orderId = state.orderId;
  } finally {
    writeFileSync('/evidence/recovery-' + phase + '.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('FAIL recovery proof ' + (error.name === 'AssertionError' ? 'ASSERTION' : 'EXECUTION') + '; private diagnostics omitted'); process.exitCode = 1; });
}
