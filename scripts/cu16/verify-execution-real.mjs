import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';
const origin = process.env.CU16_PUBLIC_ORIGIN || 'http://127.0.0.1:4285';
const accountFile = process.env.CU16_ACCOUNTS_FILE || 'output/stack/cu16-proof.accounts.private.json';
const accounts = JSON.parse(readFileSync(accountFile,'utf8')).accounts;
const issuer = origin + '/identity/realms/autonexus';
const result = { origin, evidenceStore: 'not-configured', checks: [], pass: false };
const check = (name, pass) => { assert.ok(pass, name); result.checks.push({name,status:'PASS'}); };
const token = async key => (await authorize({ ...accounts[key], enabled: true }, false, {issuer, redirect: origin + '/auth/callback'})).access_token;
const gql = async (bearer, query, variables={}) => { const r=await fetch(origin+'/graphql',{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:JSON.stringify({query,variables})}); assert.equal(r.status,200); return r.json(); };
const code = (response, root) => response.errors?.find(error=>error.path?.[0]===root)?.extensions?.code ?? (response.errors?.length===1 ? response.errors[0].extensions?.code : undefined);
try {
const a=await token('mechanicB'), b=await token('mechanicA'), chief=await token('chief');
const perms=await gql(a,'{securityCatalog{effective}}'); check('mechanic execution permissions',perms.data?.securityCatalog?.effective?.includes('executions:write')&&perms.data.securityCatalog.effective.includes('executions:read:self'));
const agenda=await gql(a,'query($from:Date,$to:Date){myAgenda(from:$from,to:$to,limit:50){items{assignmentId orderNumber executionStatus}}}',{from:'2026-11-01',to:'2026-11-30'}); check('CU05 agenda includes confirmed work',agenda.data?.myAgenda?.items?.length>0);
const work=agenda.data.myAgenda.items.find(item=>item.executionStatus==='not_started') ?? agenda.data.myAgenda.items.find(item=>item.executionStatus==='in_progress'); check('demo has a confirmed CU15 work record',Boolean(work));
const start='mutation($id:UUID!,$input:StartExecutionInput!){startExecution(assignmentId:$id,input:$input){execution{status version} replayed}}';
let currentExecution;
if(work.executionStatus==='not_started') { const startVars={id:work.assignmentId,input:{operationId:randomUUID()}}; const started=await gql(a,start,startVars); check('assigned mechanic starts execution',started.data?.startExecution?.execution?.status==='in_progress'); currentExecution=started.data.startExecution.execution; }
else { currentExecution=await (async()=>{const response=await gql(a,'query($id:UUID!){myExecution(assignmentId:$id){orderId assignmentId employeeId status version advances{id sequence}}}',{id:work.assignmentId});return response.data?.myExecution;})(); check('previous real start is present and active',currentExecution?.status==='in_progress'); }
const duplicate=await gql(a,start,{id:work.assignmentId,input:{operationId:randomUUID()}}); check('duplicate start rejected',code(duplicate,'startExecution')==='EXECUTION_ALREADY_STARTED');
const advance='mutation($id:UUID!,$input:RecordAdvanceInput!){recordAdvance(assignmentId:$id,input:$input){execution{version evidenceSummary{pending available failed} advances{sequence}} advance{id sequence} replayed}}'; const operationId=randomUUID(); const expected=currentExecution.version; const priorAdvances=currentExecution.advances.length; const vars={id:work.assignmentId,input:{operationId,expectedVersion:expected,description:'Inspección y cambio de aceite',minutesWorked:35}};
const first=await gql(a,advance,vars); check('advance recorded with optimistic version',first.data?.recordAdvance?.execution?.version===expected+1&&first.data.recordAdvance.advance.sequence===priorAdvances+1);
const replay=await gql(a,advance,vars); check('advance replay is idempotent',replay.data?.recordAdvance?.replayed===true&&replay.data.recordAdvance.execution.advances.length===priorAdvances+1);
const stale=await gql(a,advance,{id:work.assignmentId,input:{operationId:randomUUID(),expectedVersion:expected,description:'Stale',minutesWorked:3}}); check('stale version conflict',code(stale,'recordAdvance')==='VERSION_CONFLICT');
const other=await gql(b,'query($id:UUID!){myExecution(assignmentId:$id){status}}',{id:work.assignmentId}); check('other mechanic sees record-level 404',code(other,'myExecution')==='EXECUTION_WORK_NOT_FOUND');
const team=await gql(chief,'query($id:UUID!){teamExecution(assignmentId:$id){status advances{sequence}}}',{id:work.assignmentId}); check('jefe reads team execution',team.data?.teamExecution?.status==='in_progress');
const denied=await gql(chief,advance,{id:work.assignmentId,input:{operationId:randomUUID(),expectedVersion:expected+1,description:'No',minutesWorked:2}}); check('jefe remains read-only',code(denied,'recordAdvance')==='FORBIDDEN');
const evidence=await gql(a,'mutation($id:UUID!,$advance:UUID!,$input:RequestEvidenceInput!){requestEvidence(assignmentId:$id,advanceId:$advance,input:$input){evidence{id state}}}',{id:work.assignmentId,advance:first.data.recordAdvance.advance.id,input:{operationId:randomUUID(),fileName:'evidence.png',contentType:'image/png',sizeBytes:128,checksumSha256:createHash('sha256').update('not-uploaded').digest('base64')}});
const afterEvidence=await gql(a,'query($id:UUID!){myExecution(assignmentId:$id){evidenceSummary{pending available failed}}}',{id:work.assignmentId});
check('missing S3 settings fail explicitly without creating a pending evidence row',code(evidence,'requestEvidence')==='EVIDENCE_STORAGE_UNAVAILABLE'&&afterEvidence.data?.myExecution?.evidenceSummary?.pending===first.data.recordAdvance.execution.evidenceSummary.pending);
result.pass=true;
} catch(error) { result.errorName=error?.name||'Error'; throw error; } finally { writeFileSync('output/stack/cu16-execution-real-result.json',JSON.stringify(result,null,2)); }
console.log(JSON.stringify({pass:result.pass,checks:result.checks}));
