import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'output/cu27');
const profile = resolve(output, 'profile-1793854003044');
const proofPath = resolve(output, 'pwa-photo-resume.json');
const copyPath = resolve(output, 'fixture/pwa-copy.private.json');
const source = 'http://127.0.0.1:4285', target = 'http://127.0.0.1:4286';
const originalId = '703a26f5-5c52-4500-88c4-4dc41ebae813';
const conflictId = 'd6be22ef-1b8c-4433-8312-d5b0eee2fe84';
const textId = '0a8dbe05-55c8-48a2-b4c0-bcfd47cc3b5a';
const ids = [originalId, conflictId, textId].sort();
const phase = process.argv[2]?.replace(/^--/, '');
const phases = ['export', 'import', 'sync', 'verify'];
if (process.argv.includes('--help') || !phases.includes(phase) || process.argv.length !== 3) {
  console.log('Usage: node scripts/cu27/resume-pwa-photo.mjs --export|--import|--sync|--verify');
  console.log('Run only the phase released by the parent. CU27_ACCOUNT_FILE defaults to output/stack/cu16-proof.accounts.private.json. CU27_MS04_CONTAINER enables owner-scoped Docker HTTP reads.');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, child) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.entries(child).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))) : child);
const digest = value => hash(canonical(value));
const check = (condition, code) => { if (!condition) throw new Error(code); };
const report = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) : {
  schemaVersion: 1, operationIds: ids, phases: {}, attempts: [], uploads: [], visual: 'NOT_RUN', pass: false,
};
let context, page, authorization, actor, stage = 'preflight', coldAttempts = 0, pkceObserved = false;
let tokenTasks = [], syncAllowed = false, unexpectedWrites = 0;
const origin = phase === 'export' ? source : target;
const save = () => { mkdirSync(output, { recursive: true }); writeFileSync(proofPath, JSON.stringify(report, null, 2), { mode: 0o600 }); };
const fact = (name, details = {}) => {
  report.attempts.push({ phase, stage: name, status: 'PASS', ...details }); save();
  console.log(JSON.stringify({ phase, stage: name, status: 'PASS', ...details }));
};
async function idle() {
  await page.waitForFunction(() => document.querySelector('#offline-download') && !document.querySelector('#offline-download').disabled, null, { timeout: 120000 });
}
async function launch(offline = false) {
  authorization = undefined; actor = undefined; tokenTasks = []; pkceObserved = false;
  const requireApp = createRequire(resolve(root, 'web/mf-employees/package.json'));
  const { chromium } = requireApp(resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
  context = await chromium.launchPersistentContext(profile, { headless: true, offline, acceptDownloads: true, timezoneId: 'America/La_Paz' });
  context.setDefaultTimeout(45000); page = context.pages()[0] || await context.newPage();
  context.on('request', request => {
    const url = new URL(request.url());
    if (offline && (url.pathname.includes('/identity/') || url.pathname === '/graphql' || url.pathname.startsWith('/api/'))) coldAttempts++;
    if (url.origin === origin && url.pathname.endsWith('/protocol/openid-connect/auth')) {
      pkceObserved ||= url.searchParams.get('response_type') === 'code' && url.searchParams.get('code_challenge_method') === 'S256' && !!url.searchParams.get('code_challenge');
    }
    if (url.origin === origin && url.pathname === '/graphql' && request.headers().authorization) authorization = request.headers().authorization;
  });
  context.on('response', response => {
    const request = response.request(), url = new URL(response.url());
    if (url.origin === origin && url.pathname.endsWith('/protocol/openid-connect/token') && response.ok()) {
      tokenTasks.push((async () => {
        const body = await response.json();
        if (body.access_token) {
          const claims = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString());
          check(claims.iss === origin + '/identity/realms/autonexus', 'CANONICAL_ISSUER_MISMATCH');
          actor = claims.sub; authorization = 'Bearer ' + body.access_token;
        }
      })().catch(() => { actor = undefined; authorization = undefined; }));
    }
    if (request.method() === 'PUT' && url.protocol === 'https:' && (url.hostname === 'amazonaws.com' || url.hostname.endsWith('.amazonaws.com'))) {
      report.uploads.push({ phase, https: true, status: response.status(), bearerAbsent: !request.headers().authorization }); save();
    }
  });
  if (!offline) await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const identity = url.origin === origin && url.pathname.startsWith('/identity/');
    let mutation = false;
    if (url.pathname === '/graphql' && request.method() === 'POST') {
      try { mutation = /\bmutation\b/.test(request.postDataJSON()?.query || ''); } catch { mutation = true; }
    } else mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method());
    if (!syncAllowed && mutation && !identity) { unexpectedWrites++; await route.abort(); return; }
    await route.continue();
  });
  await page.goto(origin + '/offline.html', { waitUntil: 'domcontentloaded' });
  await Promise.race([page.locator('#offline-day').waitFor(), page.locator('#username').waitFor()]);
}
async function login() {
  const accountFile = resolve(root, process.env.CU27_ACCOUNT_FILE || 'output/stack/cu16-proof.accounts.private.json');
  const account = JSON.parse(readFileSync(accountFile, 'utf8')).accounts.mechanicA;
  check(account?.username && account?.password, 'MECHANIC_FIXTURE_REQUIRED');
  if (!await page.locator('#username').count() && !(await page.locator('#session-status').textContent()).includes('Sesión iniciada')) await page.locator('#session-login').click();
  await Promise.race([
    page.locator('#username').waitFor().then(async () => {
      check(new URL(page.url()).origin === origin && new URL(page.url()).pathname.startsWith('/identity/'), 'LOGIN_ORIGIN_MISMATCH');
      await page.locator('#username').fill(account.username); await page.locator('#password').fill(account.password); await page.locator('#kc-login').click();
    }),
    page.waitForFunction(() => document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada')),
  ]);
  await page.waitForFunction(() => document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada'));
  await Promise.all(tokenTasks); await idle();
  check(pkceObserved && actor && authorization, 'REAL_PKCE_BROWSER_TOKEN_REQUIRED');
  const claims = JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString());
  check(claims.sub === actor && claims.iss === origin + '/identity/realms/autonexus', 'BROWSER_SUBJECT_OR_ISSUER_MISMATCH');
}
async function inspect() {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(db => db.name === 'autonexus-offline')) return { works: [], queue: [] };
    const db = await new Promise((ok, no) => { const r = indexedDB.open('autonexus-offline'); r.onsuccess = () => ok(r.result); r.onerror = () => no(new Error('IDB_READ_FAILED')); r.onupgradeneeded = () => { r.transaction.abort(); no(new Error('IDB_MISSING')); }; });
    try {
      const tx = db.transaction(['works', 'queue'], 'readonly');
      const all = name => new Promise((ok, no) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(new Error('IDB_READ_FAILED')); });
      const [works, queue] = await Promise.all([all('works'), all('queue')]);
      for (const row of queue) if (row.photo) {
        const photo = row.photo;
        row.photo = { mime: photo.type, bytes: photo.size, sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await photo.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('') };
      }
      return { works, queue };
    } finally { db.close(); }
  });
}
function summary(records) {
  return {
    workCount: records.works.length, queueCount: records.queue.length,
    works: records.works.map(w => ({ assignmentId: w.assignmentId, orderId: w.orderId, fingerprint: digest(w) })).sort((a, b) => a.assignmentId.localeCompare(b.assignmentId)),
    queue: records.queue.map(r => ({ operationId: r.operationId, assignmentId: r.assignmentId, state: r.state,
      fingerprint: digest(r), metadataFingerprint: digest({ ...r, progress: undefined, state: undefined, lastCode: undefined, overlayId: undefined }),
      progressFingerprint: digest(r.progress || {}), advanceId: r.progress?.advanceId || null, evidenceId: r.progress?.evidenceId || null,
      photoBytes: r.photo?.bytes || 0, photoHashMatches: !!r.photo && r.photo.sha256 === r.photoSha256,
      inferenceHashMatches: !!r.photo && r.clientInference?.imageSha256 === r.photo.sha256,
      dentReview: canonical(r.clientInference?.humanReview?.labels) === '["dent"]',
    })).sort((a, b) => a.operationId.localeCompare(b.operationId)),
  };
}
function validateRecords(records, expectedActor = actor) {
  check(canonical(records.queue.map(r => r.operationId).sort()) === canonical(ids), 'THREE_PRESERVED_ROWS_REQUIRED');
  check(records.works.length > 0 && records.works.every(w => w.subject === expectedActor) && records.queue.every(r => r.subject === expectedActor), 'OWNER_SUBJECT_MISMATCH');
  const original = records.queue.find(r => r.operationId === originalId);
  check(original.photo?.bytes === 39808 && original.photo.sha256 === original.photoSha256 && original.clientInference?.imageSha256 === original.photo.sha256, 'ORIGINAL_PHOTO_HASH_MISMATCH');
  check(canonical(original.clientInference?.humanReview?.labels) === '["dent"]', 'HUMAN_REVIEW_NOT_PRESERVED');
  check(original.progress?.advanceId, 'ORIGINAL_ADVANCE_PROGRESS_REQUIRED');
  check(records.queue.find(r => r.operationId === conflictId).state === 'conflict' && records.queue.find(r => r.operationId === textId).state === 'applied', 'TERMINAL_ROWS_NOT_PRESERVED');
  return original;
}
function readCopy() {
  const raw = JSON.parse(readFileSync(copyPath, 'utf8'));
  check(raw.version === 1 && raw.sourceOrigin === source, 'COPY_VERSION_OR_SOURCE_MISMATCH');
  for (const row of raw.queue) if (row.photo) {
    const bytes = Buffer.from(row.photo.base64, 'base64');
    row.photo = { mime: row.photo.mime, bytes: bytes.length, sha256: hash(bytes) };
  }
  validateRecords(raw, raw.subject);
  check(canonical(summary(raw)) === canonical(report.sourceSnapshot), 'COPY_EXPORT_PROOF_MISMATCH');
  return raw;
}
function comparePreserved(records) {
  validateRecords(records, actor || records.queue[0]?.subject);
  const actual = summary(records), before = report.sourceSnapshot;
  check(canonical(actual.works) === canonical(before.works), 'PREPARED_WORK_VERSION_CHANGED');
  for (const row of actual.queue) {
    const old = before.queue.find(r => r.operationId === row.operationId);
    check(row.metadataFingerprint === old.metadataFingerprint, 'QUEUE_METADATA_CHANGED');
    if (row.operationId !== originalId) check(row.fingerprint === old.fingerprint, 'OTHER_TERMINAL_ROW_CHANGED');
    else {
      check(row.advanceId === old.advanceId, 'ORIGINAL_ADVANCE_REPLACED');
      if (old.evidenceId) check(row.evidenceId === old.evidenceId, 'ORIGINAL_EVIDENCE_REPLACED');
    }
  }
  const original = records.queue.find(r => r.operationId === originalId);
  const prior = readCopy().queue.find(r => r.operationId === originalId);
  for (const [id, step] of Object.entries(prior.progress?.steps || {})) {
    check(canonical(original.progress?.steps?.[id]?.input) === canonical(step.input), 'ORIGINAL_STEP_INPUT_REPLACED');
  }
}
async function query(query, variables) {
  check(authorization, 'BROWSER_BEARER_REQUIRED');
  const response = await context.request.post(origin + '/graphql', { headers: { authorization }, data: { query, variables } });
  check(response.ok(), 'OWNER_QUERY_HTTP_FAILURE');
  const body = await response.json(); check(!body.errors?.length, 'OWNER_QUERY_CONTRACT_OR_AUTH_FAILURE'); return body.data;
}
async function execution(row) {
  return (await query('query ResumeExecution($id:UUID!){myExecution(assignmentId:$id){version advances{id evidences{id state}}}}', { id: row.assignmentId })).myExecution;
}
function ownerAdvance(data, row, available = false) {
  const matching = data.advances.filter(a => a.id === row.progress.advanceId);
  check(matching.length === 1, 'ORIGINAL_OWNER_ADVANCE_NOT_ONCE');
  if (available) check(matching[0].evidences.filter(e => e.id === row.progress.evidenceId && e.state === 'available').length === 1, 'OWNER_EVIDENCE_NOT_AVAILABLE');
}
function derivedId(seed) {
  const b = createHash('sha256').update(seed).digest().subarray(0, 16); b[6] = (b[6] & 15) | 80; b[8] = (b[8] & 63) | 128;
  const h = b.toString('hex'); return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
}
async function persistedAnalysis(row) {
  const lookup = await query('query ResumeInference($id:UUID!){offlineSyncOperation(operationId:$id){operation{state resultJson}}}', { id: derivedId(originalId + ':client-inference') });
  check(lookup.offlineSyncOperation.operation.state === 'applied', 'MS05_INFERENCE_NOT_APPLIED');
  const result = JSON.parse(lookup.offlineSyncOperation.operation.resultJson || 'null');
  check(result?.analysisId && result.origin === 'client', 'MS05_DURABLE_CLIENT_RESULT_MISSING');
  validateAnalysis(result, row);
  const container = process.env.CU27_MS04_CONTAINER;
  check(container && /^[A-Za-z0-9][A-Za-z0-9_.-]+$/.test(container), 'MS04_GET_REQUIRES_CU27_MS04_CONTAINER_CONTRACT_GAP');
  const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }))[0];
  const labels = info.Config?.Labels || {};
  check(labels['com.docker.compose.service'] === 'intelligence' && labels['com.docker.compose.project'] === 'cu16-proof', 'MS04_CONTAINER_OWNER_MISMATCH');
  const workdir = labels['com.docker.compose.project.working_dir'] || '';
  check(workdir.replaceAll('\\', '/').toLowerCase().split('/').includes('autonexus-ai'), 'MS04_COMPOSE_OWNER_UNRESOLVED');
  check(/^[0-9a-f-]{36}$/i.test(result.analysisId), 'INVALID_ANALYSIS_ID');
  const script = 'import sys,json,urllib.request\np=json.load(sys.stdin)\ndef get(path):\n r=urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8000/vision/"+path,headers={"Authorization":p["authorization"]}),timeout=30)\n return json.load(r)\nprint(json.dumps({"stored":get("analyses/"+p["id"]),"listing":get("assignments/"+p["assignmentId"])}))';
  let stored, listing;
  try {
    ({ stored, listing } = JSON.parse(execFileSync('docker', ['exec', '-i', container, 'python', '-c', script], {
      input: JSON.stringify({ id: result.analysisId, assignmentId: row.assignmentId, authorization }), encoding: 'utf8', timeout: 75000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    })));
  } catch { throw new Error('MS04_AUTHORIZED_HTTP_GET_FAILED'); }
  validateAnalysis(stored, row); check(stored.analysisId === result.analysisId, 'MS04_ANALYSIS_ID_MISMATCH');
  check(listing.assignmentId === row.assignmentId && Array.isArray(listing.items), 'MS04_LIST_CONTRACT_MISMATCH');
  check(listing.items.filter(a => a.origin === 'client' && a.evidenceId === row.progress.evidenceId && a.imageSha256 === row.photoSha256 && a.modelVersion === row.clientInference.modelVersion).length === 1, 'MS04_ORIGINAL_ANALYSIS_NOT_ONCE');
  return { analysisId: stored.analysisId, fingerprint: digest({ ...stored, replayed: undefined }), analysisCount: listing.items.length,
    analysisIdsFingerprint: digest(listing.items.map(a => a.analysisId).sort()), coordinatorMatchesOwner: true, clientOrigin: true, modelMatches: true, imageHashMatches: true, humanReviewMatches: true };
}
function validateAnalysis(value, row) {
  const expected = row.clientInference;
  check(value.origin === 'client' && value.verifiedByServer === false && value.assignmentId === row.assignmentId && value.evidenceId === row.progress.evidenceId, 'CLIENT_ANALYSIS_PROVENANCE_MISMATCH');
  check(value.modelVersion === expected.modelVersion && value.runId === expected.runId && value.imageSha256 === expected.imageSha256, 'CLIENT_ANALYSIS_MODEL_OR_HASH_MISMATCH');
  check(canonical(value.labels) === canonical(expected.labels) && value.humanReview?.modelVersion === expected.humanReview.modelVersion && canonical(value.humanReview?.labels) === '["dent"]', 'CLIENT_ANALYSIS_REVIEW_MISMATCH');
}
try {
  check(existsSync(profile), 'PRESERVED_PROFILE_MISSING');
  for (const path of [copyPath, proofPath]) execFileSync('git', ['check-ignore', '--quiet', path], { cwd: root, stdio: 'pipe' });
  if (phase !== 'export') check(report.phases.export?.pass, 'EXPORT_PHASE_REQUIRED');
  if (phase === 'sync') check(report.phases.import?.pass, 'IMPORT_PHASE_REQUIRED');
  if (phase === 'verify') check(report.phases.sync?.pass, 'SUCCESSFUL_SYNC_REQUIRED');
  if (phase === 'export') check(!report.phases.import?.pass, 'EXPORT_AFTER_IMPORT_REFUSED');
  if (phase === 'verify') {
    stage = 'offline_cold_reopen'; await launch(true); await idle();
    const local = await inspect(); comparePreserved(local); const row = validateRecords(local, local.queue[0]?.subject);
    check(row.state === 'applied' && row.progress.inferenceApplied && coldAttempts === 0, 'OFFLINE_APPLIED_PERSISTENCE_FAILED');
    await context.close(); context = undefined;
    fact(stage, { photoAndReviewPreserved: true, identityApiAttempts: coldAttempts });
  }
  stage = 'real_pkce_login'; await launch(); await login(); fact(stage, { sameOriginIssuer: true, pkceS256: true });
  if (phase === 'export') {
    stage = 'source_readonly_before'; const before = await inspect(); validateRecords(before); report.sourceSnapshot = summary(before); save();
    check(!existsSync(copyPath), 'PRIVATE_COPY_ALREADY_EXISTS_NO_OVERWRITE');
    stage = 'normal_ui_export'; await page.locator('#offline-transfer > summary').click();
    const download = page.waitForEvent('download'); await page.locator('#offline-export').click(); const artifact = await download;
    check(!await artifact.failure(), 'EXPORT_DOWNLOAD_FAILED');
    mkdirSync(dirname(copyPath), { recursive: true }); writeFileSync(copyPath, '', { flag: 'wx', mode: 0o600 });
    await artifact.saveAs(copyPath); chmodSync(copyPath, 0o600); await artifact.delete(); await idle();
    const copied = readCopy(); check(copied.subject === actor, 'COPY_SUBJECT_MISMATCH');
    check(canonical(summary(await inspect())) === canonical(report.sourceSnapshot), 'SOURCE_MUTATED_DURING_EXPORT');
    report.phases.export = { pass: true, fileVersion: 1, queueCount: 3, sourceBeforeAfterMatching: true, fileMetadataHashProgressMatching: true, requestedMode: '0600' };
    fact(stage, report.phases.export);
  } else {
    const copy = readCopy(); check(copy.subject === actor, 'SAME_REALM_SUBJECT_REQUIRED');
    let records = await inspect();
    if (phase === 'import') {
      stage = 'normal_ui_import';
      if (records.works.length || records.queue.length) {
        check(canonical(summary(records)) === canonical(report.sourceSnapshot), 'NONEMPTY_TARGET_NO_OVERWRITE');
        fact('prior_exact_import_skipped', { allThreeExact: true, noOverwrite: true });
      } else {
        await page.locator('#offline-transfer > summary').click(); await page.locator('#offline-import').setInputFiles(copyPath); await idle();
        records = await inspect(); check(canonical(summary(records)) === canonical(report.sourceSnapshot), 'UI_ATOMIC_IMPORT_MISMATCH');
      }
      stage = 'prepare_model_only'; await page.locator('#offline-model').click(); await idle();
      check((await page.locator('#offline-model-status').textContent()).startsWith('Modelo preparado:'), 'LOCAL_MODEL_PREPARATION_FAILED');
      await page.waitForFunction(() => !!navigator.serviceWorker.controller); comparePreserved(await inspect());
      report.phases.import = { pass: true, allThreeExact: true, originalProgressPreserved: true, sourceProofMatches: true, preparedVersionUnchanged: true, localModelPrepared: true };
      fact(stage, report.phases.import);
    } else {
      stage = 'owner_before'; comparePreserved(records); let row = validateRecords(records);
      const before = await execution(row); ownerAdvance(before, row, phase === 'verify');
      if (phase === 'sync') {
        const active = records.queue.filter(r => !['applied', 'conflict', 'rejected'].includes(r.state));
        check(active.length === 1 && active[0].operationId === originalId, 'ONLY_ORIGINAL_MAY_SYNC');
        check(process.env.CU27_MS04_CONTAINER, 'MS04_GET_REQUIRES_CU27_MS04_CONTAINER_CONTRACT_GAP');
      }
      const analysisBefore = phase === 'verify' ? await persistedAnalysis(row) : undefined;
      fact(stage, { originalAdvanceCount: 1, advanceId: row.progress.advanceId });
      stage = phase === 'sync' ? 'real_ui_photo_sync' : 'second_ui_sync'; const uploadOffset = report.uploads.length;
      syncAllowed = true; await page.locator('#offline-sync').click(); await idle(); syncAllowed = false;
      records = await inspect(); comparePreserved(records); row = validateRecords(records);
      report.observed = { operationId: originalId, state: row.state, advanceId: row.progress.advanceId, evidenceId: row.progress.evidenceId || null, inferenceApplied: !!row.progress.inferenceApplied };
      save(); check(row.state === 'applied' && row.progress.inferenceApplied, 'REAL_SYNC_INCOMPLETE');
      const after = await execution(row); ownerAdvance(after, row, true); const persisted = await persistedAnalysis(row);
      check(after.advances.length === before.advances.length, 'SYNC_CREATED_ANOTHER_ADVANCE');
      if (phase === 'sync') check(report.uploads.slice(uploadOffset).some(u => u.status === 200 && u.https && u.bearerAbsent), 'REAL_HTTPS_S3_PUT_200_REQUIRED');
      else {
        check(canonical(after) === canonical(before), 'SECOND_SYNC_CHANGED_EXECUTION');
        check(persisted.fingerprint === analysisBefore.fingerprint && persisted.analysisId === analysisBefore.analysisId, 'SECOND_SYNC_CHANGED_ANALYSIS');
        check(persisted.analysisCount === analysisBefore.analysisCount && persisted.analysisIdsFingerprint === analysisBefore.analysisIdsFingerprint, 'SECOND_SYNC_CREATED_ANALYSIS');
        check(report.uploads.length === uploadOffset, 'SECOND_SYNC_UPLOADED_AGAIN');
      }
      report.phases[phase] = { pass: true, originalAdvanceCountBefore: 1, originalAdvanceCountAfter: 1, evidenceId: row.progress.evidenceId, evidenceAvailable: true, ...persisted, ...(phase === 'verify' ? { offlineReopenPassed: true, secondSyncUnchanged: true } : {}) };
      fact(stage, report.phases[phase]);
    }
  }
  check(unexpectedWrites === 0, 'UNEXPECTED_NETWORK_WRITE_BLOCKED');
  report.pass = phases.every(p => report.phases[p]?.pass); report.exit = 0;
  report.status = report.pass ? 'PASS' : 'PARTIAL_PHASES_REMAIN';
} catch (error) {
  const code = error?.name === 'TimeoutError' ? 'BROWSER_TIMEOUT' : /^[A-Z][A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'HARNESS_OR_RUNTIME_FAILURE';
  report.attempts.push({ phase, stage, status: 'FAIL', code }); report.exit = 1; report.pass = false;
  report.phases[phase] = { ...report.phases[phase], pass: false, lastFailure: code };
  report.status = report.attempts.some(a => a.status === 'PASS') ? 'PARTIAL' : 'BLOCKED';
  console.log(JSON.stringify({ phase, stage, status: 'FAIL', code }));
} finally {
  syncAllowed = false; if (context) await context.close().catch(() => {});
  authorization = undefined; actor = undefined;
  report.finishedAt = new Date().toISOString(); save(); process.exitCode = report.exit;
}
