import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
export async function verify() {
 const {workspace,ownerDatabase,sanitize}=await import('./runtime.mjs');
 const {createFlow,api}=await import('./fixtures.mjs');
 const report={pass:false,stages:[]}; const databases=[];
 const directory=resolve(workspace,'output/cu15'); mkdirSync(directory,{recursive:true});
 const file=resolve(directory,'unicode-real-'+Date.now()+'.json');
 try {
  const flow=await createFlow({prefix:'UNICODE'});
  const raw=String.fromCharCode(0xfeff)+flow.requiredSpecialty.replaceAll(' ',String.fromCharCode(160))+String.fromCharCode(0x3000);
  assert.notEqual(raw,flow.requiredSpecialty);
  const started=await api('operations','/orders/'+flow.order.id+'/confirmations','POST',{...flow.command,requiredSpecialty:raw},'jefe_taller');
  assert.equal(started.status,202); assert.equal(started.body.requiredSpecialty,flow.requiredSpecialty);
  report.ids={sagaId:started.body.sagaId,orderId:flow.order.id,employeeId:flow.employee.id,quoteId:flow.quote.id};
  report.stages.push('normalizes-NBSP-FEFF-ideographic-space-before-freezing');
  const deadline=Date.now()+90000; let current;
  do { const response=await api('operations','/confirmations/'+started.body.sagaId,'GET',undefined,'jefe_taller'); assert.equal(response.status,200); current=response.body; if(['confirmed','rejected'].includes(current.status))break; await pause(500); }while(Date.now()<deadline);
  assert.equal(current.status,'confirmed'); assert.equal(current.requiredSpecialty,flow.requiredSpecialty);
  const operations=await ownerDatabase('operations'),employees=await ownerDatabase('employees'); databases.push(operations,employees);
  const step=(await operations.query("SELECT operation_id,body,fingerprint,result FROM operations.cu15_steps WHERE saga_id=$1 AND command='reserve_assignment'",[started.body.sagaId])).rows[0];
  const result=(await employees.query('SELECT result FROM employees.cu15_operations WHERE operation_id=$1',[step.operation_id])).rows[0].result;
  assert.equal(step.body.requiredSpecialty,flow.requiredSpecialty); assert.equal(step.fingerprint,result.fingerprint); assert.equal(step.result.fingerprint,result.fingerprint);
  assert.equal(result.resource.requiredSpecialty,flow.requiredSpecialty); assert.equal(result.outcome,'applied');
  assert.equal((await employees.query("SELECT count(*)::int AS n FROM employees.cu15_operations WHERE saga_id=$1 AND command='reserve_assignment' AND outcome='applied'",[started.body.sagaId])).rows[0].n,1);
  report.stages.push('real-owner-ledgers-have-identical-fingerprint-and-one-reservation');
  report.status=current.status; report.fingerprint=step.fingerprint; report.pass=true;
 }catch(error){report.error=sanitize(error.stack??String(error),[]);process.exitCode=1;}finally{for(const db of databases)await db.end();writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:file}));}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(!process.argv.includes('--run')){console.error('Explicit --run required');process.exitCode=2;}else await verify();}
