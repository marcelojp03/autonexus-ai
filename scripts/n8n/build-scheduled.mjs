import {readFile, writeFile} from 'node:fs/promises';
import * as functions from './scheduled-functions.mjs';

const root = new URL('../../infra/n8n/workflows/', import.meta.url);
const check = process.argv.includes('--check');
const settings = {
  executionOrder: 'v1', timezone: 'America/La_Paz', saveManualExecutions: false,
  saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveExecutionProgress: false,
  executionTimeout: 600,
};
const credential = {oAuth2Api: {id: 'autonexusCu28Scheduler', name: 'AutoNexus CU28 delegated employee'}};
const node = (name, type, parameters, version = 2) => ({
  id: name.toLowerCase().replaceAll(' ', '-'), name, type: 'n8n-nodes-base.' + type,
  typeVersion: version, position: [0, 0], parameters,
});
const code = (name, names, body) => node(name, 'code', {
  jsCode: names.map(key => functions[key].toString()).join(String.fromCharCode(10)) + String.fromCharCode(10)
    + 'try {' + body + `} catch (failure) {
const failureCode = /^CU28_[A-Z_]+$/.test(failure.message) ? failure.message : 'CU28_INTERNAL_FAILURE';
throw new Error(failureCode);
}`,
});
const trigger = cron => node('Schedule', 'scheduleTrigger', {
  rule: {interval: [{field: 'cronExpression', expression: cron}]},
}, 1.3);
const request = (name, url, method, body, oauth = true) => ({
  ...node(name, 'httpRequest', {
    url, method,
    ...(oauth ? {authentication: 'genericCredentialType', genericAuthType: 'oAuth2Api'} : {}),
    ...(body === undefined ? {} : {sendBody: true, specifyBody: 'json', jsonBody: body}),
    options: {timeout: 20000, redirect: {redirect: {followRedirects: false}},
      response: {response: {responseFormat: 'json', fullResponse: true, neverError: true}}},
  }, 4.5),
  ...(oauth ? {credentials: credential} : {}), onError: 'continueErrorOutput',
});
const branch = (name, field) => node(name, 'if', {
  conditions: {options: {caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2},
    conditions: [{id: name, leftValue: '={{ $json.' + field + ' }}', rightValue: '',
      operator: {type: 'boolean', operation: 'true', singleValue: true}}], combinator: 'and'},
  options: {},
}, 2.2);
const safeFailure = () => code('Safe transport failure', [], `const allowed = ['CU28_INVALID_PERIOD', 'CU28_AUTHORIZATION_REQUIRED', 'CU28_HTTP_UNAVAILABLE',
  'CU28_INVALID_RESPONSE', 'CU28_INVALID_JOB', 'CU28_JOB_MISMATCH', 'CU28_REPORT_TERMINAL_FAILURE',
  'CU28_REPORT_POLL_TIMEOUT', 'CU28_INVALID_JOB_STATE', 'CU28_INVALID_VERIFIED_REPORT',
  'CU28_DELIVERY_UNCONFIRMED', 'CU28_INVALID_DELIVERY', 'CU28_DELIVERY_NOT_READY', 'CU28_INTERNAL_FAILURE'];
const candidate = String($json.error?.message || $json.error || '').split(' ')[0];
const failureCode = allowed.includes(candidate) ? candidate : 'CU28_TRANSPORT_OR_CREDENTIAL_FAILURE';
const result = {status: 'error', failureCode, executionId: $execution.id, observedAt: new Date().toISOString()};
$getWorkflowStaticData('global').lastResult = result;
return [{json: result}];`);
function workflow(id, name, nodes, edges) {
  nodes.push(node('Fail with safe code', 'stopAndError', {errorMessage: '={{ $json.failureCode }}'}, 1));
  edges.push(['Safe transport failure', 'Fail with safe code']);
  for (const n of nodes) {
    if (n.type === 'n8n-nodes-base.code' && n.name !== 'Safe transport failure') {
      n.onError = 'continueErrorOutput';
      edges.push([n.name, 'Safe transport failure', 1]);
    }
  }
  nodes.forEach((n, i) => { n.position = [(i % 5) * 260, Math.floor(i / 5) * 260]; });
  const connections = {};
  for (const [from, to, output = 0] of edges) {
    const main = (connections[from] ??= {main: []}).main;
    while (main.length <= output) main.push([]);
    main[output].push({node: to, type: 'main', index: 0});
  }
  return {id, name, nodes, connections, settings, active: false, pinData: {}};
}
function owner(id, name, cron, url) {
  return workflow(id, name, [trigger(cron), request('Owner selection', url, 'POST', '{}'),
    code('Sanitized result audit', ['httpBody'],
      `httpBody($json);
const result = {status: 'owner_accepted', observedAt: new Date().toISOString()};
const state = $getWorkflowStaticData('global');
state.lastResult = result;
return [{json: result}];`), safeFailure()], [
    ['Schedule', 'Owner selection'], ['Owner selection', 'Sanitized result audit'],
    ['Owner selection', 'Safe transport failure', 1],
  ]);
}
const delivery = request('Deliver same event', 'http://n8n:5678/webhook/cu28-execution-review', 'POST', '={{ JSON.stringify($json) }}', false);
delivery.parameters.options.response.response.neverError = false;
delivery.retryOnFail = true;
delivery.maxTries = 3;
delivery.waitBetweenTries = 5000;
delivery.parameters.sendHeaders = true;
delivery.parameters.headerParameters = {parameters: [{name: 'x-autonexus-secret', value: '={{ $env.CU28_WEBHOOK_SECRET }}'}]};
const weekly = workflow('cu28WeeklyReport', 'AutoNexus — CU28 weekly verified CU26 report', [
  trigger('0 0 9 * * 1'),
  code('Prepare period', ['previousWeek'], `return [{json: {period: previousWeek($json.timestamp || new Date().toISOString())}}];`),
  request('Acquire durable delivery', 'http://agent:3099/report/weekly/deliveries', 'POST',
    '={{ JSON.stringify({from: $json.period.from, to: $json.period.to}) }}'),
  code('Delivery acquired', ['httpBody', 'periodIds', 'acquiredDelivery'], `return [{json: acquiredDelivery($json)}];`),
  branch('Delivery already acknowledged', 'delivered'),
  code('Already acknowledged audit', [], `const result = {status: 'delivered', eventId: $json.eventId, operationId: $json.operationId,
jobId: $json.jobId, period: $json.period, observedAt: new Date().toISOString()};
$getWorkflowStaticData('global').lastResult = result;
return [{json: result}];`),
  branch('Durable report ready', 'ready'),
  branch('Have existing job', 'hasJob'),
  request('Start or recover same job', 'http://agent:3099/report/jobs', 'POST',
    '={{ JSON.stringify({from: $json.period.from, to: $json.period.to, operationId: $json.operationId}) }}'),
  code('Job accepted', ['httpBody', 'acceptedJob'], `const result = $json.resumeJobId ? {jobId: $json.resumeJobId} : acceptedJob($json);
return [{json: result}];`),
  code('Check poll budget', [], `if (Date.now() + 20000 >= $('Delivery acquired').first().json.deadline) throw new Error('CU28_REPORT_POLL_TIMEOUT');
return [{json: {jobId: $('Job accepted').first().json.jobId}}];`),
  request('Read same job', "={{ 'http://agent:3099/report/jobs/' + $('Job accepted').first().json.jobId }}", 'GET'),
  code('Evaluate job', ['httpBody', 'evaluateJob'], `const context = {...$('Delivery acquired').first().json, ...$('Job accepted').first().json};
return [{json: evaluateJob($json, context, Date.now())}];`),
  branch('Report ready', 'ready'),
  node('Wait 5 seconds', 'wait', {resume: 'timeInterval', amount: 5, unit: 'seconds'}, 1.1),
  request('Persist completed delivery', 'http://agent:3099/report/weekly/deliveries', 'POST',
    '={{ JSON.stringify({from: $("Delivery acquired").first().json.period.from, to: $("Delivery acquired").first().json.period.to}) }}'),
  code('Ready persisted', ['httpBody', 'periodIds', 'acquiredDelivery'], `const result = acquiredDelivery($json);
if (!result.ready || !result.jobId) throw new Error('CU28_DELIVERY_NOT_READY');
return [{json: result}];`),
  code('Verified event', ['periodIds', 'weeklyEvent'], `return [{json: weeklyEvent($json.report, $json.period, $json.jobId)}];`),
  delivery,
  code('Confirm channel receipt', ['httpBody', 'deliveryReceipt'], `const event = $('Verified event').first().json;
const receipt = deliveryReceipt($json, event.eventId);
return [{json: {...receipt, operationId: event.data.operationId}}];`),
  request('Acknowledge durable delivery', "={{ 'http://agent:3099/report/weekly/deliveries/' + $json.operationId + '/ack' }}", 'POST',
    '={{ JSON.stringify({eventId: $json.eventId, status: $json.status}) }}'),
  code('Sanitized result audit', ['httpBody'], `const acknowledged = httpBody($json);
const event = $('Verified event').first().json;
if (acknowledged.status !== 'delivered' || acknowledged.eventId !== event.eventId) throw new Error('CU28_DELIVERY_UNCONFIRMED');
const result = {eventId: event.eventId, status: 'delivered', operationId: event.data.operationId, jobId: event.data.jobId,
period: event.data.period, narrativePath: event.data.narrative.path, claims: event.data.claims.length, observedAt: new Date().toISOString()};
$getWorkflowStaticData('global').lastResult = result;
return [{json: result}];`), safeFailure(),
], [
  ['Schedule', 'Prepare period'], ['Prepare period', 'Acquire durable delivery'],
  ['Acquire durable delivery', 'Delivery acquired'], ['Acquire durable delivery', 'Safe transport failure', 1],
  ['Delivery acquired', 'Delivery already acknowledged'], ['Delivery already acknowledged', 'Already acknowledged audit'],
  ['Delivery already acknowledged', 'Durable report ready', 1], ['Durable report ready', 'Verified event'],
  ['Durable report ready', 'Have existing job', 1], ['Have existing job', 'Job accepted'],
  ['Have existing job', 'Start or recover same job', 1], ['Start or recover same job', 'Job accepted'],
  ['Start or recover same job', 'Safe transport failure', 1], ['Job accepted', 'Check poll budget'],
  ['Check poll budget', 'Read same job'], ['Read same job', 'Evaluate job'], ['Read same job', 'Safe transport failure', 1],
  ['Evaluate job', 'Report ready'], ['Report ready', 'Persist completed delivery'], ['Report ready', 'Wait 5 seconds', 1],
  ['Wait 5 seconds', 'Check poll budget'], ['Persist completed delivery', 'Ready persisted'],
  ['Persist completed delivery', 'Safe transport failure', 1], ['Ready persisted', 'Verified event'],
  ['Verified event', 'Deliver same event'], ['Deliver same event', 'Confirm channel receipt'],
  ['Deliver same event', 'Safe transport failure', 1], ['Confirm channel receipt', 'Acknowledge durable delivery'],
  ['Acknowledge durable delivery', 'Sanitized result audit'], ['Acknowledge durable delivery', 'Safe transport failure', 1],
]);
const exports = [
  ['appointments-reminders-scheduled.json', owner('cu28AppointmentReminders', 'AutoNexus — CU28 next-day appointment reminders', '0 0 9 * * *', 'http://operations:8081/automations/appointments/reminders')],
  ['quotes-pending-scheduled.json', owner('cu28PendingQuotes', 'AutoNexus — CU28 overdue pending quotes', '0 0 * * * *', 'http://finance:8000/automations/quotes/pending')],
  ['weekly-report-scheduled.json', weekly],
];
for (const [file, document] of exports) {
  const content = JSON.stringify(document, null, 2) + String.fromCharCode(10);
  if (check) {
    if (await readFile(new URL(file, root), 'utf8') !== content) throw new Error('Stale workflow: ' + file);
  } else await writeFile(new URL(file, root), content);
}
console.log(check ? 'Scheduled exports match their builder' : 'Built three scheduled workflows');
