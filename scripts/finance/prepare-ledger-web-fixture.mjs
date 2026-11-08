import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {internal,ensure} from '../mcp/local-admin.mjs';
import {login} from '../cu28/provision-scheduler.mjs';

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)),'../..'));
const label=process.argv.find(arg=>arg.startsWith('--label='))?.slice('--label='.length);
ensure(label===undefined||/^[a-z0-9-]{1,40}$/.test(label),'FIXTURE_LABEL_INVALID');
const stem='output/finance/cu19/web-fixture'+(label?'-'+label:'');
const file=stem+'.json';
execFileSync('git',['check-ignore',file],{stdio:'pipe'});
const load=p=>JSON.parse(readFileSync(p,'utf8'));
const state=existsSync(file)?load(file):{marker:'CU19-WEB-'+randomUUID().slice(0,8).toUpperCase(),commands:{},reads:[],createdAt:new Date().toISOString()};
const save=()=>writeFileSync(file,JSON.stringify(state,null,2)+'\n',{mode:0o600});
save();
const accounts={...load('output/stack/live-demo/accounts.json').accounts,admin:load('output/cu27/fixture/admin-test.private.json').accounts.adminTest};
const cache=new Map();
async function token(actor){
  const prev=cache.get(actor);if(prev&&prev.exp>Date.now()/1000+20)return prev.value;
  const value=(await login(accounts[actor])).access_token;
  const exp=JSON.parse(Buffer.from(value.split('.')[1],'base64url')).exp;
  cache.set(actor,{value,exp});return value;
}
const ports={operations:8081,employees:3002,finance:8000};
const sanitize=value=>Array.isArray(value)?value.map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!['upload','url','headers','headersJson','access_token','refresh_token','id_token'].includes(k)).map(([k,v])=>[k,sanitize(v)])):value;
async function request(owner,path,method='GET',body,actor='admin'){
  ensure(Object.hasOwn(ports,owner),'OWNER_INVALID');
  const start=Date.now();let result;
  try{result=internal('http://'+owner+':'+ports[owner]+path,{method,body,token:await token(actor)});}
  catch{state.lastCall={owner,path,method,status:null,code:'TRANSPORT_OUTCOME_UNKNOWN',elapsedMs:Date.now()-start};save();throw new Error('OWNER_TRANSPORT_FAILED_'+owner.toUpperCase());}
  state.lastCall={owner,path,method,status:result.status,code:result.data?.code??null,elapsedMs:Date.now()-start};save();
  ensure([200,201,202].includes(result.status),'OWNER_HTTP_'+result.status+'_'+(result.data?.code??'UNKNOWN'));
  return result.data;
}
async function read(owner,path,actor='admin'){
  const result=await request(owner,path,'GET',undefined,actor);
  state.reads.push({...state.lastCall,at:new Date().toISOString()});save();return result;
}
async function command(name,owner,path,body,actor='admin',fresh=false){
  let c=state.commands[name];
  if(!c){c=state.commands[name]={owner,path,actor,body:{operationId:randomUUID(),...body}};save();}
  ensure(c.owner===owner&&c.path===path&&c.actor===actor,'COMMAND_SCOPE_DRIFT');
  if(c.result&&!fresh)return c.result;
  const result=await request(c.owner,c.path,'POST',c.body,c.actor);
  c.result=sanitize(result);c.completedAt=new Date().toISOString();save();return result;
}
const civil=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/La_Paz',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
async function selectSlot(){
  const mechanics=(await read('employees','/staffing/mechanics?limit=100')).items;
  for(let day=0;day<8;day++)for(const actor of ['mechanicA','mechanicB']){
    const m=mechanics.find(m=>m.id===accounts[actor].employeeId&&m.eligible);
    if(!m)continue;
    const date=civil(Date.now()+day*86400000);
    const a=await read('employees','/staffing/mechanics/'+m.id+'/availability?date='+date);
    state.availability=a;save();
    if(a.absent)continue;
    const occupied=[...a.assignments,...(a.reservations??[])];
    for(const w of a.available){
      const first=Date.parse(date+'T'+w.start+':00-04:00'),last=Date.parse(date+'T'+w.end+':00-04:00');
      for(let start=first;start+30*60000<=last;start+=30*60000){
        const end=start+30*60000;
        if(occupied.some(x=>start<Date.parse(x.endsAt)&&Date.parse(x.startsAt)<end))continue;
        return {actor,employeeId:m.id,employeeVersion:m.version,requiredSpecialty:m.specialties[0],date,startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),observedAt:new Date().toISOString()};
      }
    }
  }
  throw new Error('NO_FREE_EXISTING_SYNTHETIC_MECHANIC_SLOT_WITHOUT_SCHEDULE_MUTATION');
}
async function main(){
  ensure(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim()==='work/marcelo','BRANCH_MISMATCH');
  if(process.argv.includes('--reconcile')){
    ensure(state.saga?.assignmentId,'NO_NEW_ASSIGNMENT_TO_RECONCILE');
    state.reconciled=await read('operations','/executions/me/'+state.saga.assignmentId,state.slot.actor);save();
    console.log(JSON.stringify({reconciled:true,execution:state.reconciled}));return;
  }
  if(state.ready){console.log(JSON.stringify(state.ready));return;}
  if(!state.slot){state.slot=await selectSlot();save();}
  const slot=state.slot,tag=state.marker,suffix=tag.slice(-8);
  if(process.argv.includes('--preflight')){console.log(JSON.stringify({preflight:true,slot}));return;}
  const customer=(await command('customer','operations','/customers',{firstName:'Synthetic',lastName:tag,document:'CW'+suffix,email:tag.toLowerCase()+'@example.invalid',phone:'+59170000019'})).customer;
  const vehicle=(await command('vehicle','operations','/vehicles',{customerId:customer.id,plate:'CW'+suffix,make:'Kia',model:'Synthetic CU19 WEB',year:2024,fuelType:'gasolina'})).vehicle;
  const service=(await command('service','operations','/services',{name:tag,description:'Synthetic service for unpaid CU19 browser acceptance',category:'reparacion',estimatedMinutes:30,referenceRate:150})).service;
  const reception=(await command('reception','operations','/receptions',{vehicleId:vehicle.id,mileage:15000,reason:tag,symptoms:'Synthetic acceptance only',visibleConditions:'No private photographs'})).reception;
  const order=(await command('order','operations','/orders',{receptionId:reception.id,description:tag,priority:'normal',notes:'Synthetic fixture: intentionally unpaid for React acceptance',services:[{serviceId:service.id,quantity:1}]})).order;
  state.orderId=order.id;state.orderNumber=order.number;save();
  ensure(order.id!=='5f35fc40-f994-40a7-b7c9-8f3e76f88d11','EXISTING_ORDER_FORBIDDEN');
  const quote=(await command('quote','finance','/quotes',{orderReference:order.id,orderNumber:order.number,customerReference:customer.id,vehicleReference:vehicle.id,vehiclePlate:vehicle.plate,validUntil:civil(Date.now()+14*86400000),notes:tag,items:[{serviceReference:service.id,description:service.name,quantity:1,unitPrice:150}]})).quote;
  await command('approval','finance','/quotes/'+quote.id+'/decision',{decision:'approved',evidence:'Explicit synthetic customer approval '+tag});
  const confirmation=await command('confirmation','operations','/orders/'+order.id+'/confirmations',{expectedVersion:order.version,quoteId:quote.id,quoteVersion:quote.version,employeeId:slot.employeeId,employeeVersion:slot.employeeVersion,requiredSpecialty:slot.requiredSpecialty,startsAt:slot.startsAt,endsAt:slot.endsAt});
  let saga;
  for(let n=0;n<30;n++){
    saga=await read('operations','/confirmations/'+confirmation.sagaId);
    state.saga=saga;save();
    if(['confirmed','rejected'].includes(saga.status))break;
    await new Promise(r=>setTimeout(r,1500));
  }
  ensure(saga.status==='confirmed','SAGA_NOT_CONFIRMED_'+(saga.errorCode??saga.status));
  const assignmentId=saga.assignmentId;
  ensure(assignmentId,'SAGA_ASSIGNMENT_MISSING');
  const started=await command('start','operations','/executions/'+assignmentId+'/start',{},slot.actor);
  const advanced=await command('advance','operations','/executions/'+assignmentId+'/advances',{expectedVersion:started.execution.version,description:'Synthetic completed CU19 WEB service; no real vehicle work asserted',minutesWorked:5},slot.actor);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==','base64');
  const evidencePath='/executions/'+assignmentId+'/advances/'+advanced.advance.id+'/evidences';
  const uncertain=state.commands['evidence-confirm'];
  if(uncertain&&!uncertain.result){
    const reconciled=await read('operations','/executions/me/'+assignmentId,slot.actor);
    const prior=reconciled.advances.flatMap(a=>a.evidences).find(e=>uncertain.path.includes(e.id));
    ensure(prior?.state==='available','UNCERTAIN_EVIDENCE_REQUIRES_OWNER_RECONCILIATION');
    await command('evidence-confirm',uncertain.owner,uncertain.path,uncertain.body,uncertain.actor);
  }
  if(!state.commands['evidence-confirm']?.result){
    const issued=await command('evidence-request','operations',evidencePath,{fileName:'synthetic-cu19-web.png',contentType:'image/png',sizeBytes:png.length,checksumSha256:createHash('sha256').update(png).digest('base64')},slot.actor,true);
    const headers=JSON.parse(issued.upload.headersJson);
    ensure(!Object.keys(headers).some(k=>['authorization','cookie'].includes(k.toLowerCase())),'BINARY_CREDENTIAL_BOUNDARY');
    let uploaded;
    try{uploaded=await fetch(issued.upload.url,{method:issued.upload.method,headers,body:png,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});}
    catch{throw new Error('SIGNED_BINARY_UPLOAD_FAILED');}
    state.binary={status:uploaded.status,at:new Date().toISOString(),jwtSent:false,cookieSent:false};save();
    ensure(uploaded.ok||uploaded.status===412,'SIGNED_BINARY_HTTP_'+uploaded.status);
    const confirmed=await command('evidence-confirm','operations','/executions/'+assignmentId+'/evidences/'+issued.evidence.id+'/confirm',{expectedVersion:issued.evidence.version},slot.actor);
    ensure(confirmed.evidence.state==='available','EVIDENCE_NOT_AVAILABLE_'+(confirmed.evidence.failureCode??'UNKNOWN'));
  }
  let view=await read('operations','/executions/review-self/'+assignmentId,slot.actor);
  for(const item of view.checklist.filter(i=>i.state==='pending'))view=await command('checklist-'+item.id,'operations','/executions/'+assignmentId+'/checklist/'+item.id+'/complete',{expectedVersion:item.version},slot.actor);
  ensure(view.mandatoryPending===0&&view.availableEvidence>=1,'CU17_PREREQUISITES_NOT_MET');
  if(view.execution.status==='in_progress')view=await command('request-review','operations','/executions/'+assignmentId+'/request-review',{expectedVersion:view.execution.version},slot.actor);
  if(view.execution.status==='pending_verification')view=await command('complete','operations','/executions/'+assignmentId+'/approve',{expectedVersion:view.execution.version},'chief');
  ensure(view.execution.status==='completed','EXECUTION_NOT_COMPLETED');
  const context=await read('operations','/orders/'+order.id+'/collection-context','finance');
  const receivable=await read('finance','/receivables/'+order.id,'finance');
  ensure(context.orderStatus==='completed'&&context.sagaStatus==='confirmed'&&context.eligibleForCollection,'COLLECTION_CONTEXT_INELIGIBLE');
  ensure(receivable.paidAmountMinor==='0'&&receivable.payments.length===0&&BigInt(receivable.balanceMinor)>0n,'FIXTURE_NOT_UNPAID');
  state.context=context;state.receivable=receivable;
  state.ready={pass:true,marker:tag,orderId:order.id,orderNumber:order.number,amountMinor:receivable.balanceMinor,paidAmountMinor:receivable.paidAmountMinor,assignmentId,context,completedAt:new Date().toISOString(),intentionallyUnpaid:true};save();
  writeFileSync(stem+'-result.json',JSON.stringify(state.ready,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(state.ready));
}
main().catch(error=>{state.failure={code:/^[A-Z0-9_:-]+$/.test(error.message)?error.message:'PREPARATION_FAILED_SANITIZED',at:new Date().toISOString(),lastCall:state.lastCall};save();console.log(JSON.stringify({pass:false,...state.failure}));process.exitCode=1;});
