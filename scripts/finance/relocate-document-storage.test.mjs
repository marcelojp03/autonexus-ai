import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recoveryDecision,writeInPlace,runCommand,failureDiagnostic,statusCommand} from './relocate-document-storage.mjs';

test('status command survives retirement of preparation anchor and bounds owner locks',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const args=statusCommand(id);
  assert.equal(args[0],'exec');assert.ok(args.includes('cu16-proof-finance-1'));
  assert.ok(args.includes('PGOPTIONS=-c lock_timeout=1000 -c statement_timeout=3000'));
  assert.equal(args.includes('cu16-proof-finance-documents-minio-prepare'),false);
  assert.equal(args.includes('--mount'),false);
  assert.deepEqual(args.slice(-4),['status',id,'--no-ansi','--no-interaction']);
  assert.throws(()=>statusCommand('../invalid'));
});

test('failed subprocess exposes only stage, exit and structured owner code',()=>{
  const script="console.log('private stdout');console.log(JSON.stringify({event:'RELOCATION_ERROR',code:'RELOCATION_NOT_FOUND',secret:'private payload'}));console.error('private stderr');process.exit(7)";
  assert.throws(()=>runCommand('cli-status',process.execPath,['-e',script],{encoding:'utf8'}),error=>{
    assert.deepEqual(failureDiagnostic(error),{stage:'cli-status',exit:7,code:'RELOCATION_NOT_FOUND'});
    assert.equal(JSON.stringify(error).includes('private'),false);
    return true;
  });
});

test('diagnostics reject arbitrary messages, stderr, codes and malformed stdout',()=>{
  for(const stdout of ['private', '{broken', JSON.stringify({event:'OTHER',code:'RELOCATION_NOT_FOUND'}), JSON.stringify({event:'RELOCATION_ERROR',code:'PRIVATE_SECRET'})]){
    const script="console.log("+JSON.stringify(stdout)+");console.error('RELOCATION_NOT_FOUND');process.exit(1)";
    assert.throws(()=>runCommand('cli-status',process.execPath,['-e',script],{encoding:'utf8'}),error=>{
      assert.deepEqual(failureDiagnostic(error),{stage:'cli-status',exit:1,code:'COORDINATOR_FAILED'});return true;
    });
  }
  assert.deepEqual(failureDiagnostic(Error('PRIVATE_SECRET')),{stage:'coordinator',exit:null,code:'COORDINATOR_FAILED'});
  assert.equal(runCommand('cli-status',process.execPath,['-e',"process.stdout.write('ok')"],{encoding:'utf8'}),'ok');
});
test('unknown commit follows authoritative journal, not subprocess transport result',()=>{
  assert.equal(recoveryDecision({state:'committed',position:'allNew'},'old','old','new'),'target');
  assert.equal(recoveryDecision({state:'prepared',position:'allOld',covered:true},'new','old','new'),'source');
  for(const status of [null,{state:'committed',position:'mixed'},{state:'prepared',position:'allOld',covered:false},{state:'prepared',position:'allNew'}])assert.equal(recoveryDecision(status,'new','old','new'),'stop');
  assert.equal(recoveryDecision({state:'committed',position:'allNew'},'unrecognized','old','new'),'stop');
});
test('profile switch preserves existing file identity and truncates old suffix',()=>{
  const directory=mkdtempSync(join(tmpdir(),'finance-profile-test-'));const file=join(directory,'profile');
  try{writeFileSync(file,'previous longer public fixture');const before=statSync(file);writeInPlace(file,Buffer.from('new'));assert.equal(readFileSync(file,'utf8'),'new');assert.equal(statSync(file).ino,before.ino);}finally{rmSync(directory,{recursive:true,force:true});}
});
