import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createHandler} from '../dist/server.js';
const first={from:'2026-10-26',to:'2026-11-01'};
const next={from:'2026-11-02',to:'2026-11-08'};
const token=sub=>[Buffer.from(JSON.stringify({alg:'RS256'})).toString('base64url'),Buffer.from(JSON.stringify({sub,exp:4102444800,realm_access:{roles:['mcp_read_team']}})).toString('base64url'),'signature'].join('.');
const sourceFactory=()=>({async listTools(){return[];},async call(name,args){return {ok:true,data:{data:[],page:{total:0},period:{from:args.from,to:args.to,timeZone:'America/La_Paz'},observedAt:'2026-11-02T13:00:00Z'}};},async close(){}});
async function start(directory,now,authorizeReport=async()=>{}){
  const server=createServer(createHandler({jobDirectory:directory,llm:null,sourceFactory,now,logger:()=>{},...(authorizeReport?{authorizeReport}: {})}));
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const call=async(path,body,sub='scheduler')=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{authorization:'Bearer '+token(sub),'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  return {server,call,close:()=>new Promise(done=>server.close(done))};
}
test('failed delivery survives HTTP service restart, job retention and a later civil week',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'cu28-delivery-http-'));let now=new Date('2026-11-02T13:00:00Z');
  let s=await start(dir,()=>now);let ready;
  try{
    const acquired=await s.call('/report/weekly/deliveries',first);assert.equal(acquired.status,200);
    assert.equal(acquired.body.status,'pending');assert.equal(acquired.body.report,null);
    const job=await s.call('/report/jobs',{...first,operationId:acquired.body.operationId});assert.equal(job.status,202);
    for(let n=0;n<50;n++){ready=await s.call('/report/weekly/deliveries',first);if(ready.body.report)break;await new Promise(done=>setTimeout(done,10));}
    assert.ok(ready.body.report);assert.equal(ready.body.jobId,job.body.jobId);
    const foreign=await s.call('/report/weekly/deliveries/'+ready.body.operationId+'/ack',{eventId:ready.body.eventId,status:'recorded'},'other');assert.equal(foreign.status,404);
    unlinkSync(join(dir,job.body.jobId+'.json'));
  }finally{await s.close();}
  now=new Date('2026-11-09T13:00:00Z');s=await start(dir,()=>now);
  try{
    const recovered=await s.call('/report/weekly/deliveries',next);assert.equal(recovered.status,200);
    assert.deepEqual(recovered.body,ready.body);
    const mismatch=await s.call('/report/weekly/deliveries/'+ready.body.operationId+'/ack',{eventId:'00000000-0000-4000-8000-000000000000',status:'recorded'});assert.equal(mismatch.status,409);
    const ack=await s.call('/report/weekly/deliveries/'+ready.body.operationId+'/ack',{eventId:ready.body.eventId,status:'duplicate'});assert.equal(ack.status,200);assert.equal(ack.body.status,'delivered');
    const again=await s.call('/report/weekly/deliveries/'+ready.body.operationId+'/ack',{eventId:ready.body.eventId,status:'recorded'});assert.equal(again.status,200);
    const following=await s.call('/report/weekly/deliveries',next);assert.equal(following.status,200);assert.equal(following.body.period.from,next.from);assert.notEqual(following.body.eventId,ready.body.eventId);
  }finally{await s.close();}
});
