import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const expected = Object.freeze({
  operationId: 'b3bbc27c-5ec7-4b5c-89f5-4a16fe93e1ec',
  advanceId: '7cef67b3-3e86-4420-b8c6-98b914aba0ad',
  assignmentId: '359cde57-3df0-4d53-b5b3-e18303ca4994',
  marker: 'CU27-MOBILE-PHOTO-20261105C', photoBytes: 61032,
  imageSha256: '1ebbdd84538324718b37f7611b2ab27ce22a8a69f97b14fd29f6c6de015a1b8e',
  runId: '20261101T-with-negatives', modelVersion: 'automotive-damage-mobilenetv2-v1',
});
const check = (condition, code) => { if (!condition) throw new Error(code); };
const canonical = value => JSON.stringify(value, (_, child) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function derivedId(seed) {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
}
export function localRow(metadata) {
  const rows = metadata.queue.filter(row => row.operationId === expected.operationId);
  check(rows.length === 1, 'LOCAL_OPERATION_NOT_ONCE');
  const row = rows[0];
  check(typeof row.description === 'string' && row.description.includes(expected.marker), 'LOCAL_DESCRIPTOR_MISMATCH');
  check(row.state === 'applied' && row.evidenceState === 'available' && row.inferenceState === 'applied', 'LOCAL_PHOTO_NOT_APPLIED');
  check(row.photoBytes === expected.photoBytes && row.imageSha256 === expected.imageSha256 && row.actualFileSha256 === expected.imageSha256, 'LOCAL_PHOTO_BYTES_OR_HASH_MISMATCH');
  check(row.runId === expected.runId && row.modelVersion === expected.modelVersion, 'LOCAL_MODEL_MISMATCH');
  check(row.humanReviewLabels === '' && typeof row.humanReviewedAt === 'string' && Number.isFinite(Date.parse(row.humanReviewedAt)), 'LOCAL_EXPLICIT_EMPTY_REVIEW_REQUIRED');
  check(row.advanceId === expected.advanceId && row.evidenceId, 'LOCAL_OWNER_IDS_REQUIRED');
  return { ...row, labels: parseLabels(row.labels) };
}
export function parseLabels(raw) {
  check(typeof raw === 'string', 'LOCAL_RAW_SCORES_REQUIRED');
  const labels = raw.split(',').map(part => {
    const pair = part.split(':'); const score = Number(pair[1]);
    check(pair.length === 2 && pair[0] && pair[1] !== '' && Number.isFinite(score) && score >= 0 && score <= 1, 'LOCAL_SCORE_INVALID');
    return { name: pair[0], score };
  });
  check(labels.length === 4 && new Set(labels.map(label => label.name)).size === 4, 'FOUR_DISTINCT_RAW_SCORES_REQUIRED');
  return labels;
}
export function validateAnalysis(value, row) {
  check(value?.origin === 'client' && value.verifiedByServer === false && value.assignmentId === expected.assignmentId && value.evidenceId === row.evidenceId, 'ANALYSIS_PROVENANCE_MISMATCH');
  check(value.runId === expected.runId && value.modelVersion === expected.modelVersion && value.imageSha256 === expected.imageSha256, 'ANALYSIS_MODEL_OR_HASH_MISMATCH');
  const byName = labels => [...labels].sort((a, b) => a.name.localeCompare(b.name));
  check(Array.isArray(value.labels) && canonical(byName(value.labels)) === canonical(byName(row.labels)), 'ANALYSIS_RAW_SCORES_CHANGED');
  check(value.humanReview?.modelVersion === expected.modelVersion && canonical(value.humanReview.labels) === '[]', 'ANALYSIS_EMPTY_REVIEW_NOT_PRESERVED');
}
export function snapshot(row, execution, stored, listing) {
  const matching = execution.advances.filter(advance => advance.description === row.description);
  check(matching.length === 1 && matching[0].id === row.advanceId, 'OWNER_ADVANCE_NOT_ONCE');
  const evidences = matching[0].evidences ?? [];
  check(evidences.length === 1 && evidences[0].id === row.evidenceId && evidences[0].state === 'available', 'OWNER_SINGLE_AVAILABLE_EVIDENCE_REQUIRED');
  validateAnalysis(stored, row);
  check(listing.assignmentId === expected.assignmentId && Array.isArray(listing.items), 'MS04_LIST_CONTRACT_MISMATCH');
  const analyses = listing.items.filter(item => item.evidenceId === row.evidenceId && item.imageSha256 === expected.imageSha256 && item.modelVersion === expected.modelVersion);
  check(analyses.length === 1 && analyses[0].analysisId === stored.analysisId, 'MS04_ANALYSIS_NOT_ONCE');
  validateAnalysis(analyses[0], row);
  check(Number.isInteger(execution.version), 'OWNER_EXECUTION_VERSION_REQUIRED');
  return {
    operationId: expected.operationId, assignmentId: expected.assignmentId, version: execution.version,
    advanceId: row.advanceId, evidenceId: row.evidenceId, analysisId: stored.analysisId,
    advanceCount: execution.advances.length, evidenceCount: execution.advances.reduce((n, a) => n + (a.evidences?.length ?? 0), 0),
    analysisCount: listing.items.length,
    advanceIds: execution.advances.map(a => a.id).sort(),
    evidenceIds: execution.advances.flatMap(a => (a.evidences ?? []).map(e => e.id)).sort(),
    analysisIds: listing.items.map(a => a.analysisId).sort(),
    localFingerprint: digest(row), analysisFingerprint: digest({ ...stored, replayed: undefined }),
    photoBytes: row.photoBytes, imageSha256: row.imageSha256, runId: row.runId, modelVersion: row.modelVersion,
    rawScoresMatch: true, explicitEmptyHumanReview: true, fileHashMatches: true,
  };
}
export function compareReplay(before, after) {
  check(canonical(before) === canonical(after), 'SECOND_SYNC_CHANGED_SNAPSHOT');
}
async function run(phase) {
  const proofPath = resolve(root, 'output/cu27/mobile-photo.json');
  let report, token, stage = 'preflight';
  try {
    execFileSync('git', ['check-ignore', '--quiet', proofPath], { cwd: root, stdio: 'pipe' });
    report = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) : { schemaVersion: 1, operationId: expected.operationId, attempts: [], pass: false };
    check(report.schemaVersion === 1 && report.operationId === expected.operationId, 'REPORT_SCOPE_MISMATCH');
    if (phase === '--replay-check') check(report.baseline && report.verified, 'VERIFIED_BASELINE_REQUIRED');
    if (phase === '--verify') check(!report.baseline, 'BASELINE_ALREADY_EXISTS_USE_REPLAY_CHECK');
    const save = () => { mkdirSync(dirname(proofPath), { recursive: true }); writeFileSync(proofPath, JSON.stringify(report, null, 2), { mode: 0o600 }); };
    const fact = details => { report.attempts.push({ phase, stage, status: 'PASS', ...details }); save(); };
    stage = 'device_readonly_metadata';
    const metadata = JSON.parse(execFileSync(process.execPath, [resolve(root, 'scripts/cu27/inspect-device-queue.mjs')], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 }));
    const row = localRow(metadata); fact({ state: row.state, fileHashMatches: true, explicitEmptyHumanReview: true });
    stage = 'synthetic_mechanic_pkce';
    const origin = 'http://127.0.0.1:4286';
    const fixture = JSON.parse(readFileSync(resolve(root, process.env.CU27_ACCOUNT_FILE || 'output/stack/cu16-proof.accounts.private.json'), 'utf8')).accounts.mechanicA;
    token = (await authorize({ ...fixture, enabled: true }, false, { issuer: origin + '/identity/realms/autonexus', redirect: origin + '/auth/callback' })).access_token;
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    check(claims.iss === origin + '/identity/realms/autonexus', 'PUBLIC_ISSUER_MISMATCH'); fact({ issuerMatches: true });
    const get = async url => {
      const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      check(response.status === 200, 'AUTHORIZED_GET_FAILED'); return response.json();
    };
    stage = 'owner_and_coordinator_get';
    const execution = await get('http://127.0.0.1:8081/executions/me/' + expected.assignmentId);
    const operation = (await get('http://127.0.0.1:3005/sync/operations/' + expected.operationId)).operation;
    const inference = (await get('http://127.0.0.1:3005/sync/operations/' + derivedId(expected.operationId + ':client-inference'))).operation;
    check(operation?.state === 'applied' && inference?.state === 'applied', 'MS05_OPERATIONS_NOT_APPLIED');
    check(operation.lastBody?.advance?.id === row.advanceId, 'MS05_OWNER_ADVANCE_ID_MISMATCH');
    const result = inference.lastBody;
    check(result?.analysisId && /^[0-9a-f-]{36}$/i.test(result.analysisId), 'MS05_DURABLE_ANALYSIS_ID_REQUIRED');
    validateAnalysis(result, row); fact({ coordinatorApplied: true });
    stage = 'ms04_authenticated_http_get';
    const container = process.env.CU27_MS04_CONTAINER;
    check(container && /^[A-Za-z0-9][A-Za-z0-9_.-]+$/.test(container), 'CU27_MS04_CONTAINER_REQUIRED');
    const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }))[0];
    const labels = info.Config?.Labels || {};
    check(labels['com.docker.compose.service'] === 'intelligence' && labels['com.docker.compose.project'] === 'cu16-proof', 'MS04_CONTAINER_OWNER_MISMATCH');
    check((labels['com.docker.compose.project.working_dir'] || '').replaceAll('\\', '/').toLowerCase().split('/').includes('autonexus-ai'), 'MS04_COMPOSE_OWNER_UNRESOLVED');
    const script = 'import sys,json,urllib.request\np=json.load(sys.stdin)\ndef get(path):\n r=urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8000/vision/"+path,headers={"Authorization":"Bearer "+p["token"]}),timeout=30)\n return json.load(r)\nprint(json.dumps({"stored":get("analyses/"+p["id"]),"listing":get("assignments/"+p["assignmentId"])}))';
    let remote;
    try {
      remote = JSON.parse(execFileSync('docker', ['exec', '-i', container, 'python', '-c', script], {
        input: JSON.stringify({ token, id: result.analysisId, assignmentId: expected.assignmentId }), encoding: 'utf8', timeout: 75000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
      }));
    } catch { throw new Error('MS04_AUTHORIZED_HTTP_GET_FAILED'); }
    check(remote.stored.analysisId === result.analysisId, 'MS04_COORDINATOR_ID_MISMATCH');
    const current = snapshot(row, execution, remote.stored, remote.listing); fact({ ownerAndAnalysisMatched: true });
    stage = phase === '--verify' ? 'baseline_snapshot' : 'second_sync_comparison';
    if (phase === '--verify') { report.baseline = current; report.verified = true; }
    else { compareReplay(report.baseline, current); report.replaySnapshot = current; report.replayChecked = true; }
    report.pass = !!report.verified && !!report.replayChecked; report.status = report.pass ? 'PASS' : 'VERIFIED_REPLAY_PENDING'; fact({ unchanged: phase === '--replay-check' });
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'VERIFIER_RUNTIME_FAILURE';
    if (report) { report.attempts.push({ phase, stage, status: 'FAIL', code }); report.pass = false; report.status = 'BLOCKED'; }
    console.log(JSON.stringify({ phase, stage, status: 'FAIL', code })); process.exitCode = 1;
  } finally {
    token = undefined;
    if (report) { report.updatedAt = new Date().toISOString(); mkdirSync(dirname(proofPath), { recursive: true }); writeFileSync(proofPath, JSON.stringify(report, null, 2), { mode: 0o600 }); }
  }
  if (!process.exitCode) console.log(JSON.stringify({ phase, status: report.status, report: 'output/cu27/mobile-photo.json' }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phase = process.argv[2];
  if (process.argv.length !== 3 || !['--verify', '--replay-check'].includes(phase)) {
    console.log('Usage: node scripts/cu27/verify-mobile-photo.mjs --verify|--replay-check');
    console.log('Read-only checks only after parent release; set CU27_MS04_CONTAINER to the existing intelligence container. Parent performs second UI sync before --replay-check.');
    process.exitCode = phase === '--help' ? 0 : 2;
  } else await run(phase);
}
