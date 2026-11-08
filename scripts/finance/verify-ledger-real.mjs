import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {execFileSync, spawn} from 'node:child_process';
import {internal, ensure} from '../mcp/local-admin.mjs';
import {login} from '../cu28/provision-scheduler.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
const dir = resolve('output/finance/cu19');
mkdirSync(dir, {recursive: true});
const save = (name, value) => writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
const load = path => JSON.parse(readFileSync(path, 'utf8'));
execFileSync('git', ['check-ignore', resolve(dir, 'fixture.json')], {stdio: 'pipe'});
const fixture = existsSync(resolve(dir, 'fixture.json')) ? load(resolve(dir, 'fixture.json')) : {
  marker: 'SYNTHETIC-CU19-' + randomUUID(), intents: {}, commands: {},
  orderId: '5f35fc40-f994-40a7-b7c9-8f3e76f88d11', createdAt: new Date().toISOString(),
};
const persist = () => save('fixture.json', fixture);
persist();
const report = {pass: false, startedAt: new Date().toISOString(), checks: [], limitations: [
  'No live PostgreSQL fault injection or rollback claim; SQLite rollback tests are separate evidence.',
  'Synthetic money only; no external charge, fiscal invoice, BFF or browser verification.',
]};
const check = (ok, code, details = {}) => { ensure(ok, code); report.checks.push({code, ...details}); save('result.json', report); };
let token;
const auth = async account => (await login(account)).access_token;
const api = (path, method = 'GET', body, bearer = token, service = 'finance:8000') => {
  const start=Date.now();
  try {const result=internal('http://' + service + path, {method, body, token: bearer});return {...result,elapsedMs:Date.now()-start};}
  catch {throw new Error('OWNER_TRANSPORT_FAILED_'+service.split(':')[0].toUpperCase());}
};
const expect = (r, status, code, label) => { check(r.status === status && (!code || r.data?.code === code), label + '_HTTP_' + r.status + '_' + (r.data?.code ?? 'OK'), {elapsedMs:r.elapsedMs}); return r.data; };
function command(name, path, body) {
  if (!fixture.commands[name]) {
    fixture.intents[name] = randomUUID();
    fixture.commands[name] = {path, body: {operationId: fixture.intents[name], ...body}};
    persist();
  }
  return fixture.commands[name];
}
const send = c => api(c.path, 'POST', c.body);
const workerPath = '/tmp/cu19-ledger-worker.php';
const worker = [
  '<?php',
  "require '/app/services/finance/vendor/autoload.php';",
  "$app = require '/app/services/finance/bootstrap/app.php';",
  '$kernel = $app->make(Illuminate\\Contracts\\Http\\Kernel::class); $kernel->bootstrap();',
  '$v = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);',
  'try {',
  "if (($v['mode'] ?? '') === 'oracle') {",
  '$db = Illuminate\\Support\\Facades\\DB::class;',
  "$db::beginTransaction(); $db::statement('SET TRANSACTION READ ONLY');",
  "$out = ['operations'=>[], 'audit'=>[], 'payments'=>[], 'expenses'=>[]];",
  "foreach (['operations','audit'] as $t) {$out[$t]=$db::table('financial_'.$t)->whereIn('id',$v['ids'])->get()->map(fn($r)=>json_decode($r->record,true))->all();}",
  "foreach (['payments','expenses'] as $t) {$out[$t]=$db::table('financial_'.$t)->get()->map(fn($r)=>json_decode($r->record,true))->all();}",
  "$out['links']=$db::table('quote_confirmation_links')->where('order_id',$v['orderId'])->get()->all();",
  "$out['quote']=$db::table('quotes')->where('id',$v['quoteId'])->select(['id','version_number','currency','order_reference'])->selectRaw('CAST(total AS TEXT) AS exact_total')->first();",
  '$db::rollBack(); echo json_encode($out); exit; }',
  "$pid=Illuminate\\Support\\Facades\\DB::selectOne('select pg_backend_pid() as pid')->pid;",
  "while (microtime(true)<$v['startAt']) {usleep(1000);} $start=microtime(true);",
  "$r=Illuminate\\Http\\Request::create($v['path'],'POST',[],[],[],['HTTP_ACCEPT'=>'application/json','CONTENT_TYPE'=>'application/json','HTTP_AUTHORIZATION'=>'Bearer '.$v['token']],json_encode($v['body']));",
  '$response=$kernel->handle($r);',
  "echo json_encode(['status'=>$response->getStatusCode(),'data'=>json_decode($response->getContent(),true),'pid'=>$pid,'start'=>$start,'end'=>microtime(true)]);",
  '$kernel->terminate($r,$response);',
  "} catch (Throwable $e) {echo json_encode(['status'=>0,'code'=>'WORKER_FAILED']); exit(1);}",
].join('\n');
function php(payload) {
  return new Promise((res, reject) => {
    const p = spawn('docker', ['exec', '-i', '-w', '/app/services/finance', 'cu16-proof-finance-1', '/usr/local/bin/service-entrypoint', 'php', workerPath], {stdio: ['pipe', 'pipe', 'pipe']});
    let out = ''; p.stdout.on('data', b => {out += b;}); p.stderr.resume();
    p.on('error', () => reject(new Error('WORKER_START_FAILED')));
    p.on('close', code => {try {ensure(code === 0, 'WORKER_EXIT_' + code); res(JSON.parse(out));} catch {reject(new Error('WORKER_RESULT_INVALID'));}});
    p.stdin.end(JSON.stringify(payload));
  });
}
const sum = rows => rows.reduce((s, r) => s + BigInt(r.amountMinor), 0n).toString();
const civil = at => new Intl.DateTimeFormat('en-CA',{timeZone:'America/La_Paz',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
function binary(target, bytes) {
  ensure(new RegExp('^/finance-files/documents/[a-f0-9-]{36}/content$').test(target.url)&&['PUT','GET'].includes(target.method),'BINARY_TARGET_INVALID');
  const headers=JSON.parse(target.headersJson);
  ensure(Object.keys(headers).every(k=>['x-finance-grant','content-type'].includes(k.toLowerCase())),'BINARY_CREDENTIAL_BOUNDARY');
  const source="let s='';for await(const c of process.stdin)s+=c;try{const v=JSON.parse(s);const r=await fetch(v.url,{method:v.method,headers:v.headers,...(v.method==='PUT'?{body:Buffer.from(v.bytes,'base64')}:{ }),redirect:'error',signal:AbortSignal.timeout(12000)});const b=Buffer.from(await r.arrayBuffer());const {createHash}=await import('node:crypto');console.log(JSON.stringify({status:r.status,size:b.length,sha256:createHash('sha256').update(b).digest('hex')}));}catch{console.log(JSON.stringify({status:0}));process.exitCode=1;}";
  try {return JSON.parse(execFileSync('docker',['exec','-i','cu16-proof-employees-1','node','--input-type=module','-e',source],{input:JSON.stringify({url:'http://finance:8000'+target.url,method:target.method,headers,bytes:bytes?.toString('base64')}),stdio:['pipe','pipe','pipe'],timeout:20000}));}
  catch {throw new Error('BINARY_TRANSPORT_FAILED');}
}
async function main() {
  check(execFileSync('git', ['branch', '--show-current'], {encoding:'utf8'}).trim() === 'work/marcelo', 'BRANCH');
  const accounts = load('output/stack/live-demo/accounts.json').accounts;
  token = await auth(accounts.finance);
  const permission = expect(api('/security/permissions', 'GET', undefined, token, 'employees:3002'), 200, null, 'EMPLOYEE_OWNER');
  check(permission.employeeId === accounts.finance.employeeId && permission.employeeStatus === 'active' && ['payments:read','payments:write','expenses:read','expenses:write'].every(p => permission.effective.includes(p)), 'CURRENT_EMPLOYEE_BINDING_AND_PERMISSIONS');
  fixture.employeeId = permission.employeeId; persist();
  expect(api('/payments', 'GET', undefined, null), 401, 'UNAUTHORIZED', 'ANONYMOUS');
  const denied = await auth(accounts.mechanicA);
  expect(api('/payments', 'GET', undefined, denied), 403, 'FORBIDDEN', 'PAYMENT_PERMISSION');
  expect(api('/expenses', 'POST', {operationId:randomUUID()}, denied), 403, 'FORBIDDEN', 'EXPENSE_PERMISSION');
  const context = expect(api('/orders/' + fixture.orderId + '/collection-context', 'GET', undefined, token, 'operations:8081'), 200, null, 'OPS_CONTEXT');
  check(context.orderStatus === 'completed' && context.sagaStatus === 'confirmed' && context.eligibleForCollection, 'GLOBAL_CONFIRMED_COMPLETED', {orderId:fixture.orderId, orderVersion:context.orderVersion});
  fixture.context = context; persist();
  const before = expect(api('/receivables/' + fixture.orderId), 200, null, 'RECEIVABLE');
  if (!fixture.before) { fixture.before = before; persist(); }
  const original = fixture.before;
  check(original.paidAmountMinor === '0' && BigInt(original.balanceMinor) > 1n && original.payments.length === 0, 'ELIGIBLE_SYNTHETIC_UNPAID_FIXTURE');
  check(BigInt(original.agreedAmountMinor)>0n&&original.paidAmountMinor==='0','APPROVED_LINKED_QUOTE_IS_NOT_RECEIVED_MONEY');
  check(before.quoteId === context.quoteId && before.quoteVersion === context.quoteVersion && before.quoteLinkId === context.quoteLinkId, 'EXACT_LINK_CONTEXT');
  const paymentPath = '/orders/' + fixture.orderId + '/payments';
  const payment = {expectedVersion:original.balanceVersion, amountMinor:original.balanceMinor, method:'cash', confirmReceived:true};
  {
    for (const [name, body, status, code] of [
      ['invalid-money', {...payment,amountMinor:'0'},400,'VALIDATION_ERROR'],
      ['partial', {...payment,amountMinor:'1'},409,'PAYMENT_PARTIAL_UNSUPPORTED'],
      ['overpay', {...payment,amountMinor:(BigInt(original.balanceMinor)+1n).toString()},409,'PAYMENT_EXCEEDS_BALANCE'],
      ['unverified', {...payment,method:'bank_transfer'},409,'PAYMENT_REFERENCE_UNVERIFIED'],
    ]) {
      const c = command(name,paymentPath,body); expect(send(c),status,code,name);
      if(status === 409) {const op=expect(api('/financial-operations/'+c.body.operationId),200,null,name+'-lookup');check(op.outcome==='rejected'&&op.errorCode===code,name+'-durable');}
    }
  }
  token=await auth(accounts.finance);
  writeFileSync(resolve(dir,'ledger-worker.php'),worker);
  execFileSync('docker',['cp',resolve(dir,'ledger-worker.php'),'cu16-proof-finance-1:'+workerPath],{stdio:'pipe'});
  const a = command('race-a',paymentPath,payment), b = command('race-b',paymentPath,payment);
  if (!fixture.race) {
    const startAt = Date.now()/1000+4;
    const results = await Promise.all([a,b].map(c => php({...c,token,startAt})));
    fixture.race = results; persist();
  }
  const race = fixture.race;
  check(race[0].pid !== race[1].pid && Math.max(...race.map(r=>r.start)) < Math.min(...race.map(r=>r.end)), 'INDEPENDENT_PG_CONNECTIONS_OVERLAP', {workers:race.map(({pid,start,end,status,data})=>({pid,start,end,status,code:data?.code??null}))});
  check(race.filter(r=>r.status===200 && !r.data.replayed).length===1 && race.filter(r=>r.status===409&&r.data.code==='VERSION_CONFLICT').length===1,'RACE_ONE_PAYMENT_ONE_REJECTION');
  const winnerIndex = race.findIndex(r=>r.status===200), winner = race[winnerIndex].data;
  const replay = expect(send([a,b][winnerIndex]),200,null,'PAYMENT_REPLAY');
  check(replay.replayed && replay.payment.id===winner.payment.id,'SAME_PAYMENT_REPLAY');
  expect(api(paymentPath,'POST',{...[a,b][winnerIndex].body,amountMinor:'1'}),409,'IDEMPOTENCY_CONFLICT','PAYMENT_CHANGED_BODY');
  const receipt=expect(api('/payments/'+winner.payment.id+'/receipt'),200,null,'RECEIPT_REREAD');
  check(isDeepStrictEqual(receipt,winner.receipt),'IMMUTABLE_INTERNAL_RECEIPT');
  const after=expect(api('/receivables/'+fixture.orderId),200,null,'PAID_REREAD');
  check(after.balanceMinor==='0'&&after.paidAmountMinor===original.agreedAmountMinor&&after.payments.length===1,'SERVER_BALANCE_AND_PAYMENTS');
  const losingOp=expect(api('/financial-operations/'+[a,b][1-winnerIndex].body.operationId),200,null,'RACE_REJECTION_LOOKUP');
  check(losingOp.outcome==='rejected'&&losingOp.errorCode==='VERSION_CONFLICT','RACE_REJECTION_DURABLE');
  token=await auth(accounts.finance);
  const cats=expect(api('/expense-categories'),200,null,'EXPENSE_CATEGORIES');
  check(['utilities','tools','equipment_maintenance','administrative','other'].every(c=>cats.some(x=>x.code===c&&x.active)), 'CONFIGURED_CATEGORIES');
  const date=civil(Date.now());
  if (!fixture.expenseBase) {fixture.expenseBase={description:fixture.marker+' synthetic utility expense',categoryId:cats.find(c=>c.code==='utilities').id,expenseDate:date,amountMinor:'1234',method:'cash'};persist();}
  const base=fixture.expenseBase;
  for(const [name,patch,status,code] of [
    ['category',{categoryId:'00000000-0000-4000-8000-000000000099'},409,'EXPENSE_CATEGORY_INVALID'],
    ['date',{expenseDate:'2026-02-30'},400,'VALIDATION_ERROR'],
    ['future',{expenseDate:'2099-01-01'},400,'VALIDATION_ERROR'],
    ['money',{amountMinor:'1.2'},400,'VALIDATION_ERROR'],
  ]) expect(send(command(name,'/expenses',{...base,...patch})),status,code,'EXPENSE_'+name);
  expect(send(command('document-type','/expense-documents',{fileName:'synthetic.pdf',contentType:'application/pdf',sizeBytes:8,sha256:'a'.repeat(64)})),400,'DOCUMENT_TYPE_NOT_ALLOWED','DOCUMENT_TYPE');
  const expenseCommand=command('expense','/expenses',base);
  const expense=expect(send(expenseCommand),200,null,'EXPENSE_CREATE').expense;
  const er=expect(send(expenseCommand),200,null,'EXPENSE_REPLAY');check(er.replayed&&er.expense.id===expense.id,'EXPENSE_STABLE_REPLAY');
  expect(api('/expenses','POST',{...expenseCommand.body,amountMinor:'1235'}),409,'IDEMPOTENCY_CONFLICT','EXPENSE_CHANGED_BODY');
  const duplicate=command('expense-duplicate','/expenses',base);
  const rejection=expect(send(duplicate),409,'EXPENSE_POSSIBLE_DUPLICATE','DUPLICATE_CANDIDATE');
  check(rejection.candidate.id===expense.id,'AUTHORIZED_DUPLICATE_CANDIDATE');
  const distinct=command('expense-explicit-new-intent','/expenses',{...base,duplicateOf:expense.id,duplicateReason:'Separate synthetic receipt for distinct local acceptance expense'});
  const second=expect(send(distinct),200,null,'EXPLICIT_DISTINCT_EXPENSE').expense;
  check(second.id!==expense.id&&second.duplicateOf===expense.id&&distinct.body.operationId!==duplicate.body.operationId,'NEW_INTENT_AND_REASON');
  expect(api('/expenses/'+expense.id),200,null,'EXPENSE_REREAD');
  token=await auth(accounts.finance);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const sha=createHash('sha256').update(png).digest('hex');
  const upload=expect(send(command('document-request','/expense-documents',{fileName:'synthetic-cu20.png',contentType:'image/png',sizeBytes:png.length,sha256:sha})),200,null,'DOCUMENT_REQUEST');
  fixture.documentId=upload.document.id;persist();
  if(upload.upload)check(binary(upload.upload,png).status===204,'S3_OWNER_BINARY_UPLOAD_NO_JWT_COOKIE');
  const document=expect(send(command('document-confirm','/expense-documents/'+upload.document.id+'/confirm',{})),200,null,'DOCUMENT_CONFIRM');
  check(document.state==='available'&&document.sha256===sha,'S3_CONFIRMED_AVAILABLE');
  const download=expect(api('/expense-documents/'+document.id+'/download'),200,null,'DOCUMENT_DOWNLOAD_GRANT');
  const downloaded=binary(download);check(downloaded.status===200&&downloaded.sha256===sha&&downloaded.size===png.length,'S3_VERSIONED_BYTES_REREAD');
  const attached=expect(send(command('expense-document','/expenses',{...base,description:fixture.marker+' documented synthetic expense',amountMinor:'345',documentId:document.id})),200,null,'DOCUMENTED_EXPENSE').expense;
  check(attached.document?.id===document.id&&attached.document?.state==='available','PRIVATE_OWNER_DOCUMENT_ATTACHED');
  token=await auth(accounts.finance);
  const oracle=await php({mode:'oracle',ids:Object.values(fixture.intents),orderId:fixture.orderId,quoteId:context.quoteId});
  const link=oracle.links.find(l=>l.status==='active');const q=oracle.quote;
  check(link&&link.id===context.quoteLinkId&&link.saga_id===context.sagaId&&link.quote_id===context.quoteId&&Number(link.quote_version)===context.quoteVersion&&q.id===context.quoteId&&Number(q.version_number)===context.quoteVersion,'PG_EXACT_ACTIVE_QUOTE_LINK');
  const decimalMinor=(BigInt(q.exact_total.split('.')[0])*100n+BigInt((q.exact_total.split('.')[1]??'').padEnd(2,'0'))).toString();
  check(decimalMinor===original.agreedAmountMinor&&q.order_reference===fixture.orderId&&q.currency==='BOB','PG_DECIMAL_EXACT_SERVER_AMOUNT');
  const fixturePayments=oracle.payments.filter(p=>p.orderId===fixture.orderId);
  check(fixturePayments.length===1&&fixturePayments[0].id===winner.payment.id,'PG_ONE_PAYMENT');
  for(const op of oracle.operations) check(oracle.audit.filter(a=>a.operationId===op.operationId).length===1,'PG_ONE_AUDIT_'+op.operationId);
  for(const name of ['race-a','race-b','expense','expense-duplicate','expense-explicit-new-intent'])check(oracle.operations.filter(o=>o.operationId===fixture.intents[name]).length===1,'PG_ONE_OPERATION_'+name);
  const period='?from='+date+'&to='+date;
  const payments=oracle.payments.filter(p=>civil(p.recordedAt)===date), expenses=oracle.expenses.filter(e=>e.expenseDate===date);
  const summary=expect(api('/financial-summary'+period),200,null,'SUMMARY');
  check(summary.receivedAmountMinor===sum(payments)&&summary.expenseAmountMinor===sum(expenses)&&summary.netMovementMinor===(BigInt(sum(payments))-BigInt(sum(expenses))).toString()&&summary.paymentCount===payments.length&&summary.expenseCount===expenses.length,'SUMMARY_PG_MONEY_ORACLES_NOT_BUDGETS');
  const listing=expect(api('/payments'+period),200,null,'PAYMENTS_ORACLE');check(listing.totalAmountMinor===sum(payments),'PAYMENT_LIST_TOTAL');
  const elisting=expect(api('/expenses'+period),200,null,'EXPENSES_ORACLE');check(elisting.totalAmountMinor===sum(expenses),'EXPENSE_LIST_TOTAL');
  save('oracle.json',{orderId:fixture.orderId,quote:q,link,fixturePaymentCount:fixturePayments.length,operationCount:oracle.operations.length,auditCount:oracle.audit.length,summary});
  report.pass=true;
}
main().catch(error=>{report.error=/^[A-Z0-9_:-]+$/.test(error.message)?error.message:'ACCEPTANCE_FAILED_SANITIZED';process.exitCode=1;}).finally(()=>{report.finishedAt=new Date().toISOString();save('result.json',report);console.log(JSON.stringify(report));});
