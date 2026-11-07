/** Explicit local n8n installer. --proof changes ONLY IDs/cadence, preserving node code/contracts.
 * Never deletes n8n state, channel records, credentials or business data. */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

const mode = process.argv[2];
if (!['--production', '--proof', '--stop-proof'].includes(mode)) throw new Error('EXPLICIT_INSTALL_MODE_REQUIRED');
const container = 'cu16-proof-n8n-1';
const run = args => execFileSync('docker', args, {encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe']});
const files = ['appointments-reminders-scheduled.json', 'quotes-pending-scheduled.json', 'weekly-report-scheduled.json'];
const workflows = files.map(file => JSON.parse(readFileSync(resolve('infra/n8n/workflows', file), 'utf8')));
const proof = mode !== '--production';
for (const flow of workflows) {
  if (proof) {
    flow.id += 'Proof'; flow.name += ' (cadencia de aceptación)';
    const timer = flow.nodes.find(n => n.type === 'n8n-nodes-base.scheduleTrigger');
    timer.parameters.rule.interval = [{field: 'cronExpression', expression: '*/30 * * * * *'}];
  }
  flow.active = false;
}
if (mode !== '--stop-proof') {
  mkdirSync('output/cu28/scheduler', {recursive: true});
  const file = resolve('output/cu28/scheduler/' + (proof ? 'proof' : 'production') + '-workflows.json');
  writeFileSync(file, JSON.stringify(workflows, null, 2));
  run(['cp', file, container + ':/tmp/cu28-scheduled.json']);
  const result = run(['exec', container, 'n8n', 'import:workflow', '--input=/tmp/cu28-scheduled.json']);
  console.log(result.trim());
}
for (const flow of workflows) {
  const result = run(['exec', container, 'n8n', 'update:workflow', '--id=' + flow.id, '--active=' + (mode !== '--stop-proof')]);
  console.log(JSON.stringify({id: flow.id, activeRequested: mode !== '--stop-proof', cli: result.trim().slice(-240)}));
}
run(['restart', container]);
console.log(JSON.stringify({mode, workflowIds: workflows.map(w => w.id), restarted: true}));
