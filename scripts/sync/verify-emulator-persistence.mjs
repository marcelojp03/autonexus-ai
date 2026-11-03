/**
 * Checks that the overlays survive recreating only the emulator container, with its volume intact.
 *
 * It reads the last overlay created by the sync verification, destroys and recreates the DynamoDB
 * emulator container (the named volume is preserved), waits for readiness and reads the overlay
 * again: same overlayId, same operations and same states.
 *
 * Usage: node scripts/sync/verify-emulator-persistence.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const syncUrl = process.env.CU_SYNC_URL ?? 'http://127.0.0.1:3005';
const origin = process.env.CU_SYNC_ORIGIN ?? 'http://127.0.0.1:4285';
const accountsFile = process.env.CU_SYNC_ACCOUNTS ?? '.worktrees/work-marcelo/output/stack/cu16-proof.accounts.private.json';
const container = process.env.CU_DYNAMO_CONTAINER ?? 'cu16-proof-dynamodb-1';
const project = process.env.CU_COMPOSE_PROJECT ?? 'cu16-proof';
const composeDir = process.env.CU_COMPOSE_DIR ?? resolve('.worktrees/work-marcelo');
const accounts = JSON.parse(readFileSync(resolve(accountsFile), 'utf8')).accounts;
const issuer = origin + '/identity/realms/autonexus';

mkdirSync('output/sync', { recursive: true });
const report = { stage: 'emulator-persistence', container, before: null, after: null, pass: false };
const token = async () => (await authorize({ ...accounts.mechanicA, enabled: true }, false, { issuer, redirect: origin + '/auth/callback' })).access_token;

const call = async (bearer, path) => {
  const response = await fetch(syncUrl + path, { headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const compose = (...args) =>
  execFileSync('docker', ['compose', '-p', project, '--env-file', '.env.example', '-f', 'compose.yaml', ...args], {
    cwd: composeDir,
    encoding: 'utf8',
    env: { ...process.env, PUBLIC_ORIGIN: origin },
  });

try {
  const bearer = await token();
  // The verification run leaves one overlay applied; take the most recent one from the emulator.
  const listed = execFileSync('docker', ['exec', container, 'sh', '-c', 'ls -1 /var/lib/localstack/data 2>/dev/null | head -3'], { encoding: 'utf8' }).trim();
  report.emulatorData = listed || '(empty)';

  const overlayId = process.env.CU_SYNC_OVERLAY ?? '';
  if (!overlayId) throw new Error('CU_SYNC_OVERLAY must point to an overlay created by the sync verification');
  report.before = (await call(bearer, `/sync/overlays/${overlayId}`)).body?.overlay;

  // Graceful stop first: the emulator flushes its state on SIGTERM, then the container is recreated
  // while the named volume survives.
  compose('stop', 'dynamodb');
  compose('rm', '-sf', 'dynamodb');
  compose('up', '-d', '--force-recreate', 'dynamodb');
  await new Promise(done => setTimeout(done, 25000));

  report.after = (await call(bearer, `/sync/overlays/${overlayId}`)).body?.overlay;
  report.pass =
    Boolean(report.before) &&
    Boolean(report.after) &&
    report.after.overlayId === report.before.overlayId &&
    report.after.operations.length === report.before.operations.length &&
    report.after.operations.every((operation, index) => operation.operationId === report.before.operations[index].operationId && operation.state === report.before.operations[index].state);
} catch (error) {
  report.error = String(error?.message ?? error).slice(0, 300);
} finally {
  writeFileSync(resolve('output/sync/emulator-persistence.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, overlayId: report.before?.overlayId, operations: report.before?.operations?.length, error: report.error }));
}
