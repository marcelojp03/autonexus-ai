import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {login} from '../cu28/provision-scheduler.mjs';
import {internal} from '../mcp/local-admin.mjs';

const label=process.argv[2];
assert.match(label??'',/^[a-z0-9-]+$/);
const manifest=JSON.parse(readFileSync('output/finance/cu19/relocation-manifest.json','utf8'));
const backupResult=JSON.parse(readFileSync('output/finance/cu19/document-backup-result.json','utf8'));
const baseline=JSON.parse(readFileSync(backupResult.file,'utf8'));
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000,maxBuffer:2*1024*1024});
const report={pass:false,label,at:new Date().toISOString(),checks:[]};
try {
  assert.equal(manifest.committed?.state,'committed');
  docker(['cp','services/finance/scripts/document-state.php','cu16-proof-finance-1:/tmp/cu20-document-state.php']);
  const oracle=JSON.parse(docker(['exec','cu16-proof-finance-1','/usr/local/bin/service-entrypoint','php','/tmp/cu20-document-state.php',manifest.operationId]));
  assert.equal(oracle.pass,true);assert.deepEqual(oracle.money,manifest.moneyAtCommit);
  assert.equal(oracle.documents.length,baseline.items.length);
  const accounts=JSON.parse(readFileSync('output/stack/live-demo/accounts.json','utf8')).accounts;
  let issued;const owner=async(path,account='finance')=>{
    if(account!=='finance')return internal('http://finance:8000'+path,{token:(await login(accounts[account])).access_token});
    if(!issued||issued.at<Date.now()-35000)issued={...(await login(accounts.finance)),at:Date.now()};
    return internal('http://finance:8000'+path,{token:issued.access_token});
  };
  for(const document of oracle.documents) {
    const original=baseline.items.find(item=>item.documentId===document.id);assert.ok(original);
    assert.equal(document.sha256,original.sha256);assert.equal(document.sizeBytes,original.sizeBytes);assert.equal(document.contentType,original.contentType);
    assert.equal(document.oldVersion,original.objectVersion);assert.notEqual(document.version,'null');
    const allowed=await owner('/expense-documents/'+document.id+'/download');assert.equal(allowed.status,200);
    const grant=allowed.data;assert.match(grant.url,new RegExp('^/finance-files/documents/'+document.id+'/content$'));
    const headers=JSON.parse(grant.headersJson);assert.equal(Object.keys(headers).some(key=>/authorization|cookie/i.test(key)),false);
    const response=await fetch('http://127.0.0.1:4286'+grant.url,{headers,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});
    assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'),document.sha256);assert.equal(bytes.length,document.sizeBytes);
    const denied=await owner('/expense-documents/'+document.id+'/download','mechanicA');assert.equal(denied.status,403);
    report.checks.push({...document,authorizedRead:true,mechanicDenied:true,binaryHashMatches:true});
  }
  report.pass=true;report.monetaryUnchanged=true;
}catch {report.code='DOCUMENT_RELOCATION_VERIFICATION_FAILED';process.exitCode=1;}
writeFileSync('output/finance/cu19/document-relocation-'+label+'.json',JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({pass:report.pass,label,documents:report.checks.length,monetaryUnchanged:report.monetaryUnchanged??false,code:report.code}));
