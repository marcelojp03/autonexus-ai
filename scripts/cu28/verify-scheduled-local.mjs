/** Local, explicit session-revocation proof. Never stores tokens in evidence.
 * Run revoke, assert-revoked after access expiry, then restore and assert-recovered. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {withLocalAdmin,mainRepositoryRoot} from '../mcp/local-admin.mjs';
import {renewCredential} from './provision-scheduler.mjs';
import {checkReportContract} from '../../integration/agent/dist/report/contract.js';
const dir=resolve('output/cu28/catalogue');
const path=resolve(dir,'schedule-authorization.json');
const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:args.includes('import:credentials')?180000:90000,stdio:['ignore','pipe','pipe']}).trim();
const flows=['cu28AppointmentRemindersProof','cu28PendingQuotesProof','cu28WeeklyReportProof'];
const rows=()=>readFileSync('output/cu28/channel.jsonl','utf8').split(String.fromCharCode(10)).filter(Boolean).map(JSON.parse);
function snapshot(){
  const code=`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});const ids=${JSON.stringify(flows)};console.log(JSON.stringify(ids.map(id=>db.prepare('select workflowId,status,mode,startedAt,stoppedAt from execution_entity where workflowId=? and stoppedAt is not null order by id desc limit 1').get(id))));`;
  const source=resolve(dir,'authorization-observe.cjs');writeFileSync(source,code);
  docker(['cp',source,'cu16-proof-n8n-1:/tmp/cu28-authorization-observe.cjs']);
  return JSON.parse(docker(['exec','cu16-proof-n8n-1','node','/tmp/cu28-authorization-observe.cjs']));
}
const phase=process.argv[2];
try{
  if(phase==='revoke'){
    const ledger=JSON.parse(readFileSync('output/cu28/scheduler/identity.private.json','utf8'));
    assert.match(ledger.marker,/^CU28-/);assert.equal(ledger.clientId,'autonexus-cu28-scheduler');
    const root=mainRepositoryRoot(execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{encoding:'utf8'}).trim());
    const before=snapshot();assert.ok(before.every(r=>r.status==='success'));
    await withLocalAdmin('http://127.0.0.1:4286',root,api=>{
      const user=api('/users/'+ledger.subject);assert.equal(user.username,ledger.username);
      api('/users/'+ledger.subject+'/logout','POST');
    },true,resolve('.'));
    const targetWeekly=rows().find(r=>r.eventType==='automation.weekly.report.generated.v1');assert.ok(targetWeekly);
    const proof={revokedAt:new Date().toISOString(),employeeId:ledger.employeeId,before,weeklyEventId:targetWeekly.eventId,baselineEvents:rows().map(r=>r.eventId)};
    writeFileSync(path,JSON.stringify(proof,null,2));console.log(JSON.stringify({phase,revokedAt:proof.revokedAt,employeeId:proof.employeeId}));
  }else if(phase==='assert-revoked'){
    const proof=JSON.parse(readFileSync(path,'utf8'));
    assert.ok(Date.now()-Date.parse(proof.revokedAt)>=70000,'Wait for the 60-second access token plus tolerance');
    const after=snapshot();
    assert.ok(after.every(r=>r.status==='error'&&r.mode==='trigger'&&Date.parse(r.startedAt+'Z')>Date.parse(proof.revokedAt)+65000));
    const weekly=rows().filter(r=>r.eventId===(proof.weeklyEventId??proof.recovered?.eventId??'a0280001-0000-8000-8000-202610260002'));
    assert.equal(weekly.length,1);
    proof.expired={at:new Date().toISOString(),executions:after,weeklyRecords:weekly.length};
    writeFileSync(path,JSON.stringify(proof,null,2));console.log(JSON.stringify({phase,pass:true,...proof.expired}));
  }else if(phase==='restore'||phase==='initialize'){
    const proof=phase==='initialize'?{}:JSON.parse(readFileSync(path,'utf8'));
    if(phase==='restore')assert.ok(proof.expired);
    await renewCredential();
    execFileSync('docker',['exec','-i','cu16-proof-n8n-1','n8n','import:credentials','--input=/dev/stdin'],{
      input:readFileSync('output/cu28/scheduler/credential.private.json'),timeout:180000,
      stdio:['pipe','pipe','pipe'],
    });
    // Running workflows may cache the old credential; restart only the scoped n8n container.
    docker(['restart','cu16-proof-n8n-1']);
    proof.restoredAt=new Date().toISOString();writeFileSync(path,JSON.stringify(proof,null,2));
    console.log(JSON.stringify({phase,restoredAt:proof.restoredAt}));
  }else if(phase==='assert-recovered'){
    const proof=JSON.parse(readFileSync(path,'utf8'));const after=snapshot();
    assert.ok(after.every(r=>r.status==='success'&&r.mode==='trigger'&&Date.parse(r.startedAt+'Z')>Date.parse(proof.restoredAt)));
    const weekly=rows().filter(r=>r.eventId===(proof.weeklyEventId??proof.recovered?.eventId??'a0280001-0000-8000-8000-202610260002'));assert.equal(weekly.length,1);
    const violations=checkReportContract(weekly[0].event.data);assert.deepEqual(violations,[]);
    proof.recovered={at:new Date().toISOString(),executions:after,eventId:weekly[0].eventId,jobId:weekly[0].event.data.jobId,period:weekly[0].event.data.period,narrative:weekly[0].event.data.narrative.path,claims:weekly[0].event.data.claims.length,violations:violations.length,weeklyRecords:weekly.length};
    writeFileSync(path,JSON.stringify(proof,null,2));console.log(JSON.stringify({phase,pass:true,...proof.recovered}));
  }else throw new Error('EXPLICIT_PHASE_REQUIRED');
}catch(error){console.error(JSON.stringify({phase,pass:false,code:error.code??'PROOF_FAILED'}));process.exitCode=1;}
