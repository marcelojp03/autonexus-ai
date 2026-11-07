import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {previousWeek, periodIds, httpBody, acceptedJob, evaluateJob, weeklyEvent, deliveryReceipt} from './scheduled-functions.mjs';

const files = ['appointments-reminders-scheduled.json', 'quotes-pending-scheduled.json', 'weekly-report-scheduled.json'];
const workflows = await Promise.all(files.map(file => readFile(new URL('../../infra/n8n/workflows/' + file, import.meta.url), 'utf8').then(JSON.parse)));
const period = {from: '2026-10-26', to: '2026-11-01', timeZone: 'America/La_Paz'};
const jobId = '12345678-1234-4234-8234-123456789012';
const response = (body, statusCode = 200) => ({statusCode, body, headers: {authorization: 'never-persist-this'}});
const report = () => ({
  report: 'operations-narrative', period, generatedAt: '2026-11-02T13:01:00.000Z', promptVersion: 'test',
  figures: {totalWorks: 2}, claims: [{id: 'totalWorks', value: 2}], provenance: [{source: 'operations'}],
  references: [], limitations: [], financialData: {included: false, note: 'not requested'},
  narrative: {text: '2 trabajos', path: 'deterministic', verified: true, generative: false, model: null},
});
const byName = (workflow, name) => workflow.nodes.find(node => node.name === name);
const runCode = (workflow, name, json, state, previous = {}) => new Function('$json', '$getWorkflowStaticData', '$', '$execution',
  byName(workflow, name).parameters.jsCode)(json, () => state,
  key => ({first: () => ({json: previous[key]})}), {id: 'safe-execution-id'});

test('previous civil week respects Bolivia midnight, Monday, leap day and year boundaries', () => {
  assert.deepEqual(previousWeek('2026-11-02T13:00:00Z'), period);
  assert.deepEqual(previousWeek('2026-11-09T03:59:59Z'), period);
  assert.equal(previousWeek('2026-11-09T04:00:00Z').from, '2026-11-02');
  assert.equal(previousWeek('2024-03-04T13:00:00Z').to, '2024-03-03');
  assert.equal(previousWeek('2024-01-01T13:00:00Z').from, '2023-12-25');
});

test('period IDs are deterministic, distinct UUIDv8 values independent of execution', () => {
  const ids = periodIds(period);
  assert.deepEqual(ids, periodIds({...period}));
  for (const value of Object.values(ids)) assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(ids.operationId, ids.eventId);
  assert.notEqual(ids.eventId, periodIds(previousWeek('2026-11-09T13:00:00Z')).eventId);
  assert.throws(() => periodIds({...period, to: '2026-11-02'}), /CU28_INVALID_PERIOD/);
  assert.throws(() => periodIds({...period, from: '2026-02-30'}), /CU28_INVALID_PERIOD/);
});

test('HTTP authorization or transport errors never become an empty successful result', () => {
  for (const status of [401, 403]) assert.throws(() => httpBody(response({}, status)), /CU28_AUTHORIZATION_REQUIRED/);
  for (const status of [302, 400, 500, 502]) assert.throws(() => httpBody(response({}, status)), /CU28_HTTP_UNAVAILABLE/);
  assert.throws(() => httpBody(response(null)), /CU28_INVALID_RESPONSE/);
  assert.deepEqual(acceptedJob(response({jobId})), {jobId});
  assert.throws(() => acceptedJob(response({})), /CU28_INVALID_JOB/);
});

test('polling accepts only the same authorized job and is bounded without restarting it', () => {
  const context = {jobId, period, deadline: 600000};
  const job = {jobId, period, status: 'running'};
  assert.deepEqual(evaluateJob(response(job), context, 0), {ready: false, jobId});
  assert.throws(() => evaluateJob(response(job), context, 575000), /CU28_REPORT_POLL_TIMEOUT/);
  assert.throws(() => evaluateJob(response({...job, jobId: 'other'}), context, 0), /CU28_JOB_MISMATCH/);
  for (const status of ['failed', 'interrupted']) {
    assert.throws(() => evaluateJob(response({...job, status}), context, 0), /CU28_REPORT_TERMINAL_FAILURE/);
  }
  assert.throws(() => evaluateJob(response({...job, status: 'failed', failure: {code: 'AUTHORIZATION_EXPIRED'}}), context, 0), /CU28_AUTHORIZATION_REQUIRED/);
  assert.equal(evaluateJob(response({...job, status: 'succeeded', report: report()}), context, 0).ready, true);
});

test('weekly event is closed, stable and retains all document fields and honest narrative provenance', () => {
  const document = report();
  const event = weeklyEvent({...document, headers: {authorization: 'secret'}, arbitrary: 'drop'}, period, jobId);
  assert.equal(event.eventType, 'automation.weekly.report.generated.v1');
  assert.deepEqual(event.data.period, period);
  for (const key of Object.keys(document)) assert.deepEqual(event.data[key], document[key]);
  assert.equal(event.data.narrative.path, 'deterministic');
  assert.equal(event.data.narrative.generative, false);
  assert.equal(JSON.stringify(event).includes('secret'), false);
  assert.deepEqual(event, weeklyEvent(document, period, jobId));
  const llm = {...document, narrative: {...document.narrative, path: 'llm', generative: true, model: 'model'}};
  assert.equal(weeklyEvent(llm, period, jobId).data.narrative.path, 'llm');
  for (const bad of [{...document, period: {...period, to: '2026-11-02'}},
    {...document, claims: undefined}, {...document, narrative: {...document.narrative, generative: true}},
    {...document, narrative: {...document.narrative, verified: false}}]) {
    assert.throws(() => weeklyEvent(bad, period, jobId), /CU28_INVALID_VERIFIED_REPORT/);
  }
});

test('a successful HTTP webhook call alone is not a confirmed delivery', () => {
  const eventId = periodIds(period).eventId;
  for (const status of ['recorded', 'duplicate']) assert.equal(deliveryReceipt(response({status, eventId}), eventId).status, status);
  assert.throws(() => deliveryReceipt(response({status: 'recorded', eventId: 'other'}), eventId), /CU28_DELIVERY_UNCONFIRMED/);
});

test('exports use real schedule, OAuth2, bounded HTTP, disabled logs and connected safe errors', () => {
  const crons = ['0 0 9 * * *', '0 0 * * * *', '0 0 9 * * 1'];
  workflows.forEach((workflow, index) => {
    assert.equal(workflow.active, false);
    assert.equal(workflow.settings.timezone, 'America/La_Paz');
    assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
    assert.equal(workflow.settings.saveDataErrorExecution, 'none');
    assert.equal(workflow.settings.saveExecutionProgress, false);
    assert.equal(workflow.settings.executionTimeout, 600);
    assert.equal(byName(workflow, 'Schedule').parameters.rule.interval[0].expression, crons[index]);
    assert.deepEqual(workflow.pinData, {});
    for (const n of workflow.nodes) {
      if (n.type.endsWith('.code')) assert.doesNotThrow(() => new Function(n.parameters.jsCode));
      if (!n.type.endsWith('.httpRequest')) continue;
      assert.equal(n.parameters.options.timeout, 20000);
      assert.equal(n.parameters.options.redirect.redirect.followRedirects, false);
      assert.equal(n.onError, 'continueErrorOutput');
      assert.equal(workflow.connections[n.name].main[1][0].node, 'Safe transport failure');
      if (n.name !== 'Deliver same event') {
        assert.equal(n.parameters.genericAuthType, 'oAuth2Api');
        assert.equal(n.credentials.oAuth2Api.id, 'autonexusCu28Scheduler');
      }
    }
    for (const connection of Object.values(workflow.connections)) {
      for (const edge of connection.main.flat()) assert.ok(byName(workflow, edge.node));
    }
  });
});

test('owner selectors send no client clocks or business records', () => {
  const urls = ['http://operations:8081/automations/appointments/reminders', 'http://finance:8000/automations/quotes/pending'];
  workflows.slice(0, 2).forEach((workflow, index) => {
    const n = byName(workflow, 'Owner selection');
    assert.equal(n.parameters.url, urls[index]);
    assert.equal(n.parameters.method, 'POST');
    assert.equal(n.parameters.jsonBody, '{}');
    const state = {};
    const result = runCode(workflow, 'Sanitized result audit', response({token: 'do-not-keep'}), state);
    assert.equal(result[0].json.status, 'owner_accepted');
    assert.equal(JSON.stringify(state).includes('do-not-keep'), false);
  });
});

test('compiled failure audit returns only safe metadata before a native failure node', () => {
  for (const workflow of workflows) {
    const state = {};
    const result = runCode(workflow, 'Safe transport failure', {error: 'Bearer private-token'}, state);
    assert.equal(result[0].json.failureCode, 'CU28_TRANSPORT_OR_CREDENTIAL_FAILURE');
    assert.equal(state.lastResult.status, 'error');
    assert.equal(JSON.stringify(state).includes('private-token'), false);
    assert.equal(workflow.connections['Safe transport failure'].main[0][0].node, 'Fail with safe code');
    assert.equal(byName(workflow, 'Fail with safe code').type, 'n8n-nodes-base.stopAndError');
  }
  const state = {};
  assert.throws(() => runCode(workflows[0], 'Sanitized result audit', response({secret: 'private'}, 403), state), /CU28_AUTHORIZATION_REQUIRED/);
  runCode(workflows[0], 'Safe transport failure', {error: 'CU28_AUTHORIZATION_REQUIRED'}, state);
  assert.equal(state.lastResult.failureCode, 'CU28_AUTHORIZATION_REQUIRED');
});

test('weekly recovery uses the durable owner before selecting or sending a new period', () => {
  const workflow = workflows[2];
  const state = {};
  const candidate = runCode(workflow, 'Prepare period', {timestamp: '2026-12-07T13:00:00Z'}, state)[0].json;
  assert.notEqual(candidate.period.from, period.from);
  const durable = {period, ...periodIds(period), jobId, report: report(), status: 'pending'};
  const recovered = runCode(workflow, 'Delivery acquired', response(durable), state)[0].json;
  assert.deepEqual(recovered.period, period);
  assert.equal(recovered.hasJob, true);
  assert.equal(recovered.ready, true);
  assert.equal(recovered.delivered, false);
  assert.deepEqual(state, {}, 'workflow static data is not the recovery authority');
  const event = runCode(workflow, 'Verified event', recovered, state)[0].json;
  assert.equal(event.eventId, periodIds(period).eventId);
  assert.deepEqual(event.data.period, period);
  assert.equal(workflow.connections['Prepare period'].main[0][0].node, 'Acquire durable delivery');
  assert.equal(workflow.connections['Acquire durable delivery'].main[0][0].node, 'Delivery acquired');
  assert.equal(workflow.connections['Report ready'].main[0][0].node, 'Persist completed delivery');
  assert.equal(workflow.connections['Persist completed delivery'].main[0][0].node, 'Ready persisted');
  assert.equal(workflow.connections['Confirm channel receipt'].main[0][0].node, 'Acknowledge durable delivery');
  assert.equal(workflow.connections['Acknowledge durable delivery'].main[0][0].node, 'Sanitized result audit');
  const receipt = runCode(workflow, 'Confirm channel receipt', response({status: 'duplicate', eventId: event.eventId}), state, {'Verified event': event})[0].json;
  assert.equal(receipt.operationId, durable.operationId);
  assert.equal(receipt.status, 'duplicate');
  const audited = runCode(workflow, 'Sanitized result audit', response({...durable, status: 'delivered'}), state, {'Verified event': event})[0].json;
  assert.equal(audited.status, 'delivered');
  assert.equal(audited.jobId, jobId);
  const acknowledged = runCode(workflow, 'Delivery acquired', response({...durable, status: 'delivered'}), state)[0].json;
  assert.equal(acknowledged.delivered, true);
  assert.equal(workflow.connections['Delivery already acknowledged'].main[0][0].node, 'Already acknowledged audit');
  const delivery = byName(workflow, 'Deliver same event');
  assert.equal(delivery.retryOnFail, true);
  assert.equal(delivery.maxTries, 3);
  assert.equal(byName(workflow, 'Wait 5 seconds').parameters.amount, 5);
  assert.equal(workflow.connections['Wait 5 seconds'].main[0][0].node, 'Check poll budget');
});
