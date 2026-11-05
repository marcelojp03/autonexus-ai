import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const fixturePath = 'output/cu27/fixture/admin-test.private.json';
const preflightPath = 'output/cu27/fixture/admin-preflight.private.json';
const accountsPath = 'output/stack/cu16-proof.accounts.private.json';
const lockPath = 'output/cu27/revoked-mechanic.lock';
const origins = [4285, 4286, 4280].map(port => 'http://127.0.0.1:' + port);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class SafeFailure extends Error {
  constructor(code) { super(code); this.name = 'RevokedMechanicError'; this.stack = this.name + ': ' + code; }
}
const ensure = (condition, code) => { if (!condition) throw new SafeFailure(code); };
const safe = error => error instanceof SafeFailure ? error : new SafeFailure('PRIVATE_OPERATION_FAILED');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameAssignment = (a, b) => ['id', 'roleName', 'employeeId', 'subject', 'status', 'syncStatus', 'version'].every(key => a?.[key] === b?.[key]);
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && same([...a].sort(), [...b].sort());
const claims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));

// Dependency injection keeps the lifecycle tests entirely disconnected from runtime.
export function createWithRevokedMechanic(io) {
  return async function withRevokedMechanic(callback, { callbackTimeoutMs = 300000, pollTimeoutMs = 45000, routingCompanion = true } = {}) {
    ensure(typeof callback === 'function', 'CALLBACK_REQUIRED');
    ensure(Number.isSafeInteger(callbackTimeoutMs) && callbackTimeoutMs > 0 && callbackTimeoutMs <= 900000, 'CALLBACK_TIMEOUT_INVALID');
    ensure(Number.isSafeInteger(pollTimeoutMs) && pollTimeoutMs > 0 && pollTimeoutMs <= 120000, 'POLL_TIMEOUT_INVALID');
    ensure(typeof routingCompanion === 'boolean', 'COMPANION_OPTION_INVALID');
    const journal = { version: 1, runId: io.id(), startedAt: new Date(io.now()).toISOString(), revokeAttempted: false, denialConfirmed: false, callbackCompleted: false, restorationConfirmed: false };
    let release, state, baseline, failure, value, cleanupCompanion;
    const record = () => io.journal(journal);
    try {
      release = await io.lock();
      record();
      state = await io.load();
      const { fixture, mechanic, preflight, origin } = state;
      const admin = fixture?.accounts?.adminTest;
      const issuer = origin + '/identity/realms/autonexus';
      ensure(origins.includes(origin) && fixture.origin === origin && fixture.version === 1, 'FIXTURE_ORIGIN_DRIFT');
      ensure(/^CU27-[a-f0-9]{32}$/.test(fixture.ownerMarker) && admin?.username === 'cu27-synthetic-admin-test' && admin.enabled === true && sameSet(admin.roles, ['administrador']), 'ADMIN_FIXTURE_DRIFT');
      ensure(uuid.test(mechanic?.employeeId) && typeof mechanic.subject === 'string' && mechanic.subject.length > 0 && admin.subject && admin.subject !== mechanic.subject, 'MECHANIC_FIXTURE_DRIFT');
      ensure(await io.issuer(origin) === issuer, 'CURRENT_ISSUER_DRIFT');
      const login = async (account, role) => {
        const token = await io.authorize({ ...account, enabled: true }, { issuer, redirect: origin + '/auth/callback' });
        const c = claims(token);
        ensure(c.iss === issuer && c.sub === account.subject && c.exp * 1000 > io.now() + 5000 && (!role || c.realm_access?.roles?.includes(role)), 'PKCE_IDENTITY_DRIFT');
        return token;
      };
      const adminRequest = async (path, method = 'GET', body) => io.owner(path, { token: await login(admin, 'administrador'), method, body });
      const get = async path => {
        const r = await adminRequest(path);
        ensure(r.status === 200, 'OWNER_READ_FAILED');
        return r.data;
      };
      const route = '/security/employees/' + mechanic.employeeId + '/roles';
      const read = async () => ({ employee: await get('/employees/' + mechanic.employeeId), assignments: await get(route), role: await get('/security/roles/mecanico') });
      const mapping = snapshot => {
        ensure(snapshot.employee.id === mechanic.employeeId && snapshot.employee.status === 'active' && snapshot.employee.access?.status === 'synced' && snapshot.employee.access.subject === mechanic.subject, 'EMPLOYEE_ACCESS_DRIFT');
        ensure(snapshot.assignments.employeeId === mechanic.employeeId && snapshot.assignments.subject === mechanic.subject && snapshot.assignments.items.every(a => a.employeeId === mechanic.employeeId && a.subject === mechanic.subject), 'ASSIGNMENT_MAPPING_DRIFT');
      };
      baseline = await read();
      mapping(baseline);
      const active = baseline.assignments.items.filter(a => a.status === 'active');
      ensure(active.length === 1 && active[0].roleName === 'mecanico' && active[0].syncStatus === 'synced' && uuid.test(active[0].id) && Number.isSafeInteger(active[0].version) && active[0].version > 0, 'ASSIGNMENT_DRIFT');
      const assignment = active[0];
      ensure(baseline.role.name === 'mecanico' && ['synced', 'pending'].includes(baseline.role.syncStatus) && baseline.role.permissions.includes('executions:write'), 'ROLE_DRIFT');
      ensure(preflight?.pkce === true && preflight.revocationPerformed === false && preflight.targetEmployeeId === mechanic.employeeId && preflight.targetSubject === mechanic.subject && preflight.roleVersion === baseline.role.version && preflight.roleSyncStatus === baseline.role.syncStatus && sameAssignment(preflight.assignment, assignment) && preflight.employee?.version === baseline.employee.version && preflight.restoration?.authorizationProbeStatus === 400 && preflight.restoration.authorizationProbeCode === 'VALIDATION_ERROR' && preflight.originalAccountsUnchanged === true, 'PREFLIGHT_DRIFT');
      const catalog = await get('/security/permissions');
      ensure(catalog.effective.includes('security:read') && catalog.effective.includes('security:write') && baseline.role.permissions.every(p => catalog.effective.includes(p)), 'RESTORE_PERMISSION_ESCALATION');
      const probe = await adminRequest(route, 'POST', {});
      ensure(probe.status === 400 && probe.data?.code === 'VALIDATION_ERROR', 'RESTORE_ROUTE_NOT_AUTHORIZED');
      const mechanicToken = await login(mechanic, 'mecanico');
      const beforePermissions = await io.owner('/security/permissions', { token: mechanicToken });
      ensure(beforePermissions.status === 200 && sameSet(beforePermissions.data.effective, baseline.role.permissions), 'MECHANIC_PERMISSION_DRIFT');
      ensure(same(await read(), baseline), 'PREFLIGHT_CHANGED');
      io.unchanged(state);

      const poll = async (check, code) => {
        const deadline = io.now() + pollTimeoutMs;
        do {
          if (await check()) return;
          await io.sleep(750);
        } while (io.now() < deadline);
        throw new SafeFailure(code);
      };
      const unchangedRoleAndMapping = snapshot => {
        mapping(snapshot);
        ensure(snapshot.employee.version === baseline.employee.version && snapshot.role.version === baseline.role.version && snapshot.role.syncStatus === baseline.role.syncStatus && sameSet(snapshot.role.permissions, baseline.role.permissions), 'RESTORE_STATE_DRIFT');
        ensure(same(snapshot.assignments.items.filter(a => a.roleName !== 'mecanico'), baseline.assignments.items.filter(a => a.roleName !== 'mecanico')), 'OTHER_ASSIGNMENTS_DRIFT');
      };
      const companionName = routingCompanion ? 'cu27_test_sync_' + fixture.ownerMarker.slice(5) : null;
      let verifyCompanion = async () => {};
      if (companionName) {
        const companionPath = '/security/roles/' + companionName;
        const description = 'CU27 synthetic routing ' + fixture.ownerMarker;
        const permissions = ['agenda:read:self'];
        ensure(catalog.effective.includes(permissions[0]) && baseline.role.permissions.includes(permissions[0]), 'COMPANION_PERMISSION_DRIFT');
        journal.companionRoleName = companionName;
        journal.companionCreateOperationId = io.id();
        journal.companionAssignOperationId = io.id();
        journal.companionRevokeOperationId = io.id();
        record();
        let companion = await adminRequest(companionPath);
        if (companion.status === 404) {
          const created = await adminRequest('/security/roles', 'POST', { operationId: journal.companionCreateOperationId, name: companionName, description, permissions });
          ensure(created.status === 201, 'COMPANION_CREATE_FAILED');
          companion = await adminRequest(companionPath);
          journal.companionRoleCreated = true;
        }
        const ownedRole = (role, count = 0) => role?.name === companionName && role.description === description && role.system === false && role.version === 1 && role.assignedCount === count && sameSet(role.permissions, permissions);
        ensure(companion.status === 200 && ownedRole(companion.data), 'COMPANION_ROLE_DRIFT');
        await poll(async () => {
          const role = await get(companionPath);
          ensure(ownedRole(role), 'COMPANION_ROLE_DRIFT');
          return role.syncStatus === 'synced';
        }, 'COMPANION_ROLE_SYNC_TIMEOUT');
        const priorIds = new Set(baseline.assignments.items.map(a => a.id));
        cleanupCompanion = async () => {
          const current = await read();
          mapping(current);
          const added = current.assignments.items.filter(a => a.roleName === companionName && !priorIds.has(a.id));
          ensure(added.length <= 1 && !current.assignments.items.some(a => a.roleName === companionName && a.status === 'active' && priorIds.has(a.id)), 'COMPANION_CLEANUP_DRIFT');
          if (added[0]?.status === 'active') {
            const target = added[0];
            ensure(target.version === 1, 'COMPANION_CLEANUP_DRIFT');
            const revoke = () => adminRequest(route + '/' + companionName + '/revoke', 'POST', { operationId: journal.companionRevokeOperationId, expectedVersion: target.version });
            let result;
            try { result = await revoke(); } catch { result = await revoke(); }
            ensure(result.status === 200, 'COMPANION_REVOKE_FAILED');
          }
          await poll(async () => {
            const snapshot = await read();
            mapping(snapshot);
            const added = snapshot.assignments.items.filter(a => a.roleName === companionName && !priorIds.has(a.id));
            ensure(added.length <= 1, 'COMPANION_CLEANUP_DRIFT');
            return added.every(a => a.status === 'revoked' && a.syncStatus === 'synced');
          }, 'COMPANION_CLEANUP_TIMEOUT');
          const role = await get(companionPath);
          ensure(ownedRole(role) && role.syncStatus === 'synced', 'COMPANION_ROLE_DRIFT');
          journal.companionCleanupConfirmed = true;
          if (journal.restorationConfirmed || !journal.revokeAttempted) {
            await poll(async () => {
              const r = await io.owner('/security/permissions', { token: await login(mechanic, 'mecanico') });
              return r.status === 200 && sameSet(r.data?.effective, beforePermissions.data.effective);
            }, 'POST_COMPANION_RECOVERY_TIMEOUT');
          }
          io.unchanged(state);
        };
        journal.companionAssignmentAttempted = true;
        record();
        const assigned = await adminRequest(route, 'POST', { operationId: journal.companionAssignOperationId, roleName: companionName });
        ensure([200, 201].includes(assigned.status), 'COMPANION_ASSIGN_FAILED');
        await poll(async () => {
          const snapshot = await read();
          mapping(snapshot);
          const added = snapshot.assignments.items.filter(a => a.roleName === companionName && !priorIds.has(a.id));
          ensure(added.length === 1 && added[0].status === 'active', 'COMPANION_ASSIGNMENT_DRIFT');
          return added[0].syncStatus === 'synced';
        }, 'COMPANION_ASSIGNMENT_SYNC_TIMEOUT');
        const prepared = await read();
        ensure(same(prepared.employee, baseline.employee) && same(prepared.role, baseline.role) && same(prepared.assignments.items.filter(a => priorIds.has(a.id)), baseline.assignments.items), 'COMPANION_SETUP_DRIFT');
        baseline.assignments = prepared.assignments;
        verifyCompanion = async () => {
          const role = await get(companionPath);
          ensure(ownedRole(role, 1) && role.syncStatus === 'synced', 'COMPANION_ROLE_DRIFT');
        };
        await verifyCompanion();
        const token = await login(mechanic, companionName);
        const check = await io.owner('/security/permissions', { token });
        ensure(check.status === 200 && sameSet(check.data?.effective, beforePermissions.data.effective), 'COMPANION_BASELINE_DRIFT');
      }
      journal.revokeOperationId = io.id();
      journal.restoreOperationId = io.id();
      record();
      try {
        journal.revokeAttempted = true;
        record();
        const revoked = await adminRequest(route + '/mecanico/revoke', 'POST', { operationId: journal.revokeOperationId, expectedVersion: assignment.version });
        ensure(revoked.status === 200 && revoked.data?.assignment?.id === assignment.id && revoked.data.assignment.status === 'revoked', 'REVOKE_NOT_CONFIRMED');
        await poll(async () => {
          const snapshot = await read();
          unchangedRoleAndMapping(snapshot);
          await verifyCompanion();
          const target = snapshot.assignments.items.find(a => a.id === assignment.id);
          ensure(target?.status === 'revoked' && target.version === assignment.version + 1 && !snapshot.assignments.items.some(a => a.status === 'active' && a.roleName !== companionName), 'REVOKED_ASSIGNMENT_DRIFT');
          const r = await io.owner('/security/permissions', { token: await login(mechanic, companionName) });
          ensure(r.status === 200 || r.status === 403, 'DENIAL_NOT_AUTHORIZATION');
          return target.syncStatus === 'synced' && (companionName ? r.status === 200 && sameSet(r.data?.effective, ['agenda:read:self']) : r.status === 403 || (Array.isArray(r.data?.effective) && r.data.effective.length === 0));
        }, 'DENIAL_TIMEOUT');
        journal.denialConfirmed = true;
        record();
        const controller = new AbortController();
        const deadline = io.now() + callbackTimeoutMs;
        const timer = io.schedule(() => controller.abort(), callbackTimeoutMs);
        try {
          // Aborting is cooperative: never race compensation against unfinished UI work.
          value = await callback(Object.freeze({ origin, employeeId: mechanic.employeeId, subject: mechanic.subject, signal: controller.signal, deadline }));
          ensure(!controller.signal.aborted && io.now() < deadline, 'CALLBACK_TIMEOUT');
          journal.callbackCompleted = true;
        } catch (error) {
          throw error instanceof SafeFailure ? error : new SafeFailure('CALLBACK_FAILED');
        } finally { io.cancel(timer); }
      } finally {
        journal.restorationAttempted = true;
        // Even a lost revoke response may have committed; inspect owner state before compensating.
        const snapshot = await read();
        unchangedRoleAndMapping(snapshot);
        const target = snapshot.assignments.items.find(a => a.id === assignment.id);
        ensure(target && !snapshot.assignments.items.some(a => a.status === 'active' && a.id !== assignment.id && a.roleName !== companionName), 'RESTORE_ASSIGNMENT_DRIFT');
        let restoredId = assignment.id;
        if (target.status === 'revoked') {
          ensure(target.version === assignment.version + 1, 'RESTORE_VERSION_DRIFT');
          const restore = () => adminRequest(route, 'POST', { operationId: journal.restoreOperationId, roleName: 'mecanico' });
          let restored;
          // Transport failure does not prove rollback; replay the same compensation intent.
          try { restored = await restore(); } catch { restored = await restore(); }
          if (restored.status === 503) restored = await restore();
          ensure([200, 201].includes(restored.status) && uuid.test(restored.data?.assignment?.id) && restored.data.assignment.employeeId === mechanic.employeeId && restored.data.assignment.subject === mechanic.subject && restored.data.assignment.roleName === 'mecanico' && restored.data.assignment.status === 'active', 'RESTORE_NOT_CONFIRMED');
          restoredId = restored.data.assignment.id;
        } else {
          ensure(target.status === 'active' && target.version === assignment.version && target.syncStatus === 'synced', 'RESTORE_ASSIGNMENT_DRIFT');
        }
        await poll(async () => {
          const current = await read();
          unchangedRoleAndMapping(current);
          const active = current.assignments.items.filter(a => a.status === 'active' && a.roleName !== companionName);
          ensure(active.length === 1 && active[0].roleName === 'mecanico' && active[0].id === restoredId, 'RESTORED_ASSIGNMENT_DRIFT');
          if (active[0].syncStatus !== 'synced') return false;
          // A renewed token can have lost mecanico; recovery must start a new PKCE session.
          const r = await io.owner('/security/permissions', { token: await login(mechanic) });
          return r.status === 200 && sameSet(r.data?.effective, beforePermissions.data.effective);
        }, 'RECOVERY_TIMEOUT');
        journal.restorationConfirmed = true;
        io.unchanged(state);
      }
    } catch (error) { failure = safe(error); journal.errorCode = failure.message; }
    finally {
      try { if (cleanupCompanion) await cleanupCompanion(); } catch (error) { failure = safe(error); journal.errorCode = failure.message; }
      journal.finishedAt = new Date(io.now()).toISOString();
      journal.pass = !failure && journal.restorationConfirmed;
      try { if (release) record(); } catch { failure = new SafeFailure('JOURNAL_WRITE_FAILED'); }
      try { if (release) release(); } catch { failure = new SafeFailure('LOCK_RELEASE_FAILED'); }
    }
    if (failure) throw failure;
    return value;
  };
}

const command = (file, args, input) => new Promise((resolve, reject) => {
  const child = execFile(file, args, { timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => error ? reject(new SafeFailure('LOCAL_COMMAND_FAILED')) : resolve(stdout));
  child.stdin.on('error', () => {});
  child.stdin.end(input);
});

function runtime() {
  return {
    now: Date.now, id: randomUUID, sleep: ms => new Promise(r => setTimeout(r, ms)),
    schedule: (fn, ms) => setTimeout(fn, ms), cancel: clearTimeout,
    async lock() {
      ensure((await command('git', ['branch', '--show-current'])).trim() === 'work/marcelo', 'BRANCH_MISMATCH');
      ensure(resolve('.').split(sep).join('/').endsWith('/.worktrees/work-marcelo'), 'WORKTREE_MISMATCH');
      await command('git', ['check-ignore', '--quiet', 'output/cu27/journal.json']);
      mkdirSync('output/cu27', { recursive: true, mode: 0o700 });
      try { writeFileSync(lockPath, 'exclusive reversible test', { flag: 'wx', mode: 0o600 }); } catch { throw new SafeFailure('REVOCATION_LOCKED'); }
      return () => unlinkSync(lockPath);
    },
    async load() {
      const labels = JSON.parse(await command('docker', ['inspect', 'cu16-proof-employees-1', '--format', '{{json .Config.Labels}}']));
      ensure(labels['com.docker.compose.project'] === 'cu16-proof' && labels['com.docker.compose.service'] === 'employees', 'CONTAINER_OWNERSHIP');
      const bytes = [fixturePath, accountsPath, preflightPath].map(path => readFileSync(path, 'utf8'));
      const [fixture, accounts, preflight] = bytes.map(text => JSON.parse(text));
      return { fixture, mechanic: accounts.accounts.mechanicA, preflight, bytes, origin: process.env.CU27_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4286' };
    },
    unchanged(state) { ensure([fixturePath, accountsPath, preflightPath].every((path, i) => readFileSync(path, 'utf8') === state.bytes[i]), 'PRIVATE_FIXTURE_CHANGED'); },
    async issuer(origin) {
      const r = await fetch(origin + '/identity/realms/autonexus/.well-known/openid-configuration', { redirect: 'error', signal: AbortSignal.timeout(12000) });
      ensure(r.status === 200, 'ISSUER_UNAVAILABLE');
      return (await r.json()).issuer;
    },
    async authorize(account, config) { return (await authorize(account, false, config)).access_token; },
    async owner(path, { token, method = 'GET', body }) {
      const source = "let s='';for await(const c of process.stdin)s+=c;try{const v=JSON.parse(s);const r=await fetch('http://employees:3002'+v.path,{method:v.method,headers:{Authorization:'Bearer '+v.token,...(v.body===undefined?{}:{'Content-Type':'application/json'})},...(v.body===undefined?{}:{body:JSON.stringify(v.body)}),redirect:'error',signal:AbortSignal.timeout(12000)});const t=await r.text();process.stdout.write(JSON.stringify({status:r.status,data:t?JSON.parse(t):null}));}catch{process.exitCode=1;}";
      return JSON.parse(await command('docker', ['exec', '-i', 'cu16-proof-employees-1', 'node', '--input-type=module', '-e', source], JSON.stringify({ path, token, method, body })));
    },
    journal(value) { writeFileSync('output/cu27/revoked-mechanic-' + value.runId + '.json', JSON.stringify(value, null, 2), { mode: 0o600 }); },
  };
}

export const withRevokedMechanic = (callback, options) => createWithRevokedMechanic(runtime())(callback, options);
