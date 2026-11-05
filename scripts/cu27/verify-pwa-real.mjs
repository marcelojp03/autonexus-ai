import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd(), output = resolve(root, 'output/cu27');
mkdirSync(output, { recursive: true });
const requireApp = createRequire(resolve(root, 'web/mf-employees/package.json'));
const { chromium } = requireApp(resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const account = JSON.parse(readFileSync(resolve(root, 'output/stack/cu16-proof.accounts.private.json'), 'utf8')).accounts.mechanicA;
const origin = 'http://127.0.0.1:4285';
const report = { stages: [], statuses: { mobile: 'NOT_RUN_INDEPENDENT', pwa: 'INCOMPLETE', s3: 'NOT_OBSERVED', visual: 'NOT_REQUESTED' }, uploads: [], businessCodes: [], pass: false, exit: 1 };
let context, page, authorization, stage = 'browser_launch', monitorColdBoot = false;
const profile = resolve(output, 'profile-' + Date.now());
const save = () => writeFileSync(resolve(output, 'pwa-real.json'), JSON.stringify(report, null, 2));
function pass(name, facts = {}) { report.stages.push({ name, status: 'PASS', ...facts }); save(); console.log(JSON.stringify({ stage: name, status: 'PASS', ...facts })); }
async function launch(offline = false) {
  monitorColdBoot = offline;
  context = await chromium.launchPersistentContext(profile, { headless: true, offline, timezoneId: 'America/La_Paz' });
  context.setDefaultTimeout(30000); page = context.pages()[0] || await context.newPage();
  context.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/graphql') authorization = request.headers().authorization || authorization;
    if (monitorColdBoot && ['identity', 'graphql', 'technical', '/api/'].some(part => url.pathname.includes(part))) report.coldBootNetworkAttempts++;
  });
  context.on('response', async response => {
    const request = response.request(), url = new URL(response.url());
    if (request.method() === 'PUT' && url.protocol === 'https:' && url.hostname.endsWith('amazonaws.com')) {
      report.uploads.push({ https: true, status: response.status(), bearerAbsent: !request.headers().authorization });
      if (response.ok()) report.statuses.s3 = 'HTTPS_UPLOAD_OBSERVED';
    }
    if (url.pathname === '/graphql') try {
      const body = await response.json();
      for (const error of body.errors || []) if (/^[A-Z0-9_]+$/.test(error.extensions?.code)) report.businessCodes.push(error.extensions.code);
    } catch {}
  });
  stage = offline ? 'offline_navigation' : 'initial_navigation';
  await page.goto(origin + '/offline.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  stage = offline ? 'offline_workspace_load' : 'initial_workspace_load';
  if (offline) await page.locator('#offline-day').waitFor();
  else await Promise.race([page.locator('#offline-day').waitFor(), page.locator('#username').waitFor()]);
}
async function login() {
  if (!await page.locator('#username').count()) await page.locator('#session-login').click();
  await Promise.race([
    page.locator('#username').waitFor().then(async () => { await page.locator('#username').fill(account.username); await page.locator('#password').fill(account.password); await page.locator('#kc-login').click(); }),
    page.waitForFunction(() => document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada')),
  ]);
  await page.waitForFunction(() => document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada'));
}
async function idle() { await page.waitForFunction(() => !document.querySelector('#offline-download')?.disabled, null, { timeout: 60000 }); }
async function query(query, variables) {
  assert.ok(authorization, 'AUTHENTICATED_BROWSER_REQUEST_REQUIRED');
  const response = await context.request.post(origin + '/graphql', { headers: { authorization }, data: { query, variables }, timeout: 30000 });
  const body = await response.json(); assert.ok(!body.errors?.length, 'OWNER_QUERY_FAILED'); return body.data;
}
async function inspect() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('autonexus-offline'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(new Error('IDB_READ_FAILED')); });
    const all = name => new Promise((resolve, reject) => { const r = db.transaction(name, 'readonly').objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(new Error('IDB_READ_FAILED')); });
    const works = await all('works'), rows = await all('queue'); db.close();
    const queue = await Promise.all(rows.map(async row => ({ operationId: row.operationId, description: row.description, state: row.state, lastCode: row.lastCode, photoBlob: row.photo instanceof Blob, photoBytes: row.photo?.size || 0, hashMatches: row.photo ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await row.photo.arrayBuffer()))).map(v => v.toString(16).padStart(2, '0')).join('') === row.photoSha256 : false, inferenceHashMatches: row.clientInference?.imageSha256 === row.photoSha256, labels: row.clientInference?.labels, humanReview: row.clientInference?.humanReview, progress: row.progress ? { advanceId: row.progress.advanceId, evidenceId: row.progress.evidenceId, inferenceApplied: row.progress.inferenceApplied } : undefined })));
    return { works: works.length, queue };
  });
}
try {
  await launch(); stage = 'keycloak_form_login'; await login(); pass(stage);
  stage = 'discover_authorized_november_work';
  await page.locator('#offline-day').fill('2026-11-06'); await page.locator('#offline-download').click(); await idle();
  const agenda = await query('query Cu27AcceptanceAgenda($from:Date!,$to:Date!){myAgenda(from:$from,to:$to,limit:50){items{assignmentId orderNumber executionStatus startsAt}}}', { from: '2026-11-01', to: '2026-11-30' });
  const work = agenda.myAgenda.items.find(work => work.executionStatus === 'in_progress' && work.orderNumber === 'WO-2026-000001');
  assert.ok(work, 'NO_AUTHORIZED_IN_PROGRESS_SYNTHETIC_WORK');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(work.startsAt));
  const day = ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
  report.work = { day, orderNumber: work.orderNumber }; pass(stage, { count: agenda.myAgenda.items.length, day, orderNumber: work.orderNumber });
  await page.locator('#offline-day').fill(day); await page.locator('#offline-download').click(); await idle();
  stage = 'prepare_work_model_sw'; await page.getByRole('button', { name: 'Preparar ' + work.orderNumber, exact: true }).click(); await idle();
  assert.equal(await page.locator('#offline-work').inputValue(), work.assignmentId, 'WORK_PREPARATION_FAILED');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller); pass(stage);
  await context.setOffline(true); await context.close(); authorization = undefined;
  stage = 'first_offline_cold_boot'; report.coldBootNetworkAttempts = 0; await launch(true);
  assert.equal(await page.locator('#offline-work').inputValue(), work.assignmentId); assert.equal(report.coldBootNetworkAttempts, 0); pass(stage, { identityApiAttempts: 0 });
  stage = 'real_local_inference_human_review_save';
  const description = 'CU27-PWA-' + Date.now(); report.description = description;
  await page.locator('#offline-photo').setInputFiles(resolve(root, 'mobile/autonexus_app/assets/samples/sample.jpg'));
  await page.locator('#offline-infer').click(); await idle();
  assert.ok((await page.locator('#offline-model-status').textContent()).includes('NO validada'));
  assert.ok(await page.locator('#offline-scores p').count() > 0);
  await page.locator('#offline-review').check(); await page.locator('input[name="human-label"][value="dent"]').check();
  await page.locator('#offline-description').fill(description); await page.locator('#offline-save').click(); await idle();
  let local = await inspect(), row = local.queue.find(row => row.description === description);
  assert.ok(row?.photoBlob && row.hashMatches && row.inferenceHashMatches); assert.deepEqual(row.humanReview.labels, ['dent']); assert.ok(row.labels.every(label => Number.isFinite(label.score)));
  const operationId = row.operationId; report.operationId = operationId; pass(stage, { scoreCount: row.labels.length, photoBytes: row.photoBytes });
  await context.close(); stage = 'second_offline_cold_boot_persistence'; report.coldBootNetworkAttempts = 0; await launch(true);
  local = await inspect(); row = local.queue.find(row => row.operationId === operationId);
  assert.ok(local.works && row?.photoBlob && row.hashMatches && row.inferenceHashMatches); assert.deepEqual(row.humanReview.labels, ['dent']); assert.equal(row.state, 'pending'); assert.equal(report.coldBootNetworkAttempts, 0);
  pass(stage, { identityApiAttempts: 0, workCount: local.works, queueCount: local.queue.length, photoBlob: true, hashMatches: true, humanReviewPreserved: true });
  stage = 'reconnect_same_account_pkce'; monitorColdBoot = false; await context.setOffline(false); await login(); pass(stage);
  stage = 'real_ui_sync'; await page.locator('#offline-sync').click(); await idle();
  local = await inspect(); row = local.queue.find(row => row.operationId === operationId);
  report.sync = { state: row.state, code: row.lastCode || null, advanceRecorded: !!row.progress?.advanceId, evidenceRecorded: !!row.progress?.evidenceId, inferenceApplied: !!row.progress?.inferenceApplied };
  save(); assert.equal(row.state, 'applied', 'REAL_SYNC_NOT_APPLIED'); pass(stage, report.sync);
  stage = 'real_once_only_owner_verification';
  const executionQuery = 'query Cu27AcceptanceExecution($id:UUID!){myExecution(assignmentId:$id){version advances{id description evidences{id state}}}}';
  const data = await query(executionQuery, { id: work.assignmentId });
  const matches = data.myExecution.advances.filter(a => a.description === description);
  assert.equal(matches.length, 1); assert.equal(matches[0].evidences.filter(e => e.state === 'available').length, 1); assert.ok(row.progress?.inferenceApplied);
  await page.locator('#offline-sync').click(); await idle();
  const again = await query(executionQuery, { id: work.assignmentId });
  assert.equal(again.myExecution.advances.filter(a => a.description === description).length, 1); assert.equal(again.myExecution.version, data.myExecution.version);
  pass(stage, { advances: 1, availableEvidence: 1, repeatedSyncUnchangedVersion: true, clientInferenceApplied: true });
  report.statuses.pwa = 'HAPPY_PATH_PASS_EXTENDED_CASES_NOT_RUN'; report.stages.push({ name: 'transport_interruption_conflict_rejection', status: 'NOT_RUN' }); report.exit = 2;
} catch (error) {
  if (page && !page.isClosed()) report.diagnostics = await page.evaluate(() => ({ dayInputCount: document.querySelectorAll('#offline-day').length, loginCount: document.querySelectorAll('#session-login').length, status: document.querySelector('#session-status')?.textContent?.slice(0, 180), workspace: document.querySelector('#offline-status')?.textContent?.slice(0, 180) })).catch(() => ({ unavailable: true }));
  report.stages.push({ name: stage, status: 'FAIL', code: error instanceof assert.AssertionError ? error.message.replace(/[^A-Z0-9_]/g, '').slice(0, 100) : error?.name === 'TimeoutError' ? 'BROWSER_TIMEOUT' : 'HARNESS_OR_RUNTIME_FAILURE' });
  report.statuses.pwa = report.stages.some(s => s.status === 'PASS') ? 'PARTIAL' : 'BLOCKED';
  console.log(JSON.stringify({ stage, status: 'FAIL', code: report.stages.at(-1).code }));
} finally {
  if (context) await context.close().catch(() => {}); authorization = undefined;
  report.finishedAt = new Date().toISOString(); save(); process.exitCode = report.exit;
}
