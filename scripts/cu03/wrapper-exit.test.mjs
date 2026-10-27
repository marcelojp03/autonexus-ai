import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
function fixture(relative,codes){
  const temporary=mkdtempSync(join(tmpdir(),'autonexus-wrapper-exit-'));
  const target=resolve(temporary,relative);mkdirSync(dirname(target),{recursive:true});
  let index=0;
  const source=readFileSync(resolve(root,relative),'utf8').split(String.fromCharCode(10)).map(line=>{
    if(!line.trimStart().startsWith('& '))return line;
    const redirect=line.indexOf('*>');assert.ok(redirect>=0,'Only replace a captured native child invocation');
    const code=codes[index++];assert.ok(Number.isInteger(code));
    return "& '"+process.execPath.replaceAll("'","''")+"' -e 'process.exit("+code+")' "+line.slice(redirect);
  }).join(String.fromCharCode(10));
  assert.equal(index,codes.length);writeFileSync(target,source);
  return {temporary,target};
}
for(const scenario of [
  {name:'live verifier child failure',path:'services/employees/scripts/verify-main-integration.ps1',codes:[7],expected:7,file:'live-main.exit'},
  {name:'SQL verifier failure after browser success',path:'scripts/cu03/verify-cu01-main.ps1',codes:[0,9],expected:9,file:'postgres-main.exit'},
  {name:'live verifier success',path:'services/employees/scripts/verify-main-integration.ps1',codes:[0],expected:0,file:'live-main.exit'},
  {name:'browser and SQL verifier success',path:'scripts/cu03/verify-cu01-main.ps1',codes:[0,0],expected:0,file:'postgres-main.exit'},
]){
  test(scenario.name+' propagates exit without any application/database',()=>{
    const f=fixture(scenario.path,scenario.codes);
    try{
      const result=spawnSync('pwsh',['-NoProfile','-File',f.target],{cwd:f.temporary,encoding:'utf8',timeout:20000});
      assert.equal(result.status,scenario.expected,'Wrapper must not report success after native child failure');
      assert.equal(readFileSync(resolve(f.temporary,'output/cu03-main-integration',scenario.file),'utf8').trim(),String(scenario.expected));
    }finally{rmSync(f.temporary,{recursive:true,force:true});}
  });
}
