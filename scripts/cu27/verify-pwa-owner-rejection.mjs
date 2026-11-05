import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { withRevokedMechanic } from './with-revoked-mechanic.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'http://127.0.0.1:4286';
const profile = resolve(root, 'output/cu27/profile-1793854003044');
const proofPath = resolve(root, 'output/cu27/pwa-owner-rejection.json');
const preservedIds = ['703a26f5-5c52-4500-88c4-4dc41ebae813', 'd6be22ef-1b8c-4433-8312-d5b0eee2fe84', '0a8dbe05-55c8-48a2-b4c0-bcfd47cc3b5a'];
const phase = process.argv[2];
if (process.argv.includes('--help') || !['--prepare', '--reject'].includes(phase) || process.argv.length !== 3) {
  console.log('Usage: node scripts/cu27/verify-pwa-owner-rejection.mjs --prepare|--reject');
  console.log('--prepare creates only a local offline photo draft. --reject requires parent coordination and invokes reversible role revocation.');
  process.exit(process.argv.includes('--help') ? 0 : 2);
}
const check = (condition, code) => { if (!condition) throw new Error(code); };
const canonical = value => JSON.stringify(value, (_, child) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.entries(child).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))) : child);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const metadata = row => digest({ ...row, state: undefined, lastCode: undefined, progress: undefined, overlayId: undefined });
const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(value) ? value : 'UNEXPECTED_BUSINESS_CODE';
const report = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) : { schemaVersion: 1, prepare: { pass: false }, rejection: { pass: false, status: 'NOT_RUN' }, stages: [], visual: 'NOT_RUN', pass: false };
let context, page, authorization, actor, tokens = [], pkce = false, stage = 'preflight';
let allowSync = false, blockedWrites = 0, ownerResults = [], responseTasks = [];
const save = () => { mkdirSync(dirname(proofPath), { recursive: true }); writeFileSync(proofPath, JSON.stringify(report, null, 2), { mode: 0o600 }); };
const pass = (name, facts = {}) => { report.stages.push({ phase, name, status: 'PASS', ...facts }); save(); console.log(JSON.stringify({ stage: name, status: 'PASS', ...facts })); };
async function idle() {
  await page.waitForFunction(() => document.querySelector('#offline-download') && !document.querySelector('#offline-download').disabled, null, { timeout: 120000 });
}
async function close() {
  if (context) { await context.close(); context = undefined; }
  authorization = undefined; actor = undefined; tokens = []; responseTasks = [];
}
async function open() {
  check(!context, 'PROFILE_ALREADY_OPEN');
  pkce = false; tokens = []; responseTasks = []; ownerResults = [];
  const requireApp = createRequire(resolve(root, 'web/mf-employees/package.json'));
  const { chromium } = requireApp(resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
  context = await chromium.launchPersistentContext(profile, { headless: true, timezoneId: 'America/La_Paz' });
  context.setDefaultTimeout(45000); page = context.pages()[0] || await context.newPage();
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname.endsWith('/protocol/openid-connect/auth')) pkce ||= url.searchParams.get('response_type') === 'code' && url.searchParams.get('code_challenge_method') === 'S256' && !!url.searchParams.get('code_challenge');
  });
  context.on('response', response => {
    const url = new URL(response.url()), request = response.request();
    if (url.origin !== origin) return;
    if (url.pathname.endsWith('/protocol/openid-connect/token') && response.ok()) tokens.push((async () => {
      const body = await response.json();
      const claims = JSON.parse(Buffer.from(body.access_token.split('.')[1], 'base64url').toString());
      check(claims.iss === origin + '/identity/realms/autonexus', 'TOKEN_ISSUER_MISMATCH');
      actor = claims.sub; authorization = 'Bearer ' + body.access_token;
    })().catch(() => { actor = undefined; authorization = undefined; }));
    if (url.pathname === '/graphql' && request.method() === 'POST') {
      let input; try { input = request.postDataJSON(); } catch { return; }
      if (input?.query?.includes('pushOfflineSync')) responseTasks.push((async () => {
        const body = await response.json();
        const envelope = body.data?.pushOfflineSync;
        if (response.status() !== 200 || body.errors?.length || !envelope) return;
        const results = JSON.parse(envelope.resultsJson);
        for (const result of results) if (result.operationId === report.prepare.operationId) ownerResults.push({ operationId: result.operationId, status: result.status, code: safeCode(result.code), successfulEnvelope: true });
      })().catch(() => {}));
    }
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith('/identity/')) return route.continue();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
    let allowed = false;
    if (url.origin === origin && url.pathname === '/graphql' && request.method() === 'POST') {
      try {
        const input = request.postDataJSON();
        allowed = !/\bmutation\b/.test(input.query || '');
        if (allowSync && /\bmutation\b/.test(input.query || '')) {
          if (input.query.includes('registerOfflineSync')) {
            const operations = JSON.parse(input.variables.input.operationsJson);
            allowed = operations.length === 1 && operations[0].operationId === report.prepare.operationId && operations[0].entity === 'advance';
          } else allowed = input.query.includes('pushOfflineSync');
        }
      } catch { allowed = false; }
    }
    if (!allowed) { blockedWrites++; return route.abort(); }
    await route.continue();
  });
  await page.goto(origin + '/offline.html', { waitUntil: 'domcontentloaded' });
  await Promise.race([page.locator('#offline-day').waitFor(), page.locator('#username').waitFor()]);
}
async function login() {
  const account = JSON.parse(readFileSync(resolve(root, process.env.CU27_ACCOUNT_FILE || 'output/stack/cu16-proof.accounts.private.json'), 'utf8')).accounts.mechanicA;
  check(account?.username && account?.password && account?.subject, 'FIXTURE_MECHANIC_REQUIRED');
  if (!await page.locator('#username').count() && !(await page.locator('#session-status').textContent()).includes('Sesión iniciada')) await page.locator('#session-login').click();
  await Promise.race([
    page.locator('#username').waitFor().then(async () => {
      check(new URL(page.url()).origin === origin && new URL(page.url()).pathname.startsWith('/identity/'), 'LOGIN_ORIGIN_MISMATCH');
      await page.locator('#username').fill(account.username); await page.locator('#password').fill(account.password); await page.locator('#kc-login').click();
    }),
    page.waitForFunction(() => document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada')),
  ]);
  await page.waitForFunction(() => document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada'));
  await Promise.all(tokens); await idle();
  check(pkce && authorization && actor === account.subject, 'FRESH_BROWSER_PKCE_SAME_SUBJECT_REQUIRED');
}
async function inspect() {
  return page.evaluate(async () => {
    const db = await new Promise((ok, no) => { const r = indexedDB.open('autonexus-offline'); r.onsuccess = () => ok(r.result); r.onerror = () => no(new Error('IDB_READ_FAILED')); r.onupgradeneeded = () => { r.transaction.abort(); no(new Error('IDB_MISSING')); }; });
    try {
      const tx = db.transaction(['works', 'queue'], 'readonly');
      const all = name => new Promise((ok, no) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(new Error('IDB_READ_FAILED')); });
      const [works, queue] = await Promise.all([all('works'), all('queue')]);
      for (const row of queue) if (row.photo) {
        const photo = row.photo;
        row.photo = { bytes: photo.size, mime: photo.type, sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await photo.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('') };
      }
      return { works, queue };
    } finally { db.close(); }
  });
}
function preserve(queue) {
  for (const id of preservedIds) {
    const row = queue.find(r => r.operationId === id);
    check(row && digest(row) === report.preserved[id], 'ORIGINAL_QUEUE_ROW_CHANGED');
  }
}
function draft(records, state) {
  preserve(records.queue);
  const row = records.queue.find(r => r.operationId === report.prepare.operationId);
  check(row?.state === state && row.subject === actor && metadata(row) === report.prepare.metadataFingerprint, 'DRAFT_STATE_OR_METADATA_MISMATCH');
  check(row.photo?.sha256 === row.photoSha256 && row.clientInference?.imageSha256 === row.photoSha256 && canonical(row.clientInference?.humanReview?.labels) === '["dent"]', 'DRAFT_PHOTO_OR_REVIEW_MISMATCH');
  check(digest(records.works) === report.prepare.worksFingerprint, 'PREPARED_WORK_REFRESHED');
  check(records.queue.length === preservedIds.length + 1, 'UNEXPECTED_QUEUE_ROW');
  return row;
}
async function query(query, variables) {
  check(authorization, 'BROWSER_BEARER_REQUIRED');
  const response = await context.request.post(origin + '/graphql', { headers: { authorization }, data: { query, variables } });
  const body = await response.json(); check(response.status() === 200 && !body.errors?.length, 'OWNER_QUERY_FAILED'); return body.data;
}
async function ownerAbsent(row) {
  const data = await query('query PermissionExecution($id:UUID!){myExecution(assignmentId:$id){advances{id description}}}', { id: row.assignmentId });
  check(data.myExecution.advances.filter(a => a.description === report.prepare.marker).length === 0, 'REJECTED_ADVANCE_EXISTS_IN_OWNER');
}
try {
  check(resolve('.') === root, 'RUN_FROM_WORK_MARCELO_REQUIRED');
  check((process.env.CU27_PUBLIC_ORIGIN || origin) === origin && existsSync(profile), 'PROFILE_OR_ORIGIN_MISMATCH');
  execFileSync('git', ['check-ignore', '--quiet', proofPath], { cwd: root, stdio: 'pipe' });
  if (phase === '--prepare') {
    stage = 'prepare_real_pkce'; await open(); await login();
    const before = await inspect();
    if (report.prepare.pass) {
      draft(before, 'pending'); pass('existing_prepared_draft_retained', { operationId: report.prepare.operationId, noDuplicate: true });
    } else {
      check(before.queue.length === 3 && before.queue.every(r => preservedIds.includes(r.operationId) && ['applied', 'conflict', 'rejected'].includes(r.state)), 'ONLY_THREE_TERMINAL_ORIGINAL_ROWS_REQUIRED');
      report.preserved = Object.fromEntries(before.queue.map(r => [r.operationId, digest(r)])); save();
      stage = 'prepare_latest_work_ui'; await page.locator('#offline-day').fill('2026-11-06'); await page.locator('#offline-download').click(); await idle();
      const work = before.works.find(w => w.assignmentId === before.queue.find(r => r.operationId === preservedIds[0]).assignmentId);
      check(work, 'PRESERVED_WORK_REQUIRED');
      await page.getByRole('button', { name: 'Preparar ' + work.orderNumber, exact: true }).click(); await idle();
      check(await page.locator('#offline-work').inputValue() === work.assignmentId, 'LATEST_WORK_NOT_SELECTED');
      await page.locator('#offline-model').click(); await idle();
      check((await page.locator('#offline-model-status').textContent()).startsWith('Modelo preparado:'), 'MODEL_NOT_PREPARED');
      const prepared = await inspect(); preserve(prepared.queue);
      stage = 'offline_photo_inference_human_review'; await context.setOffline(true);
      await page.locator('#offline-work').selectOption(work.assignmentId);
      await page.locator('#offline-photo').setInputFiles(resolve(root, 'mobile/autonexus_app/assets/samples/sample.jpg'));
      await page.locator('#offline-infer').click(); await idle();
      check(await page.locator('#offline-scores p').count() > 0, 'LOCAL_INFERENCE_REQUIRED');
      await page.locator('#offline-review').check(); await page.locator('input[name="human-label"][value="dent"]').check();
      const marker = 'CU27-PWA-PERMISSION-' + Date.now();
      await page.locator('#offline-description').fill(marker); await page.locator('#offline-save').click(); await idle();
      const saved = await inspect(), rows = saved.queue.filter(r => r.description === marker);
      check(rows.length === 1 && rows[0].state === 'pending', 'ONE_LOCAL_DRAFT_REQUIRED');
      const row = rows[0];
      report.prepare = { pass: false, operationId: row.operationId, assignmentId: row.assignmentId, marker, photoBytes: row.photo?.bytes,
        metadataFingerprint: metadata(row), worksFingerprint: digest(saved.works), rowFingerprint: digest(row), photoHashMatches: row.photo?.sha256 === row.photoSha256, inferenceHashMatches: row.clientInference?.imageSha256 === row.photoSha256, reviewPreserved: canonical(row.clientInference?.humanReview?.labels) === '["dent"]' };
      draft(saved, 'pending'); check(blockedWrites === 0, 'UNEXPECTED_MUTATION_BLOCKED');
      report.prepare.pass = true;
      pass(stage, { operationId: row.operationId, photoHashMatches: true, reviewPreserved: true, originalRowsPreserved: true, serverSyncPerformed: false });
    }
    await close(); report.status = 'PREPARED_REJECTION_NOT_RUN'; report.exit = 0;
  } else {
    check(report.prepare.pass && !report.rejection.pass, 'PREPARED_PENDING_DRAFT_REQUIRED');
    stage = 'reversible_owner_rejection';
    await withRevokedMechanic(async ({ origin: scopedOrigin, subject, signal }) => {
      const abort = () => { if (context) void context.close().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        check(scopedOrigin === origin && !signal.aborted, 'REVOCATION_SCOPE_MISMATCH');
        await open(); await login(); check(actor === subject && !signal.aborted, 'REVOKED_SUBJECT_MISMATCH');
        const before = await inspect(); draft(before, 'pending');
        check(before.queue.filter(r => !['applied', 'conflict', 'rejected'].includes(r.state)).length === 1, 'ONLY_NEW_DRAFT_MAY_SYNC');
        allowSync = true; await page.locator('#offline-sync').click(); await idle(); allowSync = false;
        await Promise.all(responseTasks);
        const result = ownerResults.find(r => r.status === 403 && r.successfulEnvelope);
        check(result, 'OWNER_403_IN_SUCCESSFUL_PUSH_ENVELOPE_REQUIRED');
        const local = await inspect(), row = draft(local, 'rejected');
        check(row.lastCode === result.code, 'LOCAL_OWNER_CODE_MISMATCH');
        const item = page.locator('#offline-queue li').filter({ hasText: report.prepare.marker });
        check(await item.count() === 1 && (await item.textContent()).includes('rejected') && (await item.textContent()).includes(result.code), 'REJECTION_NOT_VISIBLE');
        const lookup = await query('query PermissionLookup($id:UUID!){offlineSyncOperation(operationId:$id){operation{state lastStatus lastCode}}}', { id: row.operationId });
        const operation = lookup.offlineSyncOperation.operation;
        check(operation.state === 'rejected' && operation.lastStatus === 403 && operation.lastCode === result.code, 'MS05_OWNER_REJECTION_NOT_DURABLE');
        check(blockedWrites === 0 && !signal.aborted, 'UNEXPECTED_MUTATION_OR_CALLBACK_ABORT');
        report.rejection = { pass: false, ownerObserved: true, ownerStatus: 403, successfulPushEnvelope: true, code: result.code, localRejected: true, ms05Rejected: true, photoAndReviewRetained: true };
        pass('owner_rejection_observed', { operationId: row.operationId, ownerStatus: 403, successfulPushEnvelope: true, code: result.code });
      } finally {
        allowSync = false; signal.removeEventListener('abort', abort); await close();
      }
    }, { routingCompanion: true });
    report.rejection.restorationConfirmed = true; save();
    stage = 'restored_fresh_pkce_owner_absence'; await open(); await login();
    const local = await inspect(), row = draft(local, 'rejected'); await ownerAbsent(row);
    const lookup = await query('query RetainedLookup($id:UUID!){offlineSyncOperation(operationId:$id){operation{state attemptCount lastStatus lastCode}}}', { id: row.operationId });
    check(lookup.offlineSyncOperation.operation.state === 'rejected', 'REJECTION_CHANGED_AFTER_RESTORE');
    await close(); await open(); await login();
    const reopened = await inspect(); draft(reopened, 'rejected'); preserve(reopened.queue);
    await ownerAbsent(reopened.queue.find(r => r.operationId === report.prepare.operationId));
    const again = await query('query RetainedLookup($id:UUID!){offlineSyncOperation(operationId:$id){operation{state attemptCount lastStatus lastCode}}}', { id: row.operationId });
    check(canonical(again) === canonical(lookup), 'REJECTED_OPERATION_AUTOMATICALLY_RETRIED');
    check(blockedWrites === 0, 'UNEXPECTED_MUTATION_BLOCKED_AFTER_RESTORE');
    report.rejection = { ...report.rejection, pass: true, ownerAdvanceAbsent: true, retainedAfterReopen: true, noAutomaticRetry: true, originalRowsPreserved: true };
    report.pass = true; report.status = 'PASS'; report.exit = 0; pass(stage, { ownerAdvanceAbsent: true, retainedAfterReopen: true, noAutomaticRetry: true });
  }
} catch (error) {
  report.pass = false; report.exit = 1; report.status = 'PARTIAL_OR_BLOCKED';
  const code = error?.name === 'TimeoutError' ? 'BROWSER_TIMEOUT' : safeCode(error?.message);
  report.stages.push({ phase, name: stage, status: 'FAIL', code }); console.log(JSON.stringify({ stage, status: 'FAIL', code }));
} finally {
  allowSync = false; await close().catch(() => {}); report.finishedAt = new Date().toISOString(); save(); process.exitCode = report.exit;
}
