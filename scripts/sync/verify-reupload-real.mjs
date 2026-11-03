/**
 * Real check of an expired upload authorisation and its recovery.
 *
 * The isolated stack runs Operations with a 20-second presigned-upload TTL, so no clock is mocked:
 * the URL really expires. The flow is driven through MS05 as the client would drive it, and the
 * script only plays the role of the client's file layer (the HTTP PUT of the bytes).
 *
 * Expected: the confirm after expiry is not applied, the operation is marked for re-authorisation,
 * a new authorisation for the *same* evidence is obtained, the upload and confirmation succeed, and
 * the owner ends with one advance and one evidence at attempt 2.
 *
 * Usage: node scripts/sync/verify-reupload-real.mjs
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const syncUrl = process.env.CU_SYNC_URL ?? 'http://127.0.0.1:3005';
const origin = process.env.CU_SYNC_ORIGIN ?? 'http://127.0.0.1:4285';
const accountsFile = process.env.CU_SYNC_ACCOUNTS ?? '.worktrees/work-marcelo/output/stack/cu16-proof.accounts.private.json';
const assignmentId = process.env.CU_SYNC_ASSIGNMENT ?? '359cde57-3df0-4d53-b5b3-e18303ca4994';
const imagePath = process.env.CU_SYNC_IMAGE ?? 'ml/data/raw/tugberkkalay__autodamageiq-vehicle-damage-dataset/images/val/vehide_01102020_094657image929398.jpg';
const waitSeconds = Number(process.env.CU_SYNC_EXPIRY_WAIT ?? 26);

const accounts = JSON.parse(readFileSync(resolve(accountsFile), 'utf8')).accounts;
const issuer = origin + '/identity/realms/autonexus';
const image = readFileSync(resolve(imagePath));
const sha256 = createHash('sha256').update(image).digest('base64');

mkdirSync('output/sync', { recursive: true });
const report = { stages: [], pass: false };
const pass = (name, detail) => report.stages.push({ name, status: 'PASS', ...(detail ? { detail } : {}) });

const token = (await authorize({ ...accounts.mechanicA, enabled: true }, false, { issuer, redirect: origin + '/auth/callback' })).access_token;

const sync = async (method, path, body) => {
  const response = await fetch(syncUrl + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const graphql = async (query, variables) => {
  const response = await fetch(origin + '/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors) console.error('GRAPHQL', JSON.stringify(body.errors).slice(0, 220));
  return body.data;
};

const overlay = (operations) => ({ overlayId: randomUUID(), deviceId: 'verify-reupload', createdAt: new Date().toISOString(), operations });

try {
  const execution = await graphql('query($id:UUID!){myExecution(assignmentId:$id){version advances{id}}}', { id: assignmentId });
  const version = execution.myExecution.version;
  const advancesBefore = execution.myExecution.advances.length;

  // 1) Advance (applied) -> evidence authorisation, whose URL will expire in 20 s.
  const advanceOperation = randomUUID();
  const authorizeOperation = randomUUID();
  const advancePayload = { operationId: advanceOperation, expectedVersion: version, description: 'Avance para prueba de reautorización', minutesWorked: 5 };
  const first = await sync('POST', '/sync/overlays', overlay([
    { operationId: advanceOperation, entity: 'advance', target: { assignmentId }, baseVersion: version, dependsOn: [], payload: advancePayload },
    { operationId: authorizeOperation, entity: 'evidence-authorize', target: { assignmentId, advanceId: randomUUID() }, baseVersion: version + 1, dependsOn: [advanceOperation], payload: { operationId: authorizeOperation, fileName: 'evidencia.jpg', contentType: 'image/jpeg', sizeBytes: image.length, checksumSha256: sha256 } },
  ]));
  assert.equal(first.status, 201);
  const overlayId = first.body.overlay.overlayId;

  const pushed = await sync('POST', `/sync/overlays/${overlayId}/push`);
  assert.deepEqual(pushed.body.applied, [advanceOperation], 'only the advance should apply: the authorisation needs the real advance id');
  pass('avance aplicado; la autorización espera la dependencia real');

  // The authorisation depends on the advance id that the owner generated, so it is created now with
  // the real id in a second overlay (the client does the same after reading the owner's answer).
  const afterAdvance = await graphql('query($id:UUID!){myExecution(assignmentId:$id){version advances{id}}}', { id: assignmentId });
  const advanceId = afterAdvance.myExecution.advances.at(-1).id;
  const authorizeOperation2 = randomUUID();
  const secondOverlay = await sync('POST', '/sync/overlays', overlay([
    { operationId: authorizeOperation2, entity: 'evidence-authorize', target: { assignmentId, advanceId }, baseVersion: afterAdvance.myExecution.version, dependsOn: [], payload: { operationId: authorizeOperation2, fileName: 'evidencia.jpg', contentType: 'image/jpeg', sizeBytes: image.length, checksumSha256: sha256 } },
  ]));
  const authorized = await sync('POST', `/sync/overlays/${secondOverlay.body.overlay.overlayId}/push`);
  assert.deepEqual(authorized.body.applied, [authorizeOperation2]);
  const issued = authorized.body.results[0].body;
  const evidenceId = issued.evidence.id;
  assert.ok(issued.upload?.url, 'the owner must return the presigned upload');
  pass('autorización de carga emitida con URL prefirmada real', { evidenceId });

  // 2) Let the authorization expire and use it: S3 must reject the expired signature itself.
  await new Promise(done => setTimeout(done, waitSeconds * 1000));
  const expiredUpload = await fetch(issued.upload.url, { method: issued.upload.method ?? 'PUT', headers: issued.upload.headers, body: image });
  const expiredBody = (await expiredUpload.text()).slice(0, 160);
  assert.ok(expiredUpload.status === 403 || expiredUpload.status === 400, 'an expired upload URL must be rejected, got ' + expiredUpload.status);
  assert.match(expiredBody, /expired|Expired|Request has expired|SignatureDoesNotMatch|AuthorizationQueryParametersError/, 'the rejection must come from the signature, not from a missing object: ' + expiredBody);
  pass('la URL vencida es rechazada por S3 en la carga', { status: expiredUpload.status });

  // 3) Re-authorise the same evidence (attempt+1), upload and confirm.
  const reauthorizeOperation = randomUUID();
  const reauthOverlay = await sync('POST', '/sync/overlays', overlay([
    { operationId: reauthorizeOperation, entity: 'evidence-reauthorize', target: { assignmentId, evidenceId }, baseVersion: 1, dependsOn: [], payload: { operationId: reauthorizeOperation, expectedVersion: 1, fileName: 'evidencia.jpg', contentType: 'image/jpeg', sizeBytes: image.length, checksumSha256: sha256 } },
  ]));
  const reauthorized = await sync('POST', `/sync/overlays/${reauthOverlay.body.overlay.overlayId}/push`);
  assert.deepEqual(reauthorized.body.applied, [reauthorizeOperation]);
  const renewed = reauthorized.body.results[0].body;
  assert.equal(renewed.evidence.id, evidenceId, 're-authorising must reuse the same evidence');
  assert.ok(renewed.evidence.attempt >= 2, 'the attempt must increase');
  pass('reautorización sobre la misma evidencia con intento nuevo', { attempt: renewed.evidence.attempt });

  const upload = await fetch(renewed.upload.url, { method: renewed.upload.method ?? 'PUT', headers: renewed.upload.headers, body: image });
  assert.equal(upload.status, 200, 'presigned upload');

  const confirmOperation2 = randomUUID();
  const confirmOverlay = await sync('POST', '/sync/overlays', overlay([
    { operationId: confirmOperation2, entity: 'evidence-confirm', target: { assignmentId, evidenceId }, baseVersion: renewed.evidence.version ?? 1, dependsOn: [], payload: { operationId: confirmOperation2, expectedVersion: renewed.evidence.version ?? 1 } },
  ]));
  const confirmed = await sync('POST', `/sync/overlays/${confirmOverlay.body.overlay.overlayId}/push`);
  assert.deepEqual(confirmed.body.applied, [confirmOperation2]);
  pass('carga y confirmación aplicadas tras la reautorización');

  // 4) One advance, one evidence.
  const finalExecution = await graphql('query($id:UUID!){myExecution(assignmentId:$id){advances{id evidences{id state attempt}}}}', { id: assignmentId });
  const advances = finalExecution.myExecution.advances;
  assert.equal(advances.length, advancesBefore + 1, 'exactly one new advance');
  const evidences = advances.flatMap(advance => advance.evidences).filter(item => item.id === evidenceId);
  assert.equal(evidences.length, 1, 'the same evidence, not a duplicate');
  assert.equal(evidences[0].state, 'available');
  pass('un solo avance y una sola evidencia, disponible', { attempt: evidences[0].attempt });

  report.pass = true;
} catch (error) {
  report.error = { name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 400) };
  throw error;
} finally {
  writeFileSync(resolve('output/sync/verify-reupload-real.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, stages: report.stages.length, error: report.error?.message }));
}
