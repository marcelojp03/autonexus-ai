/** Local operator coordinator. Keeps both providers alive and never modifies monetary records. */
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,openSync,writeSync,ftruncateSync,fsyncSync,closeSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const manifestFile=resolve(root,'output/finance/cu19/relocation-manifest.json');
const active=resolve(root,'output/stack/finance-documents.private.json');
const target=resolve(root,'output/stack/finance-documents-minio.private.json');
const image=process.env.FINANCE_RELOCATION_IMAGE??'cu16-proof-finance:relocation';
const parent='cu16-proof-finance-1';const anchor='cu16-proof-finance-documents-minio-prepare';
const nl=String.fromCharCode(10);
const hash=value=>createHash('sha256').update(value).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ownCodes=new Set(['MODE_REQUIRED','PROFILE_WRITE_INCOMPLETE','PREPARE_FIRST','CREDENTIAL_OR_BUCKET_DRIFT','FINANCE_NAMESPACE_CHANGED','ANCHOR_CHANGED','STATUS_NOT_RETURNED','PREPARE_NOT_CONFIRMED','NOT_OUR_PAUSE','FINANCE_NOT_QUIESCENT','COMMIT_TIMEOUT_STATUS_REQUIRED','ACTIVE_PROFILE_CHANGED','COMMIT_NOT_APPLIED_SOURCE_RESTORED','RELOCATION_UNCERTAIN_KEEP_MAINTENANCE_STATUS_REQUIRED']);
export function failureDiagnostic(error) {
  return error?.diagnostic??{stage:'coordinator',exit:null,code:ownCodes.has(error?.message)?error.message:'COORDINATOR_FAILED'};
}
export function runCommand(stage,file,args,options={}) {
  try{return execFileSync(file,args,{...options,stdio:['pipe','pipe','pipe']});}
  catch(error){
    const owner=events(String(error.stdout??'')).findLast(event=>event?.event==='RELOCATION_ERROR'&&typeof event.code==='string'&&/^RELOCATION_[A-Z_]{1,96}$/.test(event.code));
    const safe=Error('COORDINATOR_FAILED');safe.diagnostic={stage,exit:Number.isInteger(error.status)?error.status:null,code:owner?.code??'COORDINATOR_FAILED'};throw safe;
  }
}
const docker=args=>runCommand('docker-'+args[0],'docker',args,{encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
const inspect=name=>JSON.parse(docker(['inspect',name,'--format','{"Id":{{json .Id}},"Config":{"Labels":{{json .Config.Labels}}},"Mounts":{{json .Mounts}},"HostConfig":{"NetworkMode":{{json .HostConfig.NetworkMode}}},"State":{"Paused":{{json .State.Paused}},"Health":{"Status":{{json .State.Health.Status}}}}}']));
const events=text=>text.split(nl).flatMap(line=>{try{return line.trim().startsWith('{')?[JSON.parse(line)]:[];}catch{return [];}});
export function statusCommand(operationId) {
  assert.match(operationId??'',/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,'MODE_REQUIRED');
  return ['exec','--env','PGOPTIONS=-c lock_timeout=1000 -c statement_timeout=3000',parent,'/usr/local/bin/service-entrypoint','php','artisan','finance:relocate-documents','status',operationId,'--no-ansi','--no-interaction'];
}
export function recoveryDecision(status,currentHash,sourceHash,targetHash) {
  if (![sourceHash,targetHash].includes(currentHash)) return 'stop';
  if(status?.state==='committed'&&status.position==='allNew')return 'target';
  if(status?.state==='prepared'&&status.position==='allOld'&&status.covered===true)return 'source';
  return 'stop';
}
export function writeInPlace(file,bytes) {
  const fd=openSync(file,'r+');try{let offset=0;while(offset<bytes.length){const written=writeSync(fd,bytes,offset,bytes.length-offset,offset);if(written<1)throw Error('PROFILE_WRITE_INCOMPLETE');offset+=written;}ftruncateSync(fd,bytes.length);fsyncSync(fd);}finally{closeSync(fd);}
}
async function main(mode) {
  assert.ok(['prepare','commit','status'].includes(mode),'MODE_REQUIRED');
  // A committed transfer must remain inspectable after its preparation container is retired
  // and Finance is recreated. Status uses the current owner, not the historical network anchor.
  if(mode==='status') {
    const state=JSON.parse(readFileSync(manifestFile,'utf8'));
    const p=inspect(parent);
    assert.equal(p.Config.Labels['com.docker.compose.project'],'cu16-proof');
    assert.equal(p.Config.Labels['com.docker.compose.service'],'finance');
    const output=runCommand('cli-status','docker',statusCommand(state.operationId),{encoding:'utf8',input:'',timeout:30000,maxBuffer:2*1024*1024});
    const result=events(output).findLast(event=>event.event==='RELOCATION_STATUS'&&event.operationId===state.operationId);
    assert.ok(result,'STATUS_NOT_RETURNED');console.log(JSON.stringify(result));return;
  }
  const p=inspect(parent);const a=inspect(anchor);
  assert.equal(p.Config.Labels['com.docker.compose.project'],'cu16-proof');assert.equal(p.Config.Labels['com.docker.compose.service'],'finance');
  assert.equal(a.Config.Labels['autonexus.owner'],'finance');assert.equal(a.Config.Labels['autonexus.purpose'],'storage-relocation-target');assert.equal(a.HostConfig.NetworkMode,'container:'+p.Id);
  assert.equal(a.State.Health?.Status,'healthy');
  const config=p.Mounts.find(mount=>mount.Destination==='/run/config');assert.equal(config.Name,'cu16-proof_config-finance');
  let state=existsSync(manifestFile)?JSON.parse(readFileSync(manifestFile,'utf8')):null;
  if(!state){
    assert.equal(mode,'prepare','PREPARE_FIRST');assert.equal(p.State.Paused,false);
    const sourceBytes=readFileSync(active);const targetBytes=readFileSync(target);const sourceConfig=JSON.parse(sourceBytes),targetConfig=JSON.parse(targetBytes);
    assert.equal(sourceConfig.endpoint,'http://127.0.0.1:4566');assert.equal(targetConfig.endpoint,'http://127.0.0.1:4568');
    for(const key of ['bucket','region','accessKey','secretKey'])assert.equal(targetConfig[key],sourceConfig[key],'CREDENTIAL_OR_BUCKET_DRIFT');
    const operationId=randomUUID();const source=resolve(root,'output/stack/finance-documents-source-'+operationId+'.private.json');
    writeFileSync(source,sourceBytes,{flag:'wx',mode:0o600});
    state={operationId,source,active,target,sourceHash:hash(sourceBytes),targetHash:hash(targetBytes),financeId:p.Id,anchorId:a.Id,pausedByUs:false,events:[]};
    writeFileSync(manifestFile,JSON.stringify(state,null,2),{flag:'wx',mode:0o600});
  }
  assert.equal(state.financeId,p.Id,'FINANCE_NAMESPACE_CHANGED');assert.equal(state.anchorId,a.Id,'ANCHOR_CHANGED');
  const save=()=>writeFileSync(manifestFile,JSON.stringify(state,null,2),{mode:0o600});
  const bind=(source,destination)=>'type=bind,source='+source.replaceAll(String.fromCharCode(92),'/')+',target='+destination+',readonly';
  const args=command=>['run','--pull=never','--rm','-i','--label','autonexus.owner=finance','--label','autonexus.purpose=document-relocation-cli','--network','container:'+a.Id,
    '--mount','type=volume,source='+config.Name+',target=/run/config,readonly','--mount',bind(state.source,'/profiles/source.json'),'--mount',bind(target,'/profiles/target.json'),'--mount',bind(active,'/profiles/active.json'),
    '--mount',bind(resolve(root,'scripts/finance/monetary-state.php'),'/operator/monetary-state.php'),'-e','FINANCE_DOCUMENT_STORAGE_FILE=/profiles/active.json',image,...command];
  const cli=which=>{const command=['php','artisan','finance:relocate-documents',which,state.operationId,'--no-ansi','--no-interaction'];if(which==='prepare')command.push('--source-profile=/profiles/source.json');if(which!=='status')command.push('--target-profile=/profiles/target.json');
    const output=runCommand('cli-'+which,'docker',args(command),{encoding:'utf8',input:'',timeout:180000,maxBuffer:2*1024*1024});const result=events(output).findLast(event=>event.event==='RELOCATION_STATUS');assert.ok(result,'STATUS_NOT_RETURNED');state.events.push(result);save();return result;};
  const oracle=what=>JSON.parse(runCommand('oracle-'+(what??'money'),'docker',args(['php','/operator/monetary-state.php',...(what?[what]:[])]),{encoding:'utf8',input:'',timeout:30000,maxBuffer:1024*1024}));
  if(mode==='prepare'){
    assert.equal(p.State.Paused,false);
    const backup=JSON.parse(readFileSync(resolve(root,'output/finance/cu19/document-backup-result.json'),'utf8'));assert.equal(backup.pass,true);
    runCommand('migration','docker',args(['php','artisan','migrate','--force','--no-interaction','--path=database/migrations/2026_11_07_000004_create_document_relocations.php']),{input:'',timeout:120000,stdio:['pipe','pipe','pipe']});
    state.moneyBefore=oracle();const prepared=cli('prepare');assert.equal(prepared.position,'allOld');assert.equal(prepared.covered,true);assert.equal(prepared.documents,backup.documents);
    assert.deepEqual(oracle(),state.moneyBefore);state.prepared=prepared;save();console.log(JSON.stringify({pass:true,phase:'prepared',documents:prepared.documents,monetaryUnchanged:true}));return;
  }
  assert.ok(state.prepared,'PREPARE_NOT_CONFIRMED');
  assert.equal(hash(readFileSync(state.source)),state.sourceHash);assert.equal(hash(readFileSync(target)),state.targetHash);
  let consistent=false;
  try{
    if(p.State.Paused){assert.equal(state.pausedByUs,true,'NOT_OUR_PAUSE');}
    else{
      let quiet=false;for(let i=0;i<3;i++){docker(['pause',parent]);state.pausedByUs=true;save();await wait(200);
        const first=oracle('transactions'),second=oracle('transactions');if(first.activeTransactions===0&&second.activeTransactions===0){quiet=true;break;}
        docker(['unpause',parent]);state.pausedByUs=false;save();await wait(250);
      }assert.ok(quiet,'FINANCE_NOT_QUIESCENT');
    }
    state.moneyAtCommit=oracle();save();
    const command=['php','artisan','finance:relocate-documents','commit',state.operationId,'--target-profile=/profiles/target.json','--no-ansi','--no-interaction'];
    let switched=false;const output=[];
    const code=await new Promise((resolveExit,reject)=>{
      const child=spawn('docker',args(command),{stdio:['pipe','pipe','pipe']});let buffer='';let ready=false;
      const timer=setTimeout(()=>{child.stdin.end('ABORT'+nl);reject(Error('COMMIT_TIMEOUT_STATUS_REQUIRED'));},120000);
      child.stdout.on('data',part=>{buffer+=part.toString();let end;while((end=buffer.indexOf(nl))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);for(const event of events(line)){output.push(event);if(event.event==='READY_TO_SWITCH'){
        try{assert.equal(ready,false);ready=true;assert.equal(event.operationId,state.operationId);assert.equal(event.targetFingerprint,state.prepared.targetFingerprint);assert.equal(event.documents,state.prepared.documents);assert.equal(hash(readFileSync(active)),state.sourceHash,'ACTIVE_PROFILE_CHANGED');
          writeInPlace(active,readFileSync(target));switched=true;state.profileSwitched=true;save();child.stdin.end('SWITCHED'+nl);
        }catch(error){child.stdin.end('ABORT'+nl);reject(error);}
      }}}});
      child.stderr.on('data',()=>{});child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',value=>{clearTimeout(timer);resolveExit(value);});
    });
    state.commitExit=code;state.events.push(...output);save();
    const status=cli('status');const decision=recoveryDecision(status,hash(readFileSync(active)),state.sourceHash,state.targetHash);
    if(decision==='target'){writeInPlace(active,readFileSync(target));consistent=true;state.committed=status;state.recoveredAfterUnknown=code!==0;assert.deepEqual(oracle(),state.moneyAtCommit);state.monetaryUnchanged=true;save();console.log(JSON.stringify({pass:true,phase:'committed',documents:status.documents,monetaryUnchanged:true,recovered:code!==0}));}
    else if(decision==='source'){if(switched||hash(readFileSync(active))===state.targetHash)writeInPlace(active,readFileSync(state.source));consistent=true;throw Error('COMMIT_NOT_APPLIED_SOURCE_RESTORED');}
    else throw Error('RELOCATION_UNCERTAIN_KEEP_MAINTENANCE_STATUS_REQUIRED');
  }finally{if(state.pausedByUs&&consistent){docker(['unpause',parent]);state.pausedByUs=false;save();}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await main(process.argv[2]);}catch(error){console.error(JSON.stringify({pass:false,...failureDiagnostic(error),nextAction:'status',profileMustNotBeBlindlyReverted:true}));process.exitCode=1;}}
