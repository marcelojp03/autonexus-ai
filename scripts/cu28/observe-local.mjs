/** Read-only operator evidence, identifiers/status only. Never prints credential or request headers. */
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
const dir = resolve('output/cu28/catalogue'); mkdirSync(dir, {recursive: true});
const run = args => execFileSync('docker', args, {encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
const script = `const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});
const flows=db.prepare("select id,active,staticData from workflow_entity where id like 'cu28%'").all();
console.log(JSON.stringify(flows.map(f=>{let s={};try{s=JSON.parse(f.staticData||'{}').global||{};}catch{}
return {id:f.id,active:f.active,lastResult:s.lastResult||null,pending:s.pending?{period:s.pending.period,jobId:s.pending.jobId}:null};})));`;
writeFileSync(resolve(dir, 'n8n-observe.cjs'), script);
run(['cp', resolve(dir, 'n8n-observe.cjs'), 'cu16-proof-n8n-1:/tmp/cu28-observe.cjs']);
const workflows = JSON.parse(run(['exec', 'cu16-proof-n8n-1', 'node', '/tmp/cu28-observe.cjs']));
const channel = existsSync('output/cu28/channel.jsonl')
  ? readFileSync('output/cu28/channel.jsonl', 'utf8').split(String.fromCharCode(10)).filter(Boolean).map(line=>JSON.parse(line)) : [];
const records = channel.map(r=>({eventId:r.eventId,eventType:r.eventType,receivedAt:r.receivedAt,
  aggregateId:r.event?.aggregateId,aggregateVersion:r.event?.aggregateVersion,
  period:r.event?.data?.period,narrativePath:r.event?.data?.narrative?.path,
  jobId:r.event?.data?.jobId,claims:r.event?.data?.claims?.length}));
const observed = {at: new Date().toISOString(),workflows,records};
const filename = (process.argv[2] ?? 'latest').replace(/[^a-z0-9-]/gi, '-');
writeFileSync(resolve(dir, filename + '-observation.json'), JSON.stringify(observed, null, 2));
console.log(JSON.stringify(observed, null, 2));
