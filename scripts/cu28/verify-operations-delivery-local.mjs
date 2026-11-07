/** Verify business replay and the delivered CU26 document without printing private responses. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {api} from './verify-catalogue-real.mjs';
import {checkReportContract} from '../../integration/agent/dist/report/contract.js';
const dir='output/cu28/catalogue/';
const fixture=JSON.parse(readFileSync(dir+'fixture.json','utf8'));
const all=()=>readFileSync('output/cu28/channel.jsonl','utf8').split(String.fromCharCode(10)).filter(Boolean).map(JSON.parse);
const observed=[];
try {
  const prior=fixture.resources.confirmation;
  const body=Object.fromEntries(['operationId','quoteId','quoteVersion','employeeId','employeeVersion','requiredSpecialty','startsAt','endsAt'].map(key=>[key,prior[key]]));
  body.expectedVersion=fixture.resources.order.version;
  const replay=await api('operations','/orders/'+fixture.resources.order.id+'/confirmations','chief','POST',body);
  assert.equal(replay.id??replay.sagaId,prior.id??prior.sagaId);assert.equal(replay.status,'confirmed');
  const assignment=all().filter(r=>r.eventType==='operations.assignment.confirmed.v1'&&r.event.aggregateId===fixture.resources.order.id);
  assert.equal(assignment.length,1);assert.equal(assignment[0].event.data.status,'confirmed');
  observed.push({flow:'assignment',sagaId:replay.id??replay.sagaId,eventId:assignment[0].eventId,records:assignment.length,replay:true});
  const reminder=JSON.parse(readFileSync(dir+'scheduled-reminder.json','utf8'));
  const notices=all().filter(r=>r.eventType==='operations.appointment.reminder.due.v1'&&r.event.aggregateId===reminder.appointmentId);
  assert.equal(notices.length,1);assert.ok(Date.parse(notices[0].receivedAt)>Date.parse(reminder.createdAt));
  const repeated=await api('operations','/automations/appointments/reminders','scheduler','POST',{});
  assert.ok(repeated.events.some(e=>e.eventId===notices[0].eventId));
  observed.push({flow:'appointment',appointmentId:reminder.appointmentId,eventId:notices[0].eventId,records:notices.length,createdAt:reminder.createdAt,deliveredAt:notices[0].receivedAt,repeatedOwnerId:true});
  const weeks=all().filter(r=>r.eventType==='automation.weekly.report.generated.v1'
    && r.event.data.period.from==='2026-10-26' && r.event.data.period.to==='2026-11-01');assert.equal(weeks.length,1);
  const data=weeks[0].event.data;const job=await api('agent','/report/jobs/'+data.jobId,'scheduler');assert.equal(job.status,'succeeded');
  const {jobId,operationId,...document}=data;assert.deepEqual(checkReportContract(document),[]);
  assert.ok(isDeepStrictEqual(job.report,document),'Delivered report differs from authorized CU26 document');
  observed.push({flow:'weekly',eventId:weeks[0].eventId,jobId,operationId,period:data.period,claims:data.claims.length,provenance:data.provenance,narrativePath:data.narrative.path,generative:data.narrative.generative,model:data.narrative.model,contractViolations:0,documentEqualsCU26:true,records:weeks.length});
  const proof={pass:true,at:new Date().toISOString(),observed};
  writeFileSync(dir+'operations-delivery.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}catch(error){console.error(JSON.stringify({pass:false,code:error.code??'PROOF_FAILED',completed:observed.map(r=>r.flow)}));process.exitCode=1;}
