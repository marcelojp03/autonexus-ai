/**
 * CU-sync real verification: MS05 + Keycloak + DynamoDB emulator + Operaciones.
 *
 * What it proves with real services (no doubles):
 *  - an overlay is stored, pushed and reflected as a single advance in Operaciones;
 *  - replaying the same operationId (even from a different overlay) does not create a second advance;
 *  - a stale baseVersion ends in `conflict` and does not touch the owner;
 *  - an assignment outside the actor's scope ends in `rejected` with the owner's own code;
 *  - another user sees the overlay as missing.
 *
 * The signed upload URL is never persisted by MS05 and never printed here.
 *
 * Usage: node scripts/sync/verify-sync-real.mjs
 * Env: CU_SYNC_URL (default http://127.0.0.1:3005), CU_SYNC_ORIGIN (default http://127.0.0.1:4285),
 *      CU_SYNC_ACCOUNTS (private account fixture), CU_SYNC_ASSIGNMENT (in-progress assignment of mechanicA)
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const syncUrl = process.env.CU_SYNC_URL ?? 'http://127.0.0.1:3005';
const origin = process.env.CU_SYNC_ORIGIN ?? 'http://127.0.0.1:4285';
const accountsFile = process.env.CU_SYNC_ACCOUNTS ?? '.worktrees/work-marcelo/output/stack/cu16-proof.accounts.private.json';
const assignmentId = process.env.CU_SYNC_ASSIGNMENT ?? '359cde57-3df0-4d53-b5b3-e18303ca4994';
const accounts = JSON.parse(readFileSync(resolve(accountsFile), 'utf8')).accounts;
const issuer = origin + '/identity/realms/autonexus';

mkdirSync('output/sync', { recursive: true });
const report = { syncUrl, origin, assignmentId, stages: [], pass: false };
const pass = (name, detail) => report.stages.push({ name, status: 'PASS', ...(detail ? { detail } : {}) });

const token = async key => (await authorize({ ...accounts[key], enabled: true }, false, { issuer, redirect: origin + '/auth/callback' })).access_token;

const call = async (bearer, path, method = 'GET', body) => {
  const response = await fetch(syncUrl + path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

/** The BFF only answers POST /graphql; the portal is not part of this verification. */
const owner = async (bearer, query, variables) => {
  const response = await fetch(origin + '/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const overlayBody = (operations, overlayId = randomUUID()) => ({ overlayId, deviceId: 'verify-device-1', createdAt: new Date().toISOString(), operations });

try {
  const mechanic = await token('mechanicA');
  const chief = await token('chief');

  const before = await owner(mechanic, 'query($id:UUID!){myExecution(assignmentId:$id){version advances{id}}}', { id: assignmentId });
  assert.equal(before.status, 200);
  const executionVersion = before.body.data.myExecution.version;
  const advancesBefore = before.body.data.myExecution.advances.length;
  pass('ejecución del mecánico consultada en Operaciones', { executionVersion, advancesBefore });

  const operationId = randomUUID();
  const advance = {
    operationId,
    entity: 'advance',
    target: { assignmentId },
    baseVersion: executionVersion,
    dependsOn: [],
    payload: { operationId, expectedVersion: executionVersion, description: 'Avance offline CU-sync', minutesWorked: 12 },
  };

  const created = await call(mechanic, '/sync/overlays', 'POST', overlayBody([advance]));
  assert.equal(created.status, 201);
  assert.equal(created.body.replayed, false);
  const overlayId = created.body.overlay.overlayId;
  assert.equal(created.body.overlay.operations[0].state, 'pending');
  pass('sobre registrado con la operación en pending');

  const replayedOverlay = await call(mechanic, '/sync/overlays', 'POST', overlayBody([advance], overlayId));
  assert.equal(replayedOverlay.body.replayed, true);
  pass('reenviar el mismo overlayId no duplica el sobre');

  const pushed = await call(mechanic, `/sync/overlays/${overlayId}/push`, 'POST');
  assert.equal(pushed.status, 200);
  assert.deepEqual(pushed.body.applied, [operationId]);
  pass('push aplicado contra el propietario real', { applied: pushed.body.applied });

  const afterFirst = await owner(mechanic, 'query($id:UUID!){myExecution(assignmentId:$id){advances{id}}}', { id: assignmentId });
  const advancesAfterFirst = afterFirst.body.data.myExecution.advances.length;
  assert.equal(advancesAfterFirst, advancesBefore + 1);
  pass('el propietario tiene exactamente un avance nuevo', { advancesAfterFirst });

  // Same operationId inside a *different* overlay: the owner's idempotency must answer replay.
  const secondOverlayId = randomUUID();
  const second = await call(mechanic, '/sync/overlays', 'POST', overlayBody([advance], secondOverlayId));
  assert.deepEqual(second.body.replayedOperations, [operationId]);
  const secondPush = await call(mechanic, `/sync/overlays/${secondOverlayId}/push`, 'POST');
  assert.deepEqual(secondPush.body.applied, []);
  const afterReplay = await owner(mechanic, 'query($id:UUID!){myExecution(assignmentId:$id){advances{id}}}', { id: assignmentId });
  assert.equal(afterReplay.body.data.myExecution.advances.length, advancesAfterFirst);
  pass('replay del mismo operationId no crea un segundo avance');

  // Stale version: the owner answers VERSION_CONFLICT and nothing is written.
  const staleOperation = randomUUID();
  const staleOverlay = randomUUID();
  await call(mechanic, '/sync/overlays', 'POST', overlayBody([{ ...advance, operationId: staleOperation, baseVersion: executionVersion, payload: { ...advance.payload, operationId: staleOperation, expectedVersion: executionVersion } }], staleOverlay));
  const stalePush = await call(mechanic, `/sync/overlays/${staleOverlay}/push`, 'POST');
  assert.equal(stalePush.body.failed[0].state, 'conflict');
  assert.equal(stalePush.body.failed[0].code, 'VERSION_CONFLICT');
  const afterStale = await owner(mechanic, 'query($id:UUID!){myExecution(assignmentId:$id){advances{id}}}', { id: assignmentId });
  assert.equal(afterStale.body.data.myExecution.advances.length, advancesAfterFirst);
  pass('conflicto de versión queda en conflict y no escribe en el propietario');

  // A foreign assignment must be rejected with the owner's own answer, not a generic 409.
  const foreignOperation = randomUUID();
  const foreignOverlay = randomUUID();
  const foreignAssignment = randomUUID();
  await call(mechanic, '/sync/overlays', 'POST', overlayBody([{ ...advance, operationId: foreignOperation, target: { assignmentId: foreignAssignment }, payload: { ...advance.payload, operationId: foreignOperation } }], foreignOverlay));
  const foreignPush = await call(mechanic, `/sync/overlays/${foreignOverlay}/push`, 'POST');
  assert.equal(foreignPush.body.failed[0].state, 'rejected');
  assert.ok(['EXECUTION_WORK_NOT_FOUND', 'ASSIGNMENT_NOT_FOUND', 'FORBIDDEN', 'EXECUTION_ACCESS_DENIED'].includes(foreignPush.body.failed[0].code), 'unexpected code ' + foreignPush.body.failed[0].code);
  pass('otra asignación se rechaza conservando el código del propietario', { code: foreignPush.body.failed[0].code });

  // Isolation: another authenticated user cannot read the overlay.
  const foreignRead = await call(chief, `/sync/overlays/${overlayId}`);
  assert.equal(foreignRead.status, 404);
  pass('otro usuario no alcanza el sobre ajeno (404)');

  // The coordinator never stores the bearer or a signed URL.
  const stored = await call(mechanic, `/sync/operations/${operationId}`);
  const serialized = JSON.stringify(stored.body);
  assert.ok(!/Bearer |eyJ[A-Za-z0-9_-]{10,}/.test(serialized), 'the stored operation must not contain a token');
  assert.ok(!/X-Amz-Signature/.test(serialized), 'the stored operation must not contain a signed URL');
  pass('la operación almacenada no contiene bearer ni URL firmada');

  report.pass = true;
} catch (error) {
  report.error = { name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 400) };
  throw error;
} finally {
  writeFileSync(resolve('output/sync/verify-sync-real.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, stages: report.stages.length, error: report.error }));
}
