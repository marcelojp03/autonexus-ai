/** Read-only real-owner/edge oracle. Synthetic credentials stay inside this process. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {login} from '../cu28/provision-scheduler.mjs';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const [from,to,label]=process.argv.slice(2);
const withUi=process.argv[5]==='--ui';
assert.match(from??'',/^\d{4}-\d{2}-\d{2}$/);assert.match(to??'',/^\d{4}-\d{2}-\d{2}$/);assert.match(label??'',/^[a-z0-9-]+$/);
assert.ok(from<=to);for(const d of[from,to])assert.equal(new Date(d+'T00:00:00Z').toISOString().slice(0,10),d);
assert.ok((Date.parse(to)-Date.parse(from))/86400000<31);
const origin='http://127.0.0.1:4286';
const accounts=JSON.parse(readFileSync(resolve(root,'output/stack/live-demo/accounts.json'),'utf8')).accounts;
const directory=resolve(root,'output/agent');mkdirSync(directory,{recursive:true});
const file=resolve(directory,'financial-source-'+label+'.json');
const report={pass:false,period:{from,to},checks:[],syntheticWorkshop:true};
const attempts=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).attempts??[]:[];
const save=()=>writeFileSync(file,JSON.stringify({...report,attempts},null,2),{mode:0o600});
const docker=(args,input)=>execFileSync('docker',args,{cwd:root,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:45000,maxBuffer:2*1024*1024});
const ownerCode='let input="";for await(const chunk of process.stdin)input+=chunk;const p=JSON.parse(input);const r=await fetch(process.env.FINANCE_API_URL+p.path,{method:"GET",redirect:"error",headers:{authorization:"Bearer "+p.token,accept:"application/json"},signal:AbortSignal.timeout(20000)});console.log(JSON.stringify({status:r.status,data:await r.json()}));';
const owner=(path,token)=>JSON.parse(docker(['exec','-i','cu16-proof-agent-1','node','--input-type=module','-e',ownerCode],JSON.stringify({path,token})));
const issued=new Map();
async function token(account){let current=issued.get(account);if(!current||current.expiresAt<Date.now()+35000){const value=await login(accounts[account]);const claims=JSON.parse(Buffer.from(value.access_token.split('.')[1],'base64url'));current={token:value.access_token,expiresAt:claims.exp*1000};issued.set(account,current);}return current.token;}
async function ask(query,account='finance',permitForbidden=false){
 const response=await fetch(origin+'/graphql',{method:'POST',headers:{authorization:'Bearer '+await token(account),'content-type':'application/json'},body:JSON.stringify({query:'query FinancialAssistant($query:String!){assistantAnswer(query:$query){answer refused toolsUsed model generatedAt provenance{service resource tool observedAt} limitations}}',variables:{query}}),signal:AbortSignal.timeout(130000)});
 const body=await response.json();if(response.status===401){issued.delete(account);throw Error('CALLER_AUTHORIZATION_EXPIRED');}
 if(permitForbidden&&(response.status===403||body.errors?.some(e=>e.extensions?.code==='FORBIDDEN'))){assert.ok(body.data?.assistantAnswer==null);return {transportDenied:true,status:response.status};}
 assert.equal(response.status,200);assert.equal(body.errors,undefined);return body.data.assistantAnswer;
}
const money=minor=>{const v=BigInt(minor),negative=v<0n,abs=negative?-v:v;return (negative?'-':'')+(abs/100n)+'.'+String(abs%100n).padStart(2,'0')+' BOB';};
let stage='money-baseline';
try {
 report.requiresOllama=false;
 stage='money-baseline';docker(['cp','scripts/finance/monetary-state.php','cu16-proof-finance-1:/tmp/cu25-monetary-state.php']);
 const baseline=JSON.parse(docker(['exec','cu16-proof-finance-1','/usr/local/bin/service-entrypoint','php','/tmp/cu25-monetary-state.php']));
 stage='owner-summary';const path='/financial-summary?from='+from+'&to='+to;const financeToken=await token('finance');const claims=JSON.parse(Buffer.from(financeToken.split('.')[1],'base64url'));report.financeCallerHadMcpReadRole=(claims.realm_access?.roles??[]).some(role=>['mcp_read_team','mcp_read_self'].includes(role));const result=owner(path,financeToken);
 report.ownerObservation={status:result.status,code:/^[A-Z_]+$/.test(String(result.data?.code))?result.data.code:null,fields:result.data&&typeof result.data==='object'?Object.keys(result.data).sort():[],hostTokenRemainingSeconds:Math.floor(claims.exp-Date.now()/1000)};
 save();assert.equal(result.status,200);const oracle=result.data;
 assert.equal(oracle.from,from);assert.equal(oracle.to,to);assert.equal(oracle.currency,'BOB');assert.equal(oracle.timeZone,'America/La_Paz');assert.equal(BigInt(oracle.receivedAmountMinor)-BigInt(oracle.expenseAmountMinor),BigInt(oracle.netMovementMinor));report.oracle=oracle;save();
 stage='authorized-summary';const query='Mostrame el resumen financiero: cobros recibidos, gastos operativos y movimiento neto del '+from+' al '+to+'.';
 const answer=await ask(query);assert.equal(answer.refused,false);assert.equal(answer.model,'cu25-financial-summary-v1');assert.ok(answer.toolsUsed.includes('autonexus_get_financial_summary'));
 for(const key of['receivedAmountMinor','expenseAmountMinor','netMovementMinor'])assert.ok(answer.answer.includes(money(oracle[key])),key+'_MISSING');
 assert.ok(answer.answer.includes(from)&&answer.answer.includes(to));assert.match(answer.answer,/determin[ií]st/i);assert.ok(answer.answer.includes('cobros: '+oracle.paymentCount));assert.ok(answer.answer.includes('gastos registrados: '+oracle.expenseCount));assert.ok(answer.provenance.some(p=>p.service==='finance'&&p.tool==='autonexus_get_financial_summary'&&p.resource.includes('financial-summary')));
 report.answer=answer;report.checks.push('owner_amounts_period_provenance_and_label');save();
 stage='net-only-financial-route';const netOnly=await ask('Movimiento neto del '+from+' al '+to);assert.equal(netOnly.refused,false);assert.ok(netOnly.toolsUsed.includes('autonexus_get_financial_summary'));assert.ok(netOnly.answer.includes(money(oracle.netMovementMinor)));assert.equal(netOnly.model,'cu25-financial-summary-v1');assert.ok(netOnly.limitations.every(text=>!text.includes('modelo deshabilitado')));report.checks.push('net_only_financial_not_agenda_or_llm');save();
 stage='missing-period';const clarification=await ask('¿Cuánto cobramos y gastamos?');assert.equal(clarification.refused,true);assert.equal(clarification.toolsUsed.length,0);assert.match(clarification.answer,/per[ií]odo|fecha/i);report.checks.push('missing_period_clarifies_without_reads');save();
 stage='write-refusal';const refused=await ask('Registrá un gasto de BOB 25 del '+from+' al '+to);assert.equal(refused.refused,true);assert.equal(refused.toolsUsed.length,0);report.checks.push('financial_write_refused');save();
 stage='actual-owner-denial';const deniedOwner=owner(path,await token('mechanicA'));assert.equal(deniedOwner.status,403);const denied=await ask(query,'mechanicA',true);
 if(denied.transportDenied)report.denialPath='transport_forbidden';else{assert.equal(denied.refused,true);assert.ok(!denied.toolsUsed.includes('autonexus_get_financial_summary'));assert.doesNotMatch(denied.answer,/BOB\s+-?\d|(?:^|\s)-?\d+(?:[.]\d+)?\s+BOB\b/);report.denialPath='assistant_refusal';}
 report.checks.push('mechanic_denied_by_owner_and_assistant');save();
 if(withUi){
   stage='served-shell-financial-answer';const require=createRequire(resolve(root,'web/mf-employees/package.json'));const {chromium,expect}=require('@playwright/test');
   const browser=await chromium.launch({headless:true});try {
     const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(60000);let mutations=0;
     page.on('request',request=>{try{if(new URL(request.url()).pathname==='/graphql'&&/^\s*mutation\b/i.test(request.postDataJSON()?.query??''))mutations++;}catch{}});
     await page.goto(origin+'/finance',{waitUntil:'domcontentloaded'});await page.locator('#username').waitFor();await page.locator('#username').fill(accounts.finance.username);await page.locator('#password').fill(accounts.finance.password);await page.locator('#kc-login').click();
     await page.waitForFunction(()=>document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada'));
     await page.goto(origin+'/employees/assistant',{waitUntil:'domcontentloaded'});await page.locator('#assistant-question').fill(query);await page.locator('#assistant-ask').click();
     await page.locator('#assistant-answer').waitFor({state:'visible',timeout:150000});const visible=await page.locator('#assistant-answer').innerText();
     for(const key of['receivedAmountMinor','expenseAmountMinor','netMovementMinor'])assert.ok(visible.includes(money(oracle[key])),'UI_'+key+'_MISSING');
     await expect(page.locator('#assistant-answer')).toContainText(from);assert.match(visible,/determin[ií]st/i);
     const screenshots=resolve(root,'output/playwright/cu25-financial-'+label);mkdirSync(screenshots,{recursive:true});
     for(const width of[1440,390]){await page.setViewportSize({width,height:width===390?844:1000});await page.screenshot({path:resolve(screenshots,'assistant-'+width+'.png'),fullPage:true,mask:[page.locator('#session-identity')]});}
     assert.equal(mutations,0);report.browser={passed:true,viewports:[1440,390],graphqlMutations:0,visualConformityClaimed:false};report.checks.push('served_shell_same_financial_figures');save();
   }finally{await browser.close();}
 }
 stage='no-financial-writes';const after=JSON.parse(docker(['exec','cu16-proof-finance-1','/usr/local/bin/service-entrypoint','php','/tmp/cu25-monetary-state.php']));assert.deepEqual(after,baseline);report.monetaryTablesUnchanged=true;report.financialWritesPerformed=0;report.checks.push('eight_money_tables_unchanged');report.pass=true;
}catch(error){report.failure={stage,name:error.name,code:/^[A-Z_]+$/.test(error.message)?error.message:'FINANCIAL_SOURCE_NOT_VERIFIED',location:error.stack?.split(String.fromCharCode(10)).find(line=>line.includes('verify-financial-summary-real.mjs:'))?.trim()};process.exitCode=1;}
finally{attempts.push({at:new Date().toISOString(),pass:report.pass,stage,checks:[...report.checks],...(report.failure?{failure:report.failure}:{})});save();console.log(JSON.stringify({pass:report.pass,period:report.period,checks:report.checks,monetaryTablesUnchanged:report.monetaryTablesUnchanged??null,...(report.failure?{failure:report.failure}:{})}));}
