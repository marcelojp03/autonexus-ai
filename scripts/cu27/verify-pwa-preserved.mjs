import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.cwd(), origin='http://127.0.0.1:4285';
const requireApp=createRequire(resolve('web/mf-employees/package.json'));
const {chromium}=requireApp(resolve('web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const profile=resolve(process.env.CU27_PROFILE??'output/cu27/profile-1793854003044');
const account=JSON.parse(readFileSync('output/stack/cu16-proof.accounts.private.json','utf8')).accounts.mechanicA;
const report={pass:false,visual:'NOT_RUN',s3:'NOT_RUN',stages:[]};let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true,timezoneId:'America/La_Paz'});let page=context.pages()[0]??await context.newPage();
 await page.goto(origin+'/offline.html',{waitUntil:'domcontentloaded'});
 await Promise.race([page.locator('#username').waitFor({timeout:30000}),page.waitForFunction(()=>document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada'),null,{timeout:30000})]);
 if(await page.locator('#username').count()){await page.locator('#username').fill(account.username);await page.locator('#password').fill(account.password);await page.locator('#kc-login').click();}
 await page.locator('#offline-work').waitFor();
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;await r.update();});
 await page.waitForFunction(async()=>!(await navigator.serviceWorker.getRegistration('/'))?.installing,null,{timeout:60000});
 report.stages.push({name:'latest_application_and_worker_update',status:'PASS'});
 await context.close();context=undefined;
 context=await chromium.launchPersistentContext(profile,{headless:true,offline:true,timezoneId:'America/La_Paz'});page=context.pages()[0]??await context.newPage();let apiAttempts=0;
 context.on('request',r=>{const p=new URL(r.url()).pathname;if(p.includes('/identity')||p==='/graphql'||p.startsWith('/technical/'))apiAttempts++;});
 await page.goto(origin+'/offline.html',{waitUntil:'domcontentloaded'});await page.locator('#offline-work').waitFor();
 const state=await page.evaluate(async()=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('autonexus-offline');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(new Error('IDB_OPEN_FAILED'));});const rows=await new Promise((ok,no)=>{const r=db.transaction('queue','readonly').objectStore('queue').getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(new Error('IDB_QUERY_FAILED'));});db.close();return {rows:rows.map(r=>({id:r.operationId,state:r.state,photoBytes:r.photo?.size??0,review:r.clientInference?.humanReview?.labels})),script:document.querySelector('script[type="module"]')?.getAttribute('src')};});
 assert.equal(apiAttempts,0);
 const photo=state.rows.find(r=>r.id==='703a26f5-5c52-4500-88c4-4dc41ebae813');assert.ok(photo?.photoBytes>0);assert.equal(photo.state,'pending');assert.deepEqual(photo.review,['dent']);
 assert.equal(state.rows.find(r=>r.id==='d6be22ef-1b8c-4433-8312-d5b0eee2fe84')?.state,'conflict');
 assert.equal(state.rows.find(r=>r.id==='0a8dbe05-55c8-48a2-b4c0-bcfd47cc3b5a')?.state,'applied');
 const latestHtml=readFileSync('web/shell/dist/offline.html','utf8');assert.ok(latestHtml.includes(state.script),'FINAL_BUNDLE_NOT_ACTIVE');
 report.stages.push({name:'final_bundle_cold_offline_preserves_pending_conflict_applied_and_photo_review',status:'PASS',apiAttempts,photoBytes:photo.photoBytes,rowCount:state.rows.length});report.pass=true;
}catch(error){report.code=error?.code??'FINAL_OFFLINE_PRESERVATION_FAILED';report.pass=false;}
finally{await context?.close();mkdirSync('output/cu27',{recursive:true});writeFileSync('output/cu27/pwa-preserved.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.pass?0:1;}
