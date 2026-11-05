/** Real AWS expiry/re-authorisation check. Does not change TTL, credentials or cloud resources. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';
import { uploadHeaders } from './resume-s3-reupload.mjs';

export function expiryOf(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  assert.ok(url.hostname.endsWith('.amazonaws.com') && (url.hostname.includes('.s3.') || url.hostname.includes('.s3-') || url.hostname.startsWith('s3.')), 'PRESIGN_HOST_NOT_AWS_S3');
  const stamp = url.searchParams.get('X-Amz-Date');
  assert.match(stamp ?? '', /^\d{8}T\d{6}Z$/);
  const ttl = Number(url.searchParams.get('X-Amz-Expires'));
  assert.ok(Number.isInteger(ttl) && ttl >= 1 && ttl <= 600);
  const iso = stamp.slice(0, 4) + '-' + stamp.slice(4, 6) + '-' + stamp.slice(6, 8) + 'T' + stamp.slice(9, 11) + ':' + stamp.slice(11, 13) + ':' + stamp.slice(13, 15) + 'Z';
  return { ttl, expiresAt: Date.parse(iso) + ttl * 1000 };
}

async function main() {
  const origin = process.env.CU27_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4286';
  assert.ok(['http://127.0.0.1:4285', 'http://127.0.0.1:4286'].includes(origin));
  const assignmentId = '359cde57-3df0-4d53-b5b3-e18303ca4994';
  const account = JSON.parse(readFileSync('output/stack/cu16-proof.accounts.private.json')).accounts.mechanicA;
  const image = readFileSync(process.env.CU27_IMAGE ?? 'mobile/autonexus_app/assets/samples/sample.jpg');
  const checksumSha256 = createHash('sha256').update(image).digest('base64');
  const report = { pass: false, surface: 'API_ONLY_NOT_DEVICE', stages: [], origin };
  mkdirSync('output/cu27', { recursive: true });
  const save = () => writeFileSync('output/cu27/s3-expiry.json', JSON.stringify(report, null, 2));
  const pass = (name, detail = {}) => { report.stages.push({ name, status: 'PASS', ...detail }); save(); console.log(name); };
  let token;
  const login = async () => { token = (await authorize({ ...account, enabled: true }, false, { issuer: origin + '/identity/realms/autonexus', redirect: origin + '/auth/callback' })).access_token; };
  async function call(base, path, method = 'GET', body) {
    if (!token) await login();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
      if (response.status === 401 && attempt === 0) { await login(); continue; }
      const data = await response.json();
      report.lastRequest = { method, path, status: response.status, code: typeof data.code === 'string' ? data.code : undefined };
      assert.ok(response.status >= 200 && response.status < 300, 'OWNER_OR_COORDINATOR_DENIED');
      return data;
    }
  }
  const owner = () => call('http://127.0.0.1:8081', '/executions/me/' + assignmentId);
  async function push(entity, target, version, payload) {
    const operationId = randomUUID(), overlayId = randomUUID();
    report.currentEntity = entity;
    const extra = ['evidence-authorize', 'evidence-reauthorize'].includes(entity) ? { file: { sha256: createHash('sha256').update(image).digest('hex'), bytes: image.length, contentType: 'image/jpeg' } } : {};
    await call('http://127.0.0.1:3005', '/sync/overlays', 'POST', { overlayId, deviceId: 'cu27-s3-expiry', createdAt: new Date().toISOString(), operations: [{ operationId, entity, target, baseVersion: version, dependsOn: [], payload: { ...payload, operationId }, ...extra }] });
    const result = await call('http://127.0.0.1:3005', '/sync/overlays/' + overlayId + '/push', 'POST');
    assert.ok(result.applied?.includes(operationId), 'OPERATION_NOT_APPLIED');
    const rows = result.results.filter(item => item.operationId === operationId);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].status >= 200 && rows[0].status < 300);
    return { operationId, overlayId, body: rows[0].body };
  }
  try {
    const before = await owner();
    const description = 'CU27-S3-EXPIRY-' + randomUUID();
    const advance = await push('advance', { assignmentId }, before.version, { expectedVersion: before.version, description, minutesWorked: 5 });
    assert.match(advance.body.advance.id, /^[a-f0-9-]{36}$/);
    const advanceId = advance.body.advance.id;
    report.advanceId = advanceId; report.advanceOperationId = advance.operationId;
    const afterAdvance = await owner();
    const file = { fileName: 'cu27-expiry.jpg', contentType: 'image/jpeg', sizeBytes: image.length, checksumSha256 };
    const issued = await push('evidence-authorize', { assignmentId, advanceId }, afterAdvance.version, file);
    const evidenceId = issued.body.evidence.id; report.evidenceId = evidenceId;
    report.presignMetadata = { host: new URL(issued.body.upload.url).hostname, queryKeys: [...new URL(issued.body.upload.url).searchParams.keys()].filter(key => key === 'X-Amz-Date' || key === 'X-Amz-Expires') };
    const expiration = expiryOf(issued.body.upload.url);
    pass('real_authorization_issued', { ttlSeconds: expiration.ttl, evidenceId });
    const wait = expiration.expiresAt + 5000 - Date.now();
    assert.ok(wait > 0 && wait <= 610000, 'EXPIRY_WAIT_OUT_OF_BOUNDS');
    report.waitUntil = new Date(expiration.expiresAt + 5000).toISOString(); save();
    await new Promise(done => setTimeout(done, wait));
    const expired = await fetch(issued.body.upload.url, { method: 'PUT', headers: uploadHeaders(issued.body.upload, checksumSha256, image.length), body: image, signal: AbortSignal.timeout(30000) });
    const xml = await expired.text();
    assert.equal(expired.status, 403, 'S3_DID_NOT_REJECT_EXPIRED_PUT');
    assert.ok(xml.includes('<Message>Request has expired</Message>'), 'S3_REJECTION_NOT_EXPIRY');
    pass('expired_signature_put_rejected_by_aws', { httpStatus: expired.status });
    const current = await owner();
    const original = current.advances.find(item => item.id === advanceId)?.evidences.find(item => item.id === evidenceId);
    assert.ok(original, 'EVIDENCE_NOT_FOUND');
    const renewed = await push('evidence-reauthorize', { assignmentId, evidenceId }, original.version, { ...file, expectedVersion: original.version });
    assert.equal(renewed.body.evidence.id, evidenceId);
    assert.equal(renewed.body.evidence.attempt, issued.body.evidence.attempt + 1);
    pass('same_evidence_reauthorized', { attempt: renewed.body.evidence.attempt });
    const uploaded = await fetch(renewed.body.upload.url, { method: 'PUT', headers: uploadHeaders(renewed.body.upload, checksumSha256, image.length), body: image, signal: AbortSignal.timeout(30000) });
    assert.equal(uploaded.status, 200, 'REAUTHORIZED_PUT_FAILED');
    pass('reauthorized_put_accepted_by_aws', { httpStatus: uploaded.status });
    const confirmed = await push('evidence-confirm', { assignmentId, evidenceId }, renewed.body.evidence.version, { expectedVersion: renewed.body.evidence.version });
    assert.equal(confirmed.body.evidence.state, 'available');
    const final = await owner();
    assert.equal(final.advances.filter(item => item.description === description).length, 1);
    const evidence = final.advances.find(item => item.id === advanceId).evidences.filter(item => item.id === evidenceId);
    assert.equal(evidence.length, 1); assert.equal(evidence[0].state, 'available');
    pass('owner_confirms_one_advance_one_available_evidence', { count: 1, attempt: evidence[0].attempt });
    report.pass = true;
  } catch (error) { report.errorCode = /^[A-Z][A-Z_]+$/.test(error.message ?? '') ? error.message : 'REAL_S3_EXPIRY_ACCEPTANCE_FAILED'; process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ pass: report.pass, stages: report.stages.length, errorCode: report.errorCode })); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('S3_EXPIRY_PREFLIGHT_FAILED'); process.exitCode = 1; });
