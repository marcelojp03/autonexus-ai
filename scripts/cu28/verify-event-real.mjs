/**
 * CU28 real end-to-end verification of one event-driven flow.
 *
 *   CU17 request-review (real operations REST + Keycloak identity)
 *     -> operations.cu28_outbox row inside the same transaction
 *     -> Outbox publisher in the operations service (real POST, x-autonexus-secret)
 *     -> n8n authenticated webhook (dedupe by eventId across executions)
 *     -> local test channel (scripts/cu28/channel.mjs, JSONL)
 *
 * The checks are: one record for the first eventId, a forced redelivery keeps exactly one record,
 * an idempotent replay creates no second event, a stopped channel leaves the event pending and a
 * restarted channel delivers it exactly once. Nothing is sent outside this machine and no secret is
 * printed: the shared secret is only ever checked for presence and length.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = process.env.CU28_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4286';
const operationsUrl = process.env.CU28_OPERATIONS_URL ?? 'http://127.0.0.1:8081';
const n8nContainer = process.env.CU28_N8N_CONTAINER ?? 'cu16-proof-n8n-1';
const postgresContainer = process.env.CU28_POSTGRES_CONTAINER ?? 'cu16-proof-postgres-1';
const operationsContainer = process.env.CU28_OPERATIONS_CONTAINER ?? 'cu16-proof-operations-1';
const workflowId = 'cu28ExecutionReview';
const workoutFile = resolve(workspace, process.env.CU28_WORKFLOW_FILE ?? 'infra/n8n/workflows/execution-review-event.json');
const accountsFile = resolve(workspace, process.env.CU17_ACCOUNTS_FILE ?? 'output/stack/cu17-demo/accounts.json');
const channelPort = Number(process.env.CU28_CHANNEL_PORT ?? '5680');
const channelDir = resolve(workspace, 'output/cu28');
const channelFile = resolve(channelDir, 'channel.jsonl');
const reportFile = resolve(channelDir, 'event-verification.json');
const date = new Date().toISOString().slice(0, 10);
const from = process.env.CU28_FROM ?? `${date.slice(0, 4)}-01-01`;
const to = process.env.CU28_TO ?? `${Number(date.slice(0, 4)) + 1}-12-31`;

const report = {
  startedAt: new Date().toISOString(),
  components: { origin, operationsUrl, n8nContainer, postgresContainer, workflowId, channelPort, channelFile },
  commands: [],
  checks: [],
  counts: {},
  blockers: [],
  pass: false,
  limitations: [
    'Local test channel only: n8n POSTs to the loopback sink, no external message is produced.',
    'The n8n workflow is committed inactive; this script publishes it for the run and unpublishes it at the end.',
  ],
};

const record = (name, status, detail) => report.checks.push({ name, status, ...(detail === undefined ? {} : { detail }) });
const check = (name, ok, detail) => {
  record(name, ok ? 'PASS' : 'FAIL', detail);
  assert.ok(ok, name);
};
const run = (command, args, options = {}) => {
  const result = { command: [command, ...args].join(' '), exitCode: null };
  try {
    const output = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
    result.exitCode = 0;
    result.output = (output ?? '').trim();
  } catch (failure) {
    result.exitCode = failure.status ?? 1;
    result.output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim();
  }
  report.commands.push(result);
  return result;
};
const finish = (code) => {
  report.finishedAt = new Date().toISOString();
  report.pass = report.checks.every((entry) => entry.status === 'PASS') && report.blockers.length === 0 && report.checks.length > 0;
  mkdirSync(channelDir, { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, blockers: report.blockers, report: reportFile }, null, 2));
  process.exit(code ?? (report.pass ? 0 : 1));
};
const block = (message) => {
  report.blockers.push(message);
  finish(2);
};

const containerEnv = (container, name) => {
  const result = run('docker', ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', container]);
  if (result.exitCode !== 0) return { present: false, reason: 'container unavailable' };
  const line = result.output.split('\n').find((entry) => entry.startsWith(name + '='));
  result.output = '[redacted]';
  if (!line) return { present: false, reason: 'variable not set' };
  return { present: line.slice(name.length + 1).length > 0, length: line.slice(name.length + 1).length };
};

// --- operations owner database, read through the owner role inside its own container --------
const query = (sql) => {
  const local = resolve(channelDir, 'query.sql');
  mkdirSync(channelDir, { recursive: true });
  writeFileSync(local, sql + '\n', 'utf8');
  run('docker', ['cp', local, `${postgresContainer}:/tmp/cu28-query.sql`]);
  const result = run('docker', ['exec', postgresContainer, 'sh', '-c',
    '. /run/config/service.env; PGPASSWORD="$OPERATIONS_PASSWORD" psql -h 127.0.0.1 -U "$OPERATIONS_USER" -d "$OPERATIONS_DB" -tA -F"|" --no-psqlrc -f /tmp/cu28-query.sql']);
  if (result.exitCode !== 0) block('operations database query failed: ' + result.output);
  return result.output.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => line.split('|'));
};
const outbox = (eventId) => {
  const rows = query(`SELECT event_id,event_type,aggregate_id,aggregate_version,attempts,
      delivered_at IS NOT NULL AS delivered, last_error_code, payload::text, occurred_at
    FROM operations.cu28_outbox WHERE event_id='${eventId}'`);
  if (!rows.length) return null;
  const [event, type, aggregate, version, attempts, delivered, errorCode, payload, occurredAt] = rows[0];
  return { eventId: event, eventType: type, aggregateId: aggregate, aggregateVersion: Number(version),
    attempts: Number(attempts), delivered: delivered === 't', lastErrorCode: errorCode || null, payload, occurredAt };
};

// --- local channel ---------------------------------------------------------------------------
let sink = null;
const sinkLog = [];
const startSink = async () => {
  sink = spawn(process.execPath, [resolve(workspace, 'scripts/cu28/channel.mjs')], {
    cwd: workspace, env: { ...process.env, CU28_CHANNEL_PORT: String(channelPort), CU28_CHANNEL_FILE: 'output/cu28/channel.jsonl' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  sink.stdout.on('data', (chunk) => sinkLog.push(chunk.toString()));
  sink.stderr.on('data', (chunk) => sinkLog.push(chunk.toString()));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${channelPort}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* not listening yet */ }
    await new Promise((done) => setTimeout(done, 200));
  }
  block('the local channel did not start on port ' + channelPort);
};
const stopSink = async () => {
  if (!sink) return;
  const closing = sink;
  sink = null;
  closing.kill('SIGTERM');
  await new Promise((done) => closing.once('exit', done));
};
const channel = async () => (await (await fetch(`http://127.0.0.1:${channelPort}/channel`, { signal: AbortSignal.timeout(2000) })).json());
const channelRecords = () => (existsSync(channelFile)
  ? readFileSync(channelFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []);
const recordsFor = (eventId) => channelRecords().filter((record) => record.eventId === eventId);
const waitFor = async (description, predicate, millis = 30000) => {
  const deadline = Date.now() + millis;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((done) => setTimeout(done, 500));
  }
  record(description, 'FAIL', `not observed within ${millis} ms`);
  return false;
};

// --- CU17 API through the operations owner ---------------------------------------------------
const { authorize } = await import('../../services/employees/scripts/local-pkce.mjs');
const accounts = JSON.parse(readFileSync(accountsFile, 'utf8')).accounts;
const token = async (key) => (await authorize({ ...accounts[key], enabled: true }, false,
  { issuer: origin + '/identity/realms/autonexus', redirect: origin + '/auth/callback' })).access_token;
const call = async (bearer, method, path, body) => {
  const response = await fetch(operationsUrl + path, {
    method,
    headers: { Authorization: 'Bearer ' + bearer, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: response.status, body: parsed };
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const checksum = createHash('sha256').update(png).digest('base64');

try {
  // 1. Preflight: the delivery secret must exist on both sides. Its value is never printed.
  const publisherSecret = containerEnv(operationsContainer, 'CU28_WEBHOOK_SECRET');
  const webhookUrl = containerEnv(operationsContainer, 'CU28_WEBHOOK_URL');
  const receiverSecret = containerEnv(n8nContainer, 'CU28_WEBHOOK_SECRET');
  if (!publisherSecret.present) block('CU28_WEBHOOK_SECRET is missing or empty in ' + operationsContainer + ': the Outbox publisher be would start without a secret, so the flow is not provisioned');
  if (!webhookUrl.present) block('CU28_WEBHOOK_URL is missing or empty in ' + operationsContainer + ': the Outbox publisher is disabled');
  if (!receiverSecret.present) block('CU28_WEBHOOK_SECRET is missing or empty in ' + n8nContainer + ': the imported workflow would reject every delivery');
  check('the publisher and the webhook receive the same shared-secret length', publisherSecret.length === receiverSecret.length, { publisher: publisherSecret.length, receiver: receiverSecret.length });
  record('webhook target configured', 'PASS');

  // 2. Publish the workflow for the run (it is committed inactive) and load it.
  const publish = run('docker', ['exec', n8nContainer, 'n8n', 'publish:workflow', `--id=${workflowId}`]);
  check('the event workflow could be published for the run', publish.exitCode === 0, publish.output.slice(-200));
  run('docker', ['restart', n8nContainer]);
  const healthy = await waitFor('n8n answers its health endpoint', async () => {
    try { return (await fetch('http://127.0.0.1:5678/healthz', { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
  }, 90000);
  check('n8n restarted with the published workflow', healthy);

  // The webhook is authenticated: without the header it must refuse.
  const anonymous = await fetch(`http://127.0.0.1:5678/webhook/cu28-execution-review`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eventId: randomUUID(), eventType: 'operations.execution.review.requested.v1' }),
    signal: AbortSignal.timeout(10000),
  }).catch((failure) => ({ status: 0, error: String(failure) }));
  check('a delivery without the shared secret is refused', anonymous.status === 401, { status: anonymous.status });

  // 3. A clean channel file for this run; the previous one is archived, never deleted.
  if (existsSync(channelFile)) {
    mkdirSync(resolve(channelDir, 'archive'), { recursive: true });
    renameSync(channelFile, resolve(channelDir, 'archive', `channel-${Date.now()}.jsonl`));
  }
  await startSink();
  check('the local channel is running', (await channel()).records === 0);

  // 4. A real CU17 review request.
  const mechanic = await token(process.env.CU28_MECHANIC ?? 'mechanicA');
  const chief = await token('chief');
  const agenda = await call(mechanic, 'GET', `/agenda/me?from=${from}&to=${to}&limit=50`);
  check('the mechanic reads their own agenda', agenda.status === 200, { status: agenda.status });
  const items = agenda.body?.items ?? [];
  let work = items.find((item) => item.executionStatus === 'in_progress') ?? items.find((item) => item.executionStatus === 'not_started');
  if (!work) block('no reviewable work for the mechanic between ' + from + ' and ' + to + ': seed a confirmed assignment first');
  if (work.executionStatus === 'pending_verification') {
    const current = await call(mechanic, 'GET', `/executions/review-self/${work.assignmentId}`);
    const returned = await call(chief, 'POST', `/executions/${work.assignmentId}/return`,
      { operationId: randomUUID(), expectedVersion: current.body.execution.version, reason: 'Repetición controlada de la verificación CU28' });
    check('the head can return a work left awaiting verification', returned.status === 200, { status: returned.status });
    work = { ...work, executionStatus: 'in_progress' };
  }

  let view = (await call(mechanic, 'GET', `/executions/review-self/${work.assignmentId}`));
  if (view.status === 404 || !view.body?.execution) {
    const started = await call(mechanic, 'POST', `/executions/${work.assignmentId}/start`, { operationId: randomUUID() });
    check('the mechanic starts the execution', started.status === 201, { status: started.status });
    view = await call(mechanic, 'GET', `/executions/review-self/${work.assignmentId}`);
  }
  let execution = view.body.execution;
  if (!(view.body.availableEvidence >= 1)) {
    if (!(execution.advances?.length)) {
      const advance = await call(mechanic, 'POST', `/executions/${work.assignmentId}/advances`,
        { operationId: randomUUID(), expectedVersion: execution.version, description: 'Avance para la verificación CU28', minutesWorked: 5 });
      check('the mechanic records an advance', advance.status === 201, { status: advance.status });
      execution = advance.body.execution;
    }
    const advanceId = execution.advances.at(-1).id;
    const requested = await call(mechanic, 'POST', `/executions/${work.assignmentId}/advances/${advanceId}/evidences`,
      { operationId: randomUUID(), fileName: 'cu28.png', contentType: 'image/png', sizeBytes: png.length, checksumSha256: checksum });
    check('the owner issues a private evidence upload', requested.status === 201, { status: requested.status });
    const uploaded = await fetch(requested.body.upload.url, { method: 'PUT', headers: JSON.parse(requested.body.upload.headersJson), body: png, signal: AbortSignal.timeout(20000) });
    check('the synthetic evidence reaches private storage', uploaded.ok, { status: uploaded.status });
    const confirmed = await call(mechanic, 'POST', `/executions/${work.assignmentId}/evidences/${requested.body.evidence.id}/confirm`,
      { operationId: randomUUID(), expectedVersion: requested.body.evidence.version });
    check('the evidence becomes available', confirmed.status === 200 && confirmed.body?.evidence?.state === 'available', { status: confirmed.status });
    view = await call(mechanic, 'GET', `/executions/review-self/${work.assignmentId}`);
    execution = view.body.execution;
  }
  for (const item of view.body.checklist.filter((entry) => entry.state === 'pending')) {
    const marked = await call(mechanic, 'POST', `/executions/${work.assignmentId}/checklist/${item.id}/complete`,
      { operationId: randomUUID(), expectedVersion: item.version });
    check('mandatory activity completed: ' + item.description.slice(0, 40), marked.status === 200, { status: marked.status });
    view = await call(mechanic, 'GET', `/executions/review-self/${work.assignmentId}`);
  }
  execution = view.body.execution;
  check('the work is ready for a review request', execution.status === 'in_progress' && view.body.mandatoryPending === 0, {
    status: execution.status, mandatoryPending: view.body.mandatoryPending });

  const requestOne = { operationId: randomUUID(), expectedVersion: execution.version };
  const first = await call(mechanic, 'POST', `/executions/${work.assignmentId}/request-review`, requestOne);
  check('CU17 accepts the real review request', first.status === 200 && first.body?.execution?.status === 'pending_verification', { status: first.status });
  const firstVersion = first.body.execution.version;
  const rows = query(`SELECT event_id FROM operations.cu28_outbox WHERE aggregate_id='${work.assignmentId ? work.assignmentId : ''}' AND aggregate_version=${firstVersion}`.replace("aggregate_id='" + work.assignmentId + "'", `aggregate_id=(SELECT id FROM operations.work_executions WHERE assignment_id='${work.assignmentId}')`));
  check('the Outbox row is written with the review request', rows.length === 1, { rows: rows.length });
  const eventOne = rows[0][0];
  report.counts.firstEvent = { eventId: eventOne, aggregateVersion: firstVersion };

  // 5. Exactly one record for that eventId.
  const deliveredOnce = await waitFor('the publisher delivers the first event', async () => recordsFor(eventOne).length === 1, 40000);
  check('the channel holds exactly one record for the first event', deliveredOnce && recordsFor(eventOne).length === 1, { records: recordsFor(eventOne).length });
  const deliveredRow = outbox(eventOne);
  check('the Outbox row is marked delivered only after the 2xx', deliveredRow?.delivered === true && deliveredRow.attempts >= 1, { attempts: deliveredRow?.attempts });

  // 6. Redelivery of the same eventId keeps a single record (n8n dedupe + channel dedupe).
  const before = await channel();
  const reset = query(`UPDATE operations.cu28_outbox SET delivered_at=NULL,next_attempt_at=now(),attempts=0,last_error_code=NULL WHERE event_id='${eventOne}'`);
  check('an injected redelivery was prepared', reset !== null);
  const redelivered = await waitFor('the publisher redelivers the same event', async () => outbox(eventOne)?.delivered === true, 40000);
  const after = await channel();
  check('the redelivery is dropped before the channel grows', redelivered && recordsFor(eventOne).length === 1, {
    before: before.records, after: after.records, duplicatesDropped: after.duplicatesDropped });

  // 7. An idempotent replay of the CU17 command creates no second event.
  const replay = await call(mechanic, 'POST', `/executions/${work.assignmentId}/request-review`, requestOne);
  const replayRows = query(`SELECT count(*) FROM operations.cu28_outbox WHERE event_id='${eventOne}'`);
  check('the CU17 replay is answered without a second event', replay.status === 200 && Number(replayRows[0][0]) === 1, {
    status: replay.status, rows: Number(replayRows[0][0]) });

  // 8. Failure and recovery: the channel is down, so the event must stay pending and then be
  //    delivered exactly once when the channel returns.
  await stopSink();
  const current = await call(mechanic, 'GET', `/executions/review-self/${work.assignmentId}`);
  const returned = await call(chief, 'POST', `/executions/${work.assignmentId}/return`,
    { operationId: randomUUID(), expectedVersion: current.body.execution.version, reason: 'Devolución para probar la recuperación del canal CU28' });
  check('the head returns the work to in_progress', returned.status === 200 && returned.body?.execution?.status === 'in_progress', { status: returned.status });
  const second = await call(mechanic, 'POST', `/executions/${work.assignmentId}/request-review`,
    { operationId: randomUUID(), expectedVersion: returned.body.execution.version });
  check('a new review request produces a new event', second.status === 200, { status: second.status });
  const secondVersion = second.body.execution.version;
  const secondRows = query(`SELECT event_id FROM operations.cu28_outbox WHERE aggregate_id=(SELECT id FROM operations.work_executions WHERE assignment_id='${work.assignmentId}') AND aggregate_version=${secondVersion}`);
  check('the second Outbox row exists', secondRows.length === 1, { rows: secondRows.length });
  const eventTwo = secondRows[0][0];
  report.counts.secondEvent = { eventId: eventTwo, aggregateVersion: secondVersion };

  const pending = await waitFor('the publisher attempts the second event while the channel is down', async () => {
    const row = outbox(eventTwo);
    return row?.attempts >= 1 && row.delivered === false && Boolean(row.lastErrorCode);
  }, 30000);
  const pendingRow = outbox(eventTwo);
  check('the failed delivery leaves the event pending with a sanitized code', pending && pendingRow.delivered === false, {
    attempts: pendingRow?.attempts, code: pendingRow?.lastErrorCode });
  check('the confirmed repair was not rolled back by the delivery failure',
    (await call(mechanic, 'GET', `/executions/review-self/${work.assignmentId}`)).body?.execution?.status === 'pending_verification');

  await startSink();
  const recovered = await waitFor('the publisher delivers the second event after the channel returns', async () => recordsFor(eventTwo).length >= 1, 60000);
  check('the recovered event is recorded exactly once', recovered && recordsFor(eventTwo).length === 1, { records: recordsFor(eventTwo).length });
  const finalCounts = await channel();
  check('the channel deduplicated nothing on the delivered path', finalCounts.duplicatesDropped === 0, { duplicatesDropped: finalCounts.duplicatesDropped });

  // 9. The envelope stays closed: identifiers and states only, no business text.
  const delivered = recordsFor(eventOne)[0].event;
  const forbidden = [work.orderNumber, work.employee?.fullName, work.vehicle?.plate].filter((value) => typeof value === 'string' && value.length > 2);
  const leaked = forbidden.filter((value) => JSON.stringify(delivered).includes(value));
  check('the delivered envelope carries no order number, name or plate', leaked.length === 0, { checked: forbidden.length, leaked: leaked.length });
  check('the envelope keeps the closed CU28 shape', delivered.eventType === 'operations.execution.review.requested.v1'
    && delivered.producer === 'operations' && delivered.schemaVersion === 1 && delivered.aggregateType === 'execution', {
    eventType: delivered.eventType, aggregateVersion: delivered.aggregateVersion });

  report.counts.channel = finalCounts;
  report.counts.recordsForFirstEvent = recordsFor(eventOne).length;
  report.counts.recordsForSecondEvent = recordsFor(eventTwo).length;
  report.counts.outbox = { first: outbox(eventOne), second: outbox(eventTwo) };
  await stopSink();
} catch (failure) {
  report.error = String(failure?.message ?? failure);
  record('verification aborted', 'FAIL', report.error);
  await stopSink();
} finally {
  report.sinkLog = sinkLog.join('').split('\n').filter(Boolean).slice(-40);
  const unpublish = run('docker', ['exec', n8nContainer, 'n8n', 'unpublish:workflow', `--id=${workflowId}`]);
  record('the workflow returns to its inactive committed state', unpublish.exitCode === 0 ? 'PASS' : 'FAIL', unpublish.output.slice(-120));
  run('docker', ['restart', n8nContainer]);
}

finish();
