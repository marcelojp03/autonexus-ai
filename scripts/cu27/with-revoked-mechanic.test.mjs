import test from 'node:test';
import assert from 'node:assert/strict';
import { createWithRevokedMechanic } from './with-revoked-mechanic.mjs';

const copy = value => structuredClone(value);
function harness(options = {}) {
  let clock = 2000000000000, sequence = 0, released = false, abort, savedRestore, companionRole;
  const origin = 'http://127.0.0.1:4286';
  const mechanic = { employeeId: '11111111-1111-4111-8111-111111111111', subject: 'mechanic-subject', username: 'mechanic', password: 'PRIVATE_PASSWORD' };
  const assignment = { id: '22222222-2222-4222-8222-222222222222', roleName: 'mecanico', employeeId: mechanic.employeeId, subject: mechanic.subject, status: 'active', syncStatus: 'synced', version: 3 };
  const employee = { id: mechanic.employeeId, version: 4, status: 'active', access: { status: 'synced', subject: mechanic.subject } };
  const role = { name: 'mecanico', version: 5, syncStatus: 'synced', permissions: ['executions:write', 'agenda:read:self'] };
  const assignments = { employeeId: mechanic.employeeId, subject: mechanic.subject, items: [copy(assignment)] };
  const state = { origin, mechanic, fixture: { version: 1, origin, ownerMarker: 'CU27-' + 'a'.repeat(32), accounts: { adminTest: { username: 'cu27-synthetic-admin-test', password: 'PRIVATE_PASSWORD', subject: 'admin-subject', enabled: true, roles: ['administrador'] } } }, preflight: { pkce: true, revocationPerformed: false, targetEmployeeId: mechanic.employeeId, targetSubject: mechanic.subject, roleVersion: 5, roleSyncStatus: 'synced', assignment: copy(assignment), employee: copy(employee), restoration: { authorizationProbeStatus: 400, authorizationProbeCode: 'VALIDATION_ERROR' }, originalAccountsUnchanged: true } };
  const calls = [], journals = [], logins = [];
  const io = {
    now: () => clock, id: () => 'operation-' + ++sequence,
    lock: async () => () => { released = true; }, load: async () => state,
    journal: j => journals.push(copy(j)), unchanged: () => {},
    issuer: async () => origin + '/identity/realms/autonexus',
    sleep: async ms => { clock += ms; }, schedule: fn => { abort = fn; return 1; }, cancel: () => {},
    authorize: async (account, config) => {
      const roles = account.subject === 'admin-subject' ? ['administrador'] : assignments.items.filter(a => a.status === 'active').map(a => a.roleName);
      logins.push({ subject: account.subject, roles: [...roles] });
      return 'header.' + Buffer.from(JSON.stringify({ sub: account.subject, iss: config.issuer, exp: clock / 1000 + 60, realm_access: { roles }, jti: ++sequence })).toString('base64url') + '.signature';
    },
    async owner(path, { token, method = 'GET', body }) {
      calls.push({ path, method, body: copy(body) });
      const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      if (path === '/security/permissions') {
        if (c.sub === 'admin-subject') return { status: 200, data: { effective: ['security:read', 'security:write', ...role.permissions] } };
        if (!assignments.items.some(a => a.status === 'active')) {
          if (options.denialStatus) return { status: options.denialStatus, data: { statusCode: options.denialStatus, message: 'Forbidden' } };
          if (options.noDenial) return { status: 200, data: { effective: role.permissions } };
        }
        const effective = [...new Set(assignments.items.filter(a => a.status === 'active' && c.realm_access.roles.includes(a.roleName)).flatMap(a => a.roleName === 'mecanico' ? role.permissions : companionRole?.permissions ?? []))];
        return { status: 200, data: { effective } };
      }
      if (path.startsWith('/employees/')) return { status: 200, data: copy(employee) };
      if (path === '/security/roles/mecanico') return { status: 200, data: copy(role) };
      if (path.startsWith('/security/roles/cu27_test_sync_')) return companionRole ? { status: 200, data: { ...copy(companionRole), assignedCount: assignments.items.filter(a => a.roleName === companionRole.name && a.status === 'active').length } } : { status: 404, data: {} };
      if (path === '/security/roles' && method === 'POST') {
        companionRole = { ...copy(body), system: false, version: 1, assignedCount: 0, syncStatus: 'synced' };
        return { status: 201, data: { role: copy(companionRole) } };
      }
      if (method === 'GET') return { status: 200, data: copy(assignments) };
      if (!body.operationId) return { status: options.probeStatus ?? 400, data: { code: 'VALIDATION_ERROR' } };
      if (path.endsWith('/revoke')) {
        const name = path.split('/').at(-2);
        const target = assignments.items.find(a => a.roleName === name && a.status === 'active');
        assert.equal(body.expectedVersion, target.version);
        target.status = 'revoked';
        target.version++;
        if (options.lostRevoke && name === 'mecanico') throw new Error('PRIVATE_RESPONSE_BODY');
        return { status: 200, data: { assignment: copy(target) } };
      }
      if (body.roleName?.startsWith('cu27_test_sync_')) {
        const added = { ...assignment, id: '44444444-4444-4444-8444-444444444444', roleName: body.roleName, version: 1 };
        assignments.items.push(added);
        if (options.lostCompanionAssign) throw new Error('PRIVATE_RESPONSE_BODY');
        return { status: 201, data: { assignment: copy(added) } };
      }
      if (options.restoreFails) return { status: 503, data: { message: 'PRIVATE_RESPONSE_BODY' } };
      if (savedRestore) return copy(savedRestore);
      assignments.items.push({ ...assignment, id: '33333333-3333-4333-8333-333333333333', version: 1 });
      savedRestore = { status: 201, data: { assignment: copy(assignments.items.at(-1)) } };
      if (options.lostRestore) throw new Error('PRIVATE_RESPONSE_BODY');
      return copy(savedRestore);
    },
  };
  const runDefault = createWithRevokedMechanic(io);
  return { run: (callback, options) => runDefault(callback, { routingCompanion: false, ...options }), runDefault, io, state, role, assignments, employee, calls, journals, logins, abort: () => abort(), released: () => released };
}
const mutations = h => h.calls.filter(c => c.body?.operationId);

test('revokes only the exact assignment, waits for denial, restores and recovers through fresh PKCE', async () => {
  const h = harness();
  const value = await h.run(async context => {
    assert.equal(h.assignments.items[0].status, 'revoked');
    assert.equal(h.journals.at(-1).denialConfirmed, true);
    assert.deepEqual(Object.keys(context).sort(), ['deadline', 'employeeId', 'origin', 'signal', 'subject']);
    assert.equal(context.signal.aborted, false);
    return 42;
  });
  assert.equal(value, 42);
  const [revoke, restore] = mutations(h);
  assert.equal(mutations(h).length, 2);
  assert.equal(revoke.body.expectedVersion, 3);
  assert.notEqual(revoke.body.operationId, restore.body.operationId);
  assert.equal(restore.body.roleName, 'mecanico');
  assert.deepEqual(h.logins.filter(l => l.subject === h.state.mechanic.subject).map(l => l.roles), [['mecanico'], [], ['mecanico']]);
  assert.equal(h.journals.at(-1).pass, true);
  assert.equal(h.released(), true);
  assert.doesNotMatch(JSON.stringify(h.journals), /PRIVATE|password|token|mechanic-subject/);
});

test('callback failure is sanitized but restoration completes', async () => {
  const h = harness();
  await assert.rejects(h.run(async () => { throw new Error('PRIVATE_PASSWORD'); }), error => error.message === 'CALLBACK_FAILED' && !error.stack.includes('PRIVATE_PASSWORD'));
  assert.equal(h.journals.at(-1).restorationConfirmed, true);
});

test('lost revoke response still compensates committed mutation', async () => {
  const h = harness({ lostRevoke: true });
  await assert.rejects(h.run(async () => assert.fail('must not run')), /PRIVATE_OPERATION_FAILED/);
  assert.equal(mutations(h).length, 2);
  assert.equal(h.journals.at(-1).restorationConfirmed, true);
});

test('cooperative timeout never restores until the callback has settled', async () => {
  const h = harness();
  await assert.rejects(h.run(async ({ signal }) => {
    h.abort();
    await Promise.resolve();
    assert.equal(signal.aborted, true);
    assert.equal(mutations(h).length, 1);
  }), /CALLBACK_TIMEOUT/);
  assert.equal(mutations(h).length, 2);
  assert.equal(h.journals.at(-1).restorationConfirmed, true);
});

for (const [name, change, code] of [
  ['origin', h => { h.state.fixture.origin = 'http://127.0.0.1:4285'; }, 'FIXTURE_ORIGIN_DRIFT'],
  ['issuer', h => { h.io.issuer = async () => 'wrong'; }, 'CURRENT_ISSUER_DRIFT'],
  ['subject', h => { h.employee.access.subject = 'other'; }, 'EMPLOYEE_ACCESS_DRIFT'],
  ['inactive employee', h => { h.employee.status = 'inactive'; }, 'EMPLOYEE_ACCESS_DRIFT'],
  ['unsynced assignment', h => { h.assignments.items[0].syncStatus = 'pending'; }, 'ASSIGNMENT_DRIFT'],
  ['preflight version', h => { h.state.preflight.roleVersion++; }, 'PREFLIGHT_DRIFT'],
  ['extra active role', h => { h.assignments.items.push({ ...h.assignments.items[0], roleName: 'other' }); }, 'ASSIGNMENT_DRIFT'],
  ['escalation', h => { const original = h.io.owner; h.io.owner = async (path, args) => path === '/security/permissions' ? { status: 200, data: { effective: ['security:read', 'security:write'] } } : original(path, args); }, 'RESTORE_PERMISSION_ESCALATION'],
]) test('rejects ' + name + ' drift before mutation', async () => {
  const h = harness(); change(h);
  await assert.rejects(h.run(async () => assert.fail('must not run')), new RegExp(code));
  assert.equal(mutations(h).length, 0);
  assert.equal(h.released(), true);
});

test('live restoration authorization probe is mandatory', async () => {
  const h = harness({ probeStatus: 403 });
  await assert.rejects(h.run(async () => assert.fail('must not run')), /RESTORE_ROUTE_NOT_AUTHORIZED/);
  assert.equal(mutations(h).length, 0);
});

test('401 is never accepted as effective permission denial', async () => {
  const h = harness({ denialStatus: 401 });
  await assert.rejects(h.run(async () => assert.fail('must not run')), /DENIAL_NOT_AUTHORIZATION/);
  assert.equal(h.journals.at(-1).restorationConfirmed, true);
});

test('authorization 403 is accepted only after owner assignment is synced revoked', async () => {
  const h = harness({ denialStatus: 403 });
  await h.run(async () => {});
  assert.equal(h.journals.at(-1).pass, true);
});

test('denial timeout still restores without invoking callback', async () => {
  const h = harness({ noDenial: true });
  await assert.rejects(h.run(async () => assert.fail('must not run'), { pollTimeoutMs: 1000 }), /DENIAL_TIMEOUT/);
  assert.equal(h.journals.at(-1).restorationConfirmed, true);
});

test('restoration failure is explicit and sanitized', async () => {
  const h = harness({ restoreFails: true });
  await assert.rejects(h.run(async () => {}), /RESTORE_NOT_CONFIRMED/);
  assert.equal(h.journals.at(-1).pass, false);
  assert.equal(h.journals.at(-1).restorationConfirmed, false);
  assert.doesNotMatch(JSON.stringify(h.journals), /PRIVATE_RESPONSE_BODY/);
});

test('invalid timeout is rejected before any IO', async () => {
  const h = harness();
  await assert.rejects(h.run(async () => {}, { callbackTimeoutMs: 0 }), /CALLBACK_TIMEOUT_INVALID/);
  assert.equal(h.calls.length, 0);
});

test('lost restoration response replays the same fresh compensation operationId', async () => {
  const h = harness({ lostRestore: true });
  await h.run(async () => {});
  const [revoke, restore, replay] = mutations(h);
  assert.notEqual(revoke.body.operationId, restore.body.operationId);
  assert.deepEqual(restore.body, replay.body);
  assert.equal(h.assignments.items.filter(a => a.status === 'active').length, 1);
  assert.equal(h.journals.at(-1).restorationConfirmed, true);
});

test('REST assignment fields not selected in GraphQL preflight do not cause false drift', async () => {
  const h = harness();
  h.assignments.items[0].assignedAt = '2033-05-18T03:33:20.000Z';
  h.assignments.items[0].assignedBy = 'synthetic-actor';
  h.assignments.items[0].syncErrorCode = null;
  await h.run(async () => {});
  assert.equal(h.journals.at(-1).pass, true);
});

test('a pending revoke is polled until synced before callback', async () => {
  const h = harness();
  const owner = h.io.owner;
  let reads = 0;
  h.io.owner = async (path, args) => {
    if (path.endsWith('/revoke')) {
      const result = await owner(path, args);
      h.assignments.items[0].syncStatus = 'pending';
      return result;
    }
    if (args.method === 'GET' && path.endsWith('/roles') && h.assignments.items[0].status === 'revoked' && ++reads === 2) h.assignments.items[0].syncStatus = 'synced';
    return owner(path, args);
  };
  await h.run(async () => { assert.ok(reads >= 2); });
  assert.equal(h.journals.at(-1).pass, true);
});

test('recovery cannot pass when fresh mechanic permissions remain empty', async () => {
  const h = harness();
  const owner = h.io.owner;
  h.io.owner = async (path, args) => {
    const result = await owner(path, args);
    const c = JSON.parse(Buffer.from(args.token.split('.')[1], 'base64url'));
    if (path === '/security/permissions' && c.sub === h.state.mechanic.subject && h.assignments.items.length > 1) result.data.effective = [];
    return result;
  };
  await assert.rejects(h.run(async () => {}, { pollTimeoutMs: 1000 }), /RECOVERY_TIMEOUT/);
  assert.equal(h.journals.at(-1).restorationConfirmed, false);
});

test('journal failure after revoke cannot prevent compensation', async () => {
  const h = harness();
  const journal = h.io.journal;
  h.io.journal = value => {
    if (value.denialConfirmed && !value.restorationConfirmed) throw new Error('PRIVATE_DISK_ERROR');
    journal(value);
  };
  await assert.rejects(h.run(async () => assert.fail('must not run')), /PRIVATE_OPERATION_FAILED/);
  assert.equal(mutations(h).length, 2);
  assert.equal(h.journals.at(-1).restorationConfirmed, true);
});

test('matching pending shared-role baseline is preserved without mutating that role', async () => {
  const h = harness();
  h.role.syncStatus = h.state.preflight.roleSyncStatus = 'pending';
  await h.run(async () => {});
  assert.equal(h.role.syncStatus, 'pending');
  assert.equal(h.journals.at(-1).pass, true);
  assert.ok(h.calls.every(call => call.method === 'GET' || !call.path.startsWith('/security/roles')));
});

test('pending role baseline must match the recorded preflight', async () => {
  const h = harness();
  h.role.syncStatus = 'pending';
  await assert.rejects(h.run(async () => assert.fail('must not run')), /PREFLIGHT_DRIFT/);
  assert.equal(mutations(h).length, 0);
});

test('default companion preserves fresh-token routing but grants no owner write permissions', async () => {
  const h = harness();
  h.role.syncStatus = h.state.preflight.roleSyncStatus = 'pending';
  await h.runDefault(async () => {
    const active = h.assignments.items.filter(a => a.status === 'active');
    assert.equal(active.length, 1);
    assert.match(active[0].roleName, /^cu27_test_sync_/);
    assert.deepEqual(h.logins.filter(l => l.subject === h.state.mechanic.subject).at(-1).roles, [active[0].roleName]);
  });
  assert.deepEqual(h.assignments.items.filter(a => a.status === 'active').map(a => a.roleName), ['mecanico']);
  assert.equal(h.journals.at(-1).companionCleanupConfirmed, true);
  assert.equal(h.journals.at(-1).pass, true);
  const create = mutations(h).find(call => call.path === '/security/roles');
  assert.deepEqual(create.body.permissions, ['agenda:read:self']);
  assert.ok(h.calls.every(call => !['PUT', 'DELETE'].includes(call.method) && !call.path.includes('retry-sync')));
});

test('companion assignment is removed even when its response was lost before main revocation', async () => {
  const h = harness({ lostCompanionAssign: true });
  await assert.rejects(h.runDefault(async () => assert.fail('must not run')), /PRIVATE_OPERATION_FAILED/);
  assert.deepEqual(h.assignments.items.filter(a => a.status === 'active').map(a => a.roleName), ['mecanico']);
  assert.equal(h.journals.at(-1).companionCleanupConfirmed, true);
  assert.equal(h.journals.at(-1).revokeAttempted, false);
});

test('companion cleanup and mechanic restoration both run after callback failure', async () => {
  const h = harness();
  await assert.rejects(h.runDefault(async () => { throw new Error('PRIVATE_CALLBACK'); }), /CALLBACK_FAILED/);
  assert.equal(h.journals.at(-1).companionCleanupConfirmed, true);
  assert.equal(h.journals.at(-1).restorationConfirmed, true);
  assert.deepEqual(h.assignments.items.filter(a => a.status === 'active').map(a => a.roleName), ['mecanico']);
});

test('a foreign companion role is rejected without altering its definition or assignments', async () => {
  const h = harness();
  const owner = h.io.owner;
  h.io.owner = (path, args) => path.startsWith('/security/roles/cu27_test_sync_') ? { status: 200, data: { name: path.split('/').at(-1), system: false, version: 1, assignedCount: 0, permissions: ['agenda:read:self'], description: 'not our fixture' } } : owner(path, args);
  await assert.rejects(h.runDefault(async () => assert.fail('must not run')), /COMPANION_ROLE_DRIFT/);
  assert.equal(mutations(h).length, 0);
});

test('companion cleanup is attempted even if mechanic restoration fails', async () => {
  const h = harness({ restoreFails: true });
  await assert.rejects(h.runDefault(async () => {}), /RESTORE_NOT_CONFIRMED/);
  assert.equal(h.journals.at(-1).companionCleanupConfirmed, true);
  assert.equal(h.journals.at(-1).restorationConfirmed, false);
  assert.ok(h.assignments.items.every(a => a.status === 'revoked'));
});

test('failed shared-role baseline is rejected rather than repaired', async () => {
  const h = harness();
  h.role.syncStatus = h.state.preflight.roleSyncStatus = 'failed';
  await assert.rejects(h.runDefault(async () => assert.fail('must not run')), /ROLE_DRIFT/);
  assert.equal(mutations(h).length, 0);
});
