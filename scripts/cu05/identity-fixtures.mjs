import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { expect, pause, civilDate } from './runtime.mjs';

export async function createIdentityFixture(session, store, { key, roleName, mechanicEnabled = false, marker }) {
  assert.match(key, /^[A-Z][A-Z0-9-]{0,19}$/);
  marker ??= 'CU05-TEST-' + store.state.runId.slice(0, 8).toUpperCase();
  assert.match(marker, /^CU05-TEST-[A-F0-9]{8}$/);
  const document = marker + '-' + key;
  const command = { operationId: randomUUID(), firstName: 'CU05 TEST', lastName: document, document, email: document.toLowerCase() + '@example.invalid', phone: '+59170000005', jobTitle: 'Synthetic CU05 identity TEST', startDate: civilDate(0), specialties: ['CU05 diagnóstico'], mechanicEnabled, access: { requested: true } };
  const owned = { kind: 'CU05-owned-identity-control-zero-jobs', marker, key, document, operationId: command.operationId, created: false };
  store.state.ownedResources.push(owned); store.save();
  let employee = expect(await session.api('employees', '/employees', 'POST', command), 201).employee;
  assert.ok(employee?.id); assert.equal(employee.document, document); owned.employeeId = employee.id; owned.created = true;
  const account = { key, employeeId: employee.id, username: 'employee-' + employee.id, password: 'Cu05-' + randomBytes(24).toString('hex'), createdInRun: true };
  store.state.accounts.push(account); store.save();
  for (let i = 0; i < 60 && employee.access.status !== 'synced'; i++) { await pause(500); employee = expect(await session.api('employees', '/employees/' + employee.id), 200); }
  assert.equal(employee.access.status, 'synced'); assert.ok(employee.access.subject); assert.equal(employee.status, 'active');
  account.subject = employee.access.subject; owned.subject = employee.access.subject; owned.version = employee.version; store.save();
  await session.setNewCredential(account);
  if (roleName) {
    const roleCommand = { operationId: randomUUID(), roleName }; owned.roleCommand = roleCommand; store.save();
    let assignment = expect(await session.api('employees', '/security/employees/' + employee.id + '/roles', 'POST', roleCommand), 201).assignment;
    for (let i = 0; i < 60 && assignment.syncStatus !== 'synced'; i++) {
      await pause(500);
      const page = expect(await session.api('employees', '/security/employees/' + employee.id + '/roles'), 200);
      assignment = page.items.find(item => item.roleName === roleName && item.status === 'active'); assert.ok(assignment);
    }
    assert.equal(assignment.syncStatus, 'synced'); account.roleName = roleName; account.roleVersion = assignment.version; owned.roleVersion = assignment.version; store.save();
  }
  await session.token(account, true);
  return { account, employee };
}
