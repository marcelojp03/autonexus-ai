import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const origin=process.env.CU16_PUBLIC_ORIGIN||'http://127.0.0.1:4286';
const accountsFile=process.env.CU16_ACCOUNTS_FILE||'output/stack/cu16-fresh-proof.accounts.private.json';
const file=process.env.CU16_TEST_FILE||'output/stack/t25-browser-fresh-01-evidence/mechanicA-agenda-desktop.png';
const account=JSON.parse(readFileSync(resolve(accountsFile),'utf8')).accounts.mechanicA;
const requireApp=createRequire(resolve('web/mf-employees/package.json'));
const {chromium}=requireApp(resolve('web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const report={origin,stages:[],consoleErrors:0,pageErrors:0,serverErrors:0,pass:false};
const failedResponses=[];
const pass=(name,value)=>{assert.ok(value,name);report.stages.push({name,status:'PASS'});};
let browser,context;
try{
browser=await chromium.launch({headless:true});
context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/La_Paz'});
const page=await context.newPage();
await page.addInitScript(()=>{window.__cu16Lifecycle=[];window.addEventListener('autonexus:lifecycle',event=>window.__cu16Lifecycle.push(event.detail));});
page.on('console',m=>{if(m.type()==='error')report.consoleErrors++;});
page.on('pageerror',()=>report.pageErrors++);
page.on('response',r=>{if(r.status()>=500)report.serverErrors++;if(r.status()>=400)failedResponses.push({status:r.status(),url:r.url()});});
await page.goto(origin,{waitUntil:'domcontentloaded'});
await page.locator('#session-login').waitFor({state:'visible',timeout:30000});
await page.locator('#session-login').click();
await page.locator('#username').waitFor({state:'visible',timeout:30000});
await page.locator('#username').fill(account.username);
await page.locator('#password').fill(account.password);
await page.locator('#kc-login').click();
await page.waitForFunction(()=>document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada'),null,{timeout:30000});
pass('real PKCE sign-in using the mechanic identity',true);
await page.goto(origin+'/employees/agenda',{waitUntil:'domcontentloaded'});
const agendaDates=page.locator('input[type="date"]');
await agendaDates.nth(0).fill('2026-11-01');
await agendaDates.nth(1).fill('2026-11-30');
await page.getByRole('button',{name:'Consultar'}).click();
await page.locator('tbody tr a').first().waitFor({state:'visible',timeout:30000});
await page.locator('tbody tr a').first().click();
await page.getByRole('link',{name:'Abrir ejecución'}).waitFor({state:'visible',timeout:20000});
await page.getByRole('link',{name:'Abrir ejecución'}).click();
await page.locator('#execution-work').waitFor({state:'visible',timeout:30000});
pass('CU05 work detail opens its selected CU16 execution in the integrated Shell',true);
const startButton=page.locator('#execution-start');
const descriptionField=page.locator('#execution-description');
const readyState=await Promise.race([
  startButton.waitFor({state:'visible',timeout:20000}).then(()=> 'not-started').catch(()=> null),
  descriptionField.waitFor({state:'visible',timeout:20000}).then(()=> 'in-progress').catch(()=> null),
]);
if(readyState==='not-started') await startButton.click();
await page.waitForTimeout(1000);
if(!(await descriptionField.count())){
  report.executionPage={url:page.url(),text:(await page.locator('body').innerText()).slice(0,5000),startCount,descriptionCount:await app.locator('#execution-description').count(),shadow:await page.evaluate(()=>({title:document.title,employeesHidden:document.querySelector('#mf-employees')?.hidden,employeesBusy:document.querySelector('#mf-employees')?.getAttribute('aria-busy'),shadowText:document.querySelector('anx-employees-root')?.shadowRoot?.textContent?.slice(0,5000),shadowButtons:[...(document.querySelector('anx-employees-root')?.shadowRoot?.querySelectorAll('button')??[])].map(button=>({id:button.id,text:button.innerText,disabled:button.disabled})),loadStatus:document.querySelector('#load-status')?.textContent,lifecycle:window.__cu16Lifecycle}))};
  report.failedResponses=failedResponses;
  await page.screenshot({path:'output/stack/cu16-execution-debug.png',fullPage:true});
}
await descriptionField.waitFor({state:'visible',timeout:20000});
await descriptionField.fill('Registro desde Chromium de una inspección y ajuste');
await page.locator('#execution-minutes input').fill('12');
await page.locator('#execution-advance').click();
await page.getByText('Avance registrado.',{exact:true}).waitFor({state:'visible',timeout:30000});
pass('mechanic start and advance saved through the real BFF and Operations API',true);
const uploadButton=page.locator('button[id^="evidence-upload-"]').last();
const uploadId=await uploadButton.getAttribute('id');
const advanceId=uploadId.slice('evidence-upload-'.length);
await page.locator('#evidence-'+advanceId).setInputFiles(resolve(file));
await uploadButton.click();
await page.locator('#execution-error').waitFor({state:'visible',timeout:30000});
const storageUnavailable=(await page.locator('#execution-error').innerText()).includes('almacenamiento privado');
pass('the absent AWS S3 configuration is explicit; bytes are not reported as confirmed',storageUnavailable);
const storage=await page.evaluate(()=>JSON.stringify({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
pass('browser storage has no access/refresh/id token keys',!/(access|refresh|id)[_-]?token/i.test(storage));
await page.screenshot({path:'output/stack/cu16-execution-desktop.png',fullPage:true});
await page.setViewportSize({width:390,height:844});
pass('execution remains visible at mobile viewport',await page.locator('#execution-work').isVisible());
await page.screenshot({path:'output/stack/cu16-execution-mobile.png',fullPage:true});
report.pass=report.consoleErrors===0&&report.pageErrors===0&&report.serverErrors===0;
}catch(error){report.errorName=error?.name||'Error';throw error;}finally{await context?.close();await browser?.close();writeFileSync('output/stack/cu16-execution-web-result.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
