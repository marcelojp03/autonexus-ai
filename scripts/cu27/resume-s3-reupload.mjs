import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const SOURCE = 'output/cu27/s3-expiry.json';
const OUTPUT = 'output/cu27/s3-reupload.json';
const ORIGIN = 'http://127.0.0.1:4286';
const ASSIGNMENT = '359cde57-3df0-4d53-b5b3-e18303ca4994';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function safeXmlCode(xml) {
  return /<Code>([A-Za-z][A-Za-z0-9]{0,63})<[/]Code>/.exec(xml)?.[1] ?? null;
}

export function uploadHeaders(upload, checksum, length) {
  assert.equal(upload?.method, 'PUT', 'UPLOAD_METHOD_INVALID');
  const url = new URL(upload.url);
  assert.equal(url.protocol, 'https:', 'UPLOAD_PROTOCOL_INVALID');
  assert.equal(url.hostname, 'autonexus-ai-evidencias.s3.amazonaws.com', 'UPLOAD_HOST_INVALID');
  assert.equal(url.port, '', 'UPLOAD_PORT_INVALID');
  assert.ok(!url.username && !url.password && !url.hash, 'UPLOAD_AUTHORITY_INVALID');
  assert.equal(typeof upload.headersJson, 'string', 'UPLOAD_HEADERS_JSON_MISSING');
  const headers = new Headers(JSON.parse(upload.headersJson));
  assert.ok(!headers.has('authorization') && !headers.has('cookie'), 'UPLOAD_CREDENTIAL_HEADER_INVALID');
  assert.equal(headers.get('content-type'), 'image/jpeg', 'UPLOAD_CONTENT_TYPE_MISMATCH');
  assert.equal(headers.get('x-amz-checksum-sha256'), checksum, 'UPLOAD_CHECKSUM_MISMATCH');
  assert.equal(headers.get('if-none-match'), '*', 'UPLOAD_CONDITION_MISSING');
  headers.set('content-length', String(length));
  return headers;
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ['--execute'], 'EXPLICIT_EXECUTE_REQUIRED');
  const sourceBytes = readFileSync(SOURCE);
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
  const source = JSON.parse(sourceBytes);
  assert.equal(source.origin, ORIGIN, 'SOURCE_ORIGIN_MISMATCH');
  for (const id of [source.advanceId, source.evidenceId]) assert.ok(typeof id === 'string' && id.length === 36 && UUID.test(id), 'SOURCE_ID_INVALID');
  const image = readFileSync('mobile/autonexus_app/assets/samples/sample.jpg');
  const checksum = createHash('sha256').update(image).digest('base64');
  const imageHex = createHash('sha256').update(image).digest('hex');
  const account = JSON.parse(readFileSync('output/stack/cu16-proof.accounts.private.json')).accounts.mechanicA;
  const previous = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT)) : null;
  if (previous) {
    assert.equal(previous.advanceId, source.advanceId, 'RESUME_ADVANCE_MISMATCH');
    assert.equal(previous.evidenceId, source.evidenceId, 'RESUME_EVIDENCE_MISMATCH');
  }
  const report = previous ?? { pass: false, surface: 'API_ONLY_NOT_DEVICE', origin: ORIGIN,
    assignmentId: ASSIGNMENT, advanceId: source.advanceId, evidenceId: source.evidenceId,
    sourceSha256: sourceHash, imageSha256: imageHex, stages: [] };
  assert.equal(report.sourceSha256, sourceHash, 'EXPIRY_PROOF_CHANGED');
  assert.equal(report.imageSha256, imageHex, 'RESUME_IMAGE_CHANGED');
  let token;
  const save = () => writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
  const pass = (name, facts = {}) => { report.stages.push({ ...facts, ...(typeof facts.status === 'number' ? { httpStatus: facts.status } : {}), name, status: 'PASS' }); save(); console.log(name); };
  const login = async () => {
    token = (await authorize({ ...account, enabled: true }, false,
      { issuer: ORIGIN + '/identity/realms/autonexus', redirect: ORIGIN + '/auth/callback' })).access_token;
  };
  async function call(port, path, method = 'GET', body) {
    if (!token) await login();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch('http://127.0.0.1:' + port + path, { method,
        headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); await login(); continue; }
      const data = await response.json();
      report.lastApi = { status: response.status, ...(typeof data.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(data.code) ? { code: data.code } : {}) };
      assert.ok(response.ok, 'OWNER_OR_COORDINATOR_DENIED');
      return data;
    }
  }
  const owner = () => call(8081, '/executions/me/' + ASSIGNMENT);
  function select(execution) {
    const advances = execution.advances.filter(a => a.id === source.advanceId);
    assert.equal(advances.length, 1, 'EXACT_ADVANCE_NOT_UNIQUE');
    const evidence = advances[0].evidences.filter(e => e.id === source.evidenceId);
    assert.equal(evidence.length, 1, 'EXACT_EVIDENCE_NOT_UNIQUE');
    assert.equal(execution.advances.flatMap(a => a.evidences).filter(e => e.id === source.evidenceId).length, 1, 'EVIDENCE_DUPLICATED');
    return { advance: advances[0], evidence: evidence[0] };
  }
  async function push(entity, version, payload, checkpoint) {
    if (!report[checkpoint]) {
      report[checkpoint] = { operationId: randomUUID(), overlayId: randomUUID(), createdAt: new Date().toISOString(), version, payload };
      save();
    }
    const step = report[checkpoint];
    const extra = entity === 'evidence-reauthorize' ? { file: { sha256: imageHex, bytes: image.length, contentType: 'image/jpeg' } } : {};
    await call(3005, '/sync/overlays', 'POST', { overlayId: step.overlayId, deviceId: 'cu27-s3-resume',
      createdAt: step.createdAt, operations: [{ operationId: step.operationId,
        entity, target: { assignmentId: ASSIGNMENT, evidenceId: source.evidenceId }, baseVersion: step.version,
        dependsOn: [], payload: { ...step.payload, operationId: step.operationId }, ...extra }] });
    save();
    const summary = await call(3005, '/sync/overlays/' + step.overlayId + '/push', 'POST');
    if (checkpoint === 'expiredConfirmation') {
      const result = summary.results?.find(r => r.operationId === step.operationId);
      const stored = summary.operations?.find(r => r.operationId === step.operationId);
      const code = result?.code ?? stored?.lastResult?.code;
      const status = result?.status ?? stored?.lastResult?.status;
      assert.ok(['EVIDENCE_UPLOAD_EXPIRED', 'EVIDENCE_OBJECT_MISSING'].includes(code), 'EXPIRED_CONFIRMATION_NOT_RECOVERABLE');
      assert.equal(stored?.state, 'needs-reupload', 'EXPIRED_CONFIRMATION_NOT_NEEDS_REUPLOAD');
      assert.ok(!summary.applied?.includes(step.operationId), 'EXPIRED_CONFIRMATION_FALSE_APPLIED');
      report.expiredResult = { status, code, state: stored.state };
      return result?.body ?? stored.lastBody;
    }
    assert.ok(summary.applied?.includes(step.operationId), 'MS05_OPERATION_NOT_APPLIED');
    const result = summary.results?.find(r => r.operationId === step.operationId);
    if (result) {
      assert.ok(result.status >= 200 && result.status < 300, 'OWNER_RESULT_NOT_SUCCESS');
      return result.body;
    }
    // MS05 omits terminal results on replay; the owner re-signs the same attempt idempotently.
    if (entity === 'evidence-reauthorize') return call(8081,
      '/executions/' + ASSIGNMENT + '/evidences/' + source.evidenceId + '/retry', 'POST', { ...step.payload, operationId: step.operationId });
    return { evidence: select(await owner()).evidence };
  }
  try {
    const initial = await owner();
    const { advance, evidence } = select(initial);
    assert.equal(initial.advances.filter(a => a.description === advance.description).length, 1, 'ADVANCE_DESCRIPTION_DUPLICATED');
    report.initialAttempt ??= evidence.attempt;
    report.initialAdvanceCount ??= initial.advances.length;
    report.initialEvidenceCount ??= advance.evidences.length;
    pass('existing_ids_verified', { attempt: evidence.attempt, available: evidence.state === 'available' });
    if (evidence.state !== 'available') {
      assert.equal(evidence.sizeBytes, image.length, 'EXISTING_IMAGE_SIZE_MISMATCH');
      assert.equal(evidence.contentType, 'image/jpeg', 'EXISTING_IMAGE_TYPE_MISMATCH');
      if (!report.reauthorization) {
        await push('evidence-confirm', evidence.version, { expectedVersion: evidence.version }, 'expiredConfirmation');
        pass('expired_attempt_owner_confirmation_needs_reupload', report.expiredResult);
      }
      const afterExpired = select(await owner()).evidence;
      const renewed = await push('evidence-reauthorize', afterExpired.version, { expectedVersion: afterExpired.version,
        fileName: evidence.fileName, contentType: 'image/jpeg', sizeBytes: image.length, checksumSha256: checksum }, 'reauthorization');
      assert.equal(renewed.evidence.id, source.evidenceId, 'REAUTHORIZED_EVIDENCE_CHANGED');
      assert.equal(renewed.evidence.attempt, report.initialAttempt + 1, 'UNEXPECTED_ATTEMPT');
      const supplied = new Headers(JSON.parse(renewed.upload.headersJson));
      report.headerDiagnosis = { headersFieldAbsent: renewed.upload.headers === undefined, headersJsonPresent: typeof renewed.upload.headersJson === 'string',
        contentTypePresent: supplied.has('content-type'), checksumPresent: supplied.has('x-amz-checksum-sha256'),
        conditionPresent: supplied.has('if-none-match'), checksumMatches: supplied.get('x-amz-checksum-sha256') === checksum };
      report.cause = 'VERIFIER_READS_UPLOAD_HEADERS_BUT_OWNER_RETURNS_HEADERS_JSON';
      save();
      const headers = uploadHeaders(renewed.upload, checksum, image.length);
      const signed = (new URL(renewed.upload.url).searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
      report.uploadContract = { checksumMatches: true, conditionalWrite: true, contentLengthMatches: true,
        signedContentLength: signed.includes('content-length'), signedCondition: signed.includes('if-none-match'),
        signedChecksum: signed.includes('x-amz-checksum-sha256') };
      pass('same_evidence_reauthorized', { attempt: renewed.evidence.attempt });
      if (!report.originalHeaderProbe) {
        const probe = await fetch(renewed.upload.url, { method: 'PUT', headers: renewed.upload.headers,
          body: image, redirect: 'manual', signal: AbortSignal.timeout(20000) });
        report.originalHeaderProbe = { status: probe.status, code: safeXmlCode(await probe.text()) };
        save();
        assert.ok(!probe.ok, 'MISSING_HEADERS_PROBE_UNEXPECTEDLY_ACCEPTED');
        pass('original_verifier_header_failure_reproduced', { httpStatus: probe.status, code: report.originalHeaderProbe.code });
      }
      const uploaded = await fetch(renewed.upload.url, { method: 'PUT', headers, body: image,
        redirect: 'manual', signal: AbortSignal.timeout(20000) });
      const xml = await uploaded.text();
      report.put = { status: uploaded.status, code: safeXmlCode(xml) };
      save();
      assert.ok(uploaded.ok || uploaded.status === 412, 'REAL_S3_PUT_REJECTED');
      pass('real_s3_put_completed', { status: uploaded.status, conditionalReplay: uploaded.status === 412 });
      const current = select(await owner()).evidence;
      const confirmed = await push('evidence-confirm', current.version, { expectedVersion: current.version }, 'confirmation');
      assert.equal(confirmed.evidence.id, source.evidenceId, 'CONFIRMED_EVIDENCE_CHANGED');
      assert.equal(confirmed.evidence.state, 'available', 'OWNER_EVIDENCE_NOT_AVAILABLE');
    }
    const final = await owner();
    const end = select(final);
    assert.equal(final.advances.length, report.initialAdvanceCount, 'ADVANCE_COUNT_CHANGED');
    assert.equal(end.advance.evidences.length, report.initialEvidenceCount, 'EVIDENCE_COUNT_CHANGED');
    assert.equal(final.advances.filter(a => a.description === end.advance.description).length, 1, 'ADVANCE_DESCRIPTION_DUPLICATED');
    assert.equal(end.evidence.state, 'available', 'FINAL_EVIDENCE_NOT_AVAILABLE');
    assert.equal(createHash('sha256').update(readFileSync(SOURCE)).digest('hex'), sourceHash, 'EXPIRY_PROOF_CHANGED');
    pass('one_original_advance_one_original_available_evidence', { advanceCount: 1, evidenceCount: 1,
      attempt: end.evidence.attempt, evidenceVersion: end.evidence.version, ownerVersion: final.version });
    report.pass = true;
    delete report.errorCode;
  } catch (error) {
    report.pass = false;
    report.errorCode = /^[A-Z][A-Z_]{1,80}$/.test(error.message ?? '') ? error.message : 'S3_RESUME_FAILED';
    process.exitCode = 1;
  } finally {
    token = undefined;
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ pass: report.pass, errorCode: report.errorCode, put: report.put }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('S3_RESUME_PREFLIGHT_FAILED'); process.exitCode = 1; });
}
