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
const profile = resolve(output, 'profile-1793854003044');
const save = () => writeFileSync(resolve(output, 'pwa-continuation.json'), JSON.stringify(report, null, 2));
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
    return { works: works.map(w=>({assignmentId:w.assignmentId,version:w.version})), queue };
  });
}
const protectedOperation = '703a26f5-5c52-4500-88c4-4dc41ebae813';
const executionQuery = 'query Cu27Continuation($id:UUID!){myExecution(assignmentId:$id){version advances{id description}}}';
let target;
const preserve = async () => {
  const state = await inspect(), row = state.queue.find(r=>r.operationId===protectedOperation);
  assert.ok(row?.photoBlob && row.hashMatches && row.inferenceHashMatches,'ORIGINAL_PHOTO_NOT_PRESERVED');
  assert.equal(row.state,'pending','ORIGINAL_PHOTO_STATE_CHANGED');
  assert.ok(row.progress?.advanceId,'ORIGINAL_ADVANCE_MISSING');
  return state;
};
const sync = async () => { await page.locator('#offline-sync').click(); await idle(); };
async function textAdvance(description) {
  await context.setOffline(true);
  await page.locator('#offline-description').fill(description);
  await page.locator('#offline-save').click(); await idle();
  const row=(await inspect()).queue.find(r=>r.description===description);
  assert.ok(row && !row.photoBlob,'TEXT_QUEUE_SAVE_FAILED');
  await context.setOffline(false); return row;
}
try {
  stage='runtime_bundle_check';
  const html=readFileSync(resolve(root,'web/shell/dist/index.html'),'utf8');
  const asset=html.match(/src="([^"]+\.js)"/)[1];
  const local=readFileSync(resolve(root,'web/shell/dist'+asset));
  const live=Buffer.from(await(await fetch(origin+asset)).arrayBuffer());
  assert.ok(local.equals(live),'RUNTIME_BUNDLE_DIFFERS_FROM_LOCAL_DIST');
  assert.ok(local.toString().includes('Copia anterior oculta'),'DEFENSIVE_ACCOUNT_FIX_ABSENT');
  pass(stage,{bundleMatchesLocalDist:true,rebuildNeeded:false});
  stage='resume_preserved_profile_pkce'; await launch(); await login(); await idle();
  let initial=await preserve(); assert.equal(initial.works.length,1);
  target=initial.works[0].assignmentId;
  assert.equal(initial.works[0].version,16,'STALE_SNAPSHOT_NOT_16');
  pass('resume_preserved_profile_pkce',{preparedVersion:16,originalPhotoPending:true});
  stage='text_stale_snapshot_conflict';
  const conflictDescription='CU27-PWA-TEXT-CONFLICT-'+Date.now();
  const conflict=await textAdvance(conflictDescription); report.conflictOperationId=conflict.operationId;
  await sync();
  let row=(await preserve()).queue.find(r=>r.operationId===conflict.operationId);
  assert.equal(row.state,'conflict','TEXT_CONFLICT_NOT_OBSERVED'); assert.equal(row.lastCode,'VERSION_CONFLICT');
  assert.ok((await page.locator('#offline-queue').textContent()).includes(conflictDescription));
  assert.ok((await page.locator('#offline-queue').textContent()).includes('VERSION_CONFLICT'));
  pass(stage,{operationId:row.operationId,state:row.state,code:row.lastCode,descriptionVisible:true,retained:true});
  stage='prepare_current_version_ui';
  await page.locator('#offline-day').fill('2026-11-06'); await page.locator('#offline-download').click(); await idle();
  await page.getByRole('button',{name:'Preparar WO-2026-000001',exact:true}).click(); await idle();
  const current=(await preserve()).works[0].version; assert.ok(current>=17);
  pass(stage,{version:current,day:'2026-11-06'});
  stage='real_push_response_drop';
  const description='CU27-PWA-TEXT-ONCE-'+Date.now(); report.onceDescription=description;
  const once=await textAdvance(description); report.onceOperationId=once.operationId; save();
  let dropped=false;
  await context.route('**/graphql',async route=>{
    const body=route.request().postDataJSON();
    if(!dropped && body?.query?.includes('pushOfflineSync')) {
      const localState=await inspect(); const item=localState.queue.find(r=>r.operationId===once.operationId);
      if(item?.state==='sending') {
        const real=await route.fetch(); const result=await real.json();
        assert.ok(result.data?.pushOfflineSync?.operations?.some(o=>o.operationId===once.operationId && o.state==='applied'),'REAL_OWNER_PUSH_NOT_APPLIED');
        dropped=true; await route.abort('connectionreset'); return;
      }
    }
    await route.continue();
  });
  await sync(); assert.ok(dropped,'REAL_RESPONSE_NOT_DROPPED');
  row=(await preserve()).queue.find(r=>r.operationId===once.operationId);
  assert.ok(['sending','pending'].includes(row.state),'AMBIGUOUS_RESPONSE_NOT_PENDING');
  const before=await query(executionQuery,{id:target});
  assert.equal(before.myExecution.advances.filter(a=>a.description===description).length,1);
  pass(stage,{realOwnerApplied:true,responseAborted:true,localState:row.state,ownerCount:1});
  await context.close(); authorization=undefined;
  stage='persistent_reopen_pkce_retry_once'; await launch(); await login(); await idle();
  row=(await preserve()).queue.find(r=>r.operationId===once.operationId); assert.equal(row.state,'pending');
  await sync(); row=(await preserve()).queue.find(r=>r.operationId===once.operationId);
  assert.equal(row.state,'applied','RETRY_NOT_APPLIED');
  const after=await query(executionQuery,{id:target});
  assert.equal(after.myExecution.advances.filter(a=>a.description===description).length,1);
  assert.equal(after.myExecution.version,before.myExecution.version);
  assert.ok((await page.locator('#offline-queue').textContent()).includes(description+' · 15 min · applied'));
  pass('persistent_reopen_pkce_retry_once',{operationId:once.operationId,state:row.state,ownerCount:1,versionUnchanged:true,originalPhotoPending:true});
  report.statuses.pwa='TEXT_CONFLICT_AND_INTERRUPTION_ONCE_PASS'; report.exit=2;
  report.statuses.s3=false; report.statuses.visual='NOT_RUN'; report.statuses.mobile='PARENT_EVIDENCE';
  report.rejection={status:'NOT_RUN',blocker:'Six meaningful acceptance steps reached. Owner-admin identity and exact reversible mechanic-role assignment were not independently resolved; no role mutation attempted.'};
} catch(error) {
  report.stages.push({name:stage,status:'FAIL',code:error instanceof assert.AssertionError ? error.message.replace(/[^A-Z0-9_]/g,'').slice(0,100):error?.name==='TimeoutError'?'BROWSER_TIMEOUT':'HARNESS_OR_RUNTIME_FAILURE'});
  if(page&&!page.isClosed()) report.diagnostics=await page.evaluate(()=>({status:document.querySelector('#session-status')?.textContent,workspace:document.querySelector('#offline-status')?.textContent})).catch(()=>({unavailable:true}));
  console.log(JSON.stringify(report.stages.at(-1)));
} finally {
  if(context) await context.close().catch(()=>{}); authorization=undefined;
  report.finishedAt=new Date().toISOString(); save(); process.exitCode=report.exit;
}
