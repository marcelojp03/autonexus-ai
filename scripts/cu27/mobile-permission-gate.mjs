import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';
import { withRevokedMechanic } from './with-revoked-mechanic.mjs';
import { expected, parseLabels } from './verify-mobile-photo.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'http://127.0.0.1:4286';
const check = (condition, code) => { if (!condition) throw new Error(code); };
const safeCode = error => /^[A-Z][A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'PERMISSION_GATE_RUNTIME_FAILURE';
const denialCodes = new Set(['HTTP_403', 'FORBIDDEN', 'PERMISSION_DENIED']);
const transientNetworkCodes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET']);
export function validateOperationId(id) {
  check(typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) && id.toLowerCase() !== expected.operationId, 'NEW_REJECT_OPERATION_UUID_REQUIRED');
  return id.toLowerCase();
}
export function immutableFingerprint(row) {
  const payload = Object.fromEntries(['operationId', 'description', 'photoBytes', 'imageSha256', 'actualFileSha256', 'labels', 'humanReviewLabels', 'humanReviewedAt', 'runId', 'modelVersion'].map(key => [key, row[key]]));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
export function inspectRow(metadata, id, state) {
  const rows = metadata.queue.filter(row => row.operationId === id);
  check(rows.length === 1, 'DEVICE_OPERATION_NOT_ONCE');
  const row = rows[0];
  check(row.state === state, 'DEVICE_STATE_MISMATCH');
  check(typeof row.description === 'string' && row.description.trim().length > 0, 'DEVICE_DESCRIPTION_REQUIRED');
  check(row.photoBytes === expected.photoBytes && row.imageSha256 === expected.imageSha256 && row.actualFileSha256 === row.imageSha256, 'DEVICE_PHOTO_NOT_PRESERVED');
  check(row.modelVersion === expected.modelVersion && row.runId === expected.runId, 'DEVICE_MODEL_MISMATCH');
  parseLabels(row.labels);
  check(row.humanReviewLabels === '' && typeof row.humanReviewedAt === 'string' && Number.isFinite(Date.parse(row.humanReviewedAt)), 'DEVICE_EXPLICIT_REVIEW_REQUIRED');
  check(!row.advanceId && !row.evidenceId, 'REJECTED_OPERATION_MUST_NOT_HAVE_OWNER_IDS');
  if (state === 'rejected') check(denialCodes.has(row.lastCode), 'DEVICE_VISIBLE_403_REQUIRED');
  return row;
}
export function validateDenial(operation) {
  check(operation?.state === 'rejected' && operation.lastResult?.status === 403 && denialCodes.has(operation.lastResult.code), 'ACTUAL_OWNER_403_REQUIRED');
}
export function createPermissionGate(io) {
  return async id => {
    id = validateOperationId(id);
    let stage = 'preflight', canSave = false;
    const report = { schemaVersion: 1, operationId: id, startedAt: new Date(io.now()).toISOString(), pass: false, deviceRecoveryUI: 'PENDING', attempts: [], transients: { http5xx: 0, network: 0 } };
    const record = (state, details = {}) => { report.state = state; Object.assign(report, details); io.save(report); io.emit({ state, operationId: id }); };
    try {
      await io.preflight();
      canSave = true;
      const baseline = inspectRow(await io.inspect(), id, 'pending');
      report.baselineFingerprint = immutableFingerprint(baseline);
      let token = await io.login();
      const before = await io.ledger(id, token);
      check(before.status === 404 || before.status === 200, 'BASELINE_MS05_READ_FAILED');
      if (before.status === 200) {
        const operation = before.data.operation;
        check(operation?.state === 'pending' && operation.lastResult == null, 'BASELINE_OPERATION_NOT_UNRESOLVED_PENDING');
        check(operation.operationId === id && operation.entity === 'advance' && operation.target?.assignmentId === expected.assignmentId && operation.payload?.description === baseline.description, 'BASELINE_OPERATION_INTENT_MISMATCH');
      }
      report.resumingExistingPending = before.status === 200;
      const ownerBefore = await io.execution(token);
      check(ownerBefore.status === 200 && !ownerBefore.data.advances.some(a => a.description === baseline.description), 'BASELINE_OWNER_ADVANCE_ALREADY_EXISTS');
      token = undefined;
      record('PREFLIGHT_PASSED', { photoBytes: baseline.photoBytes, imageSha256: baseline.imageSha256, modelVersion: baseline.modelVersion, runId: baseline.runId });
      stage = 'revocation_helper';
      await io.withRevoked(async context => {
        try {
          check(context.origin === origin, 'HELPER_ORIGIN_MISMATCH');
          stage = 'device_owner_rejection';
          record('WAITING_FOR_DEVICE_OWNER_REJECTION');
          const stopAt = Math.min(context.deadline - 90000, io.now() + 210000);
          let token = await io.login(context.subject);
          const transient = kind => {
            report.transients[kind]++; io.save(report);
            io.emit({ state: 'TRANSIENT_MS05_READ', operationId: id, counts: { ...report.transients } });
          };
          const readLedger = async () => {
            let response;
            try { response = await io.ledger(id, token, context.signal); }
            catch (error) {
              const network = error?.name === 'TimeoutError' || transientNetworkCodes.has(error?.code) || transientNetworkCodes.has(error?.cause?.code);
              if (context.signal.aborted || !network) throw error;
              transient('network'); return null;
            }
            if (response.status >= 500 && response.status <= 599) { transient('http5xx'); return null; }
            return response;
          };
          try {
            while (!context.signal.aborted && io.now() < stopAt) {
              let response = await readLedger();
              if (response?.status === 401) { token = await io.login(context.subject); response = await readLedger(); }
              if (!response) { await io.sleep(1000, context.signal); continue; }
              check(response.status === 200 || response.status === 404, 'MS05_READ_FAILED');
              if (response.status === 200) {
                const operation = response.data.operation;
                check(operation?.operationId === id, 'MS05_OPERATION_ID_MISMATCH');
                if (['applied', 'conflict', 'rejected'].includes(operation.state)) {
                  validateDenial(operation);
                  const metadata = await io.inspect();
                  const candidates = metadata.queue.filter(row => row.operationId === id);
                  check(candidates.length === 1 && immutableFingerprint(candidates[0]) === report.baselineFingerprint, 'DEVICE_IMMUTABLE_PAYLOAD_CHANGED');
                  if (candidates[0].state === 'rejected') {
                    const row = inspectRow(metadata, id, 'rejected');
                    record('DEVICE_OWNER_403_CONFIRMED', { actualOwnerStatus: 403, localState: 'rejected', localCode: row.lastCode, immutablePayloadPreserved: true });
                    return;
                  }
                  check(['pending', 'sending'].includes(candidates[0].state), 'DEVICE_UNEXPECTED_TERMINAL_STATE');
                }
              }
              await io.sleep(1000, context.signal);
            }
            throw new Error('DEVICE_REJECTION_TIMEOUT');
          } finally { token = undefined; }
        } catch (error) {
          report.attempts.push({ stage, code: safeCode(error) }); io.save(report); throw error;
        }
      }, { routingCompanion: true, callbackTimeoutMs: 300000 });
      stage = 'post_restoration_reads';
      report.helperRestorationAndCompanionCleanupConfirmed = true;
      token = await io.login();
      try {
        const owner = await io.execution(token);
        check(owner.status === 200 && !owner.data.advances.some(a => a.description === baseline.description), 'RESTORED_OWNER_ADVANCE_MUST_BE_ABSENT');
        const ledger = await io.ledger(id, token);
        check(ledger.status === 200 && ledger.data.operation?.operationId === id, 'RESTORED_MS05_READ_FAILED');
        validateDenial(ledger.data.operation);
        const row = inspectRow(await io.inspect(), id, 'rejected');
        check(immutableFingerprint(row) === report.baselineFingerprint, 'POST_RESTORE_PAYLOAD_CHANGED');
        record('PARTIAL_DEVICE_RECOVERY_UI_PENDING', { rejectionChecksPassed: true, ownerExecutionStatus: 200, matchingAdvanceCount: 0, coordinatorStillRejected: true });
      } finally { token = undefined; }
    } catch (error) {
      report.attempts.push({ stage, code: safeCode(error) });
      if (canSave) record('BLOCKED');
      throw new Error(safeCode(error));
    } finally { if (canSave) { report.finishedAt = new Date(io.now()).toISOString(); io.save(report); } }
    return report;
  };
}
const command = (file, args) => new Promise((ok, no) => {
  execFile(file, args, { cwd: root, timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) => error ? no(new Error('READONLY_COMMAND_FAILED')) : ok(stdout));
});
function runtime() {
  const proof = resolve(root, 'output/cu27/mobile-permission-gate.json');
  let account;
  const get = async (url, token, signal) => {
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
    return { status: response.status, data: response.status === 200 ? await response.json() : null };
  };
  return {
    now: Date.now,
    async preflight() {
      check(resolve('.') === root, 'RUN_FROM_WORK_MARCELO_REQUIRED');
      check(!process.env.CU27_PUBLIC_ORIGIN || process.env.CU27_PUBLIC_ORIGIN === origin, 'PUBLIC_ORIGIN_MISMATCH');
      await command('git', ['check-ignore', '--quiet', proof]);
      check(!existsSync(proof), 'PRIOR_PERMISSION_EVIDENCE_EXISTS_NO_OVERWRITE');
      const preflight = resolve(root, 'output/cu27/fixture/admin-preflight.private.json');
      check(Date.now() - statSync(preflight).mtimeMs < 300000, 'REFRESH_ADMIN_PREFLIGHT_BEFORE_EXECUTE');
      account = JSON.parse(readFileSync(resolve(root, 'output/stack/cu16-proof.accounts.private.json'), 'utf8')).accounts.mechanicA;
    },
    inspect: async () => JSON.parse(await command(process.execPath, [resolve(root, 'scripts/cu27/inspect-device-queue.mjs')])),
    async login(subject = account.subject) {
      const token = (await authorize({ ...account, enabled: true }, false, { issuer: origin + '/identity/realms/autonexus', redirect: origin + '/auth/callback' })).access_token;
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      check(claims.iss === origin + '/identity/realms/autonexus' && claims.sub === subject, 'SYNTHETIC_PKCE_IDENTITY_MISMATCH');
      return token;
    },
    ledger: (id, token, signal) => get('http://127.0.0.1:3005/sync/operations/' + id, token, signal),
    execution: token => get('http://127.0.0.1:8081/executions/me/' + expected.assignmentId, token),
    withRevoked: withRevokedMechanic,
    sleep: (ms, signal) => new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    }),
    save(report) { mkdirSync(dirname(proof), { recursive: true }); writeFileSync(proof, JSON.stringify(report, null, 2), { mode: 0o600 }); },
    emit: value => console.log(JSON.stringify(value)),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--execute') {
    console.log('Usage: CU27_REJECT_OPERATION=<new UUID> node scripts/cu27/mobile-permission-gate.mjs --execute');
    console.log('Parent release required. Refresh provision-test-admin.mjs --verify immediately beforehand. Parent alone performs phone fresh PKCE, push and recovery UI.');
    process.exitCode = process.argv[2] === '--help' ? 0 : 2;
  } else {
    try { await createPermissionGate(runtime())(process.env.CU27_REJECT_OPERATION); }
    catch (error) { console.log(JSON.stringify({ state: 'BLOCKED', code: safeCode(error) })); process.exitCode = 1; }
  }
}
