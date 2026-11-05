import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {JsonLineAuditSink} from '../dist/infrastructure/audit-sink.js';
test('audit serializes metadata only and appends separate outcomes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'autonexus-mcp-audit-'));
 try {
  const file=join(directory,'audit.jsonl');const sink=new JsonLineAuditSink(file);
  const event={actorSubject:'actor-1',clientId:'external-1',tool:'autonexus_list_orders',correlationId:'11111111-1111-4111-8111-111111111111',outcome:'REQUESTED',durationMs:0,token:'PRIVATE_TEST_TOKEN',arguments:{notes:'PRIVATE_NOTE'},url:'https://private.invalid/signed'};
  await sink.write(event);await sink.write({...event,outcome:'OK',durationMs:12});
  const content=await readFile(file,'utf8');const rows=content.trim().split(String.fromCharCode(10)).map(JSON.parse);
  assert.equal(rows.length,2);assert.equal(rows[1].outcome,'OK');
  for(const forbidden of ['PRIVATE_TEST_TOKEN','PRIVATE_NOTE','private.invalid','arguments','token'])assert.ok(!content.includes(forbidden));
  await assert.rejects(sink.write({...event,tool:'untrusted argument with spaces'}),/Audit storage/);
 } finally {await rm(directory,{recursive:true,force:true});}
});
