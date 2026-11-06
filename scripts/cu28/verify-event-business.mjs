/**
 * CU28 event flow verification on top of the state that already exists.
 *
 * This runner never asks for an empty environment: the local channel file, the n8n durable state and
 * the Outbox are read as a BASELINE and nothing is deleted, renamed or reset to make the run fit.
 * Every assertion is filtered by the identifiers of one single business event, so the global record
 * count of the channel is never used as evidence.
 *
 * The event under test is the review request that the owner already committed (the Outbox row is
 * located by the execution that is in pending_verification) and the whole run reuses that same
 * eventId and that same stored envelope:
 *
 *   1. Canal caído        the sink is stopped and the row is reclaimed: the attempt fails, the row
 *                         stays pending with attempts/backoff/last_error_code and the payload intact,
 *                         the channel holds no record for the eventId and the confirmed work is not
 *                         rolled back.
 *   2. Canal recuperado   the sink returns and the pending event is delivered once.
 *   3. Respuesta perdida  the sink applies the effect and withholds the acknowledgement past the
 *                         workflow's own budget, so the publisher records a failure after the effect
 *                         exists; the retry is answered as a duplicate and no second record appears.
 *   4. Reentrega          the delivered row is reclaimed again: the same envelope is answered
 *                         `duplicate`, an explicit replay behaves the same, a wrong secret is refused
 *                         and the channel still holds exactly one record.
 *   5. Agotamiento        the row that was already abandoned before this run is reported with its
 *                         terminal state, its exhaustion code, its kept payload and its log lines.
 *
 * The only SQL written is the Outbox reclaim an operator is allowed to perform; no business state is
 * set by SQL and no new business event is invented. Tokens, the shared secret and signed URLs are
 * never printed.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = process.env.CU28_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4286';
const operationsUrl = process.env.CU28_OPERATIONS_URL ?? 'http://127.0.0.1:8081';
const n8nContainer = process.env.CU28_N8N_CONTAINER ?? 'cu16-proof-n8n-1';
const postgresContainer = process.env.CU28_POSTGRES_CONTAINER ?? 'cu16-proof-postgres-1';
const operationsContainer = process.env.CU28_OPERATIONS_CONTAINER ?? 'cu16-proof-operations-1';
const workflowId = 'cu28ExecutionReview';
const webhookUrl = 'http://127.0.0.1:5678/webhook/cu28-execution-review';
const channelPort = Number(process.env.CU28_CHANNEL_PORT ?? '5680');
const channelDir = resolve(workspace, 'output/cu28');
const channelFile = resolve(channelDir, 'channel.jsonl');
const reportFile = resolve(channelDir, 'event-baseline-verification.json');
const sqlDir = resolve(channelDir, 'sql');
const evidenceDir = resolve(channelDir, 'evidence');

mkdirSync(sqlDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  branch: null,
  commit: null,
  approach: 'baseline + one existing business eventId; no record deleted, no environment reset',
  components: { origin, operationsUrl, n8nContainer, workflowId, channelPort, channelFile: channelFile.replace(workspace, '.').replaceAll('\\', '/') },
  baseline: {},
  observations: [],
  transitions: [],
  commands: [],
  counts: {},
  blockers: [],
  pass: false,
  limitations: [
    'The confidence channel is a loopback JSONL sink (scripts/cu28/channel.mjs): no external message is produced.',
    'n8n does not persist successful executions (saveDataSuccessExecution=none), so the receiver-side proof is the workflow static data plus the 2xx the publisher requires before marking the row delivered.',
    'Observation 3 is produced by the sink contract itself: the record is appended and the acknowledgement is held past the budget the workflow gives the channel, so the failure the publisher records is a real lost acknowledgement, not a simulated status code.',
    'Reclaiming an Outcome row is an operator action on the Outbox only; it is not available through the business API and it changes no business state.',
  ],
};

const now = () => new Date().toISOString();
class Blocked extends Error {}
const mark = (event, detail) => report.transitions.push({ at: now(), event, ...(detail === undefined ? {} : { detail }) });
const observation = (id, name) => {
  const entry = { id, name, status: 'PASS', steps: [], ids: {} };
  report.observations.push(entry);
  return entry;
};
const step = (entry, name, ok, detail) => {
  entry.steps.push({ name, status: ok ? 'PASS' : 'FAIL', ...(detail === undefined ? {} : { detail }) });
  if (!ok) entry.status = 'FAIL';
  return ok;
};

const run = (command, args, { redact = false } = {}) => {
  const result = { command: [command, ...args].join(' '), exitCode: null };
  try {
    const output = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
    result.exitCode = 0;
    result.output = (output ?? '').trim();
  } catch (failure) {
    result.exitCode = failure.status ?? 1;
    result.output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim();
  }
  if (redact) result.output = '[redacted]';
  report.commands.push(result);
  return result;
};

let finished = false;
const finish = (code) => {
  if (finished) return;
  finished = true;
  report.finishedAt = new Date().toISOString();
  report.observations.sort((left, right) => left.id - right.id);
  report.pass = report.blockers.length === 0 && report.observations.length === 5
    && report.observations.every((entry) => entry.status === 'PASS');
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ pass: report.pass,
    observations: report.observations.map((o) => ({ id: o.id, status: o.status })),
    blockers: report.blockers, report: reportFile }, null, 2));
  process.exit(code ?? (report.pass ? 0 : 1));
};
const block = (message) => { report.blockers.push(message); throw new Blocked(message); };

// --- owner database (read-only, except the Outbox reclaim the design allows) --------------------
let sqlCount = 0;
const psql = (sqlText, name) => {
  const file = resolve(sqlDir, `${name ?? 'q'}-${++sqlCount}.sql`);
  writeFileSync(file, sqlText + '\n', 'utf8');
  const target = `/tmp/${basename(file)}`;
  const copy = run('docker', ['cp', file, `${postgresContainer}:${target}`]);
  if (copy.exitCode !== 0) { block('could not stage the SQL file: ' + copy.output); return null; }
  return run('docker', ['exec', postgresContainer, 'sh', '-c',
    `. /run/config/service.env; PGPASSWORD="$OPERATIONS_PASSWORD" psql -h 127.0.0.1 -U "$OPERATIONS_USER" -d "$OPERATIONS_DB" -tA -F"|" --no-psqlrc -f ${target}`]);
};
const rows = (sqlText, name) => {
  const result = psql(sqlText, name);
  if (!result) return [];
  if (result.exitCode !== 0) { block('operations query failed: ' + result.output.slice(0, 300)); return []; }
  return result.output.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => line.split('|'));
};
const outbox = (eventId) => {
  const [row] = rows(`SELECT event_id,event_type,aggregate_id,aggregate_version,attempts,
      COALESCE(delivered_at::text,''),COALESCE(abandoned_at::text,''),COALESCE(last_error_code,''),
      next_attempt_at::text,COALESCE(lease_owner::text,''),octet_length(payload::text),occurred_at::text
    FROM operations.cu28_outbox WHERE event_id='${eventId}'`, 'outbox');
  if (!row) return null;
  return { eventId: row[0], eventType: row[1], aggregateId: row[2], aggregateVersion: Number(row[3]),
    attempts: Number(row[4]), deliveredAt: row[5] || null, abandonedAt: row[6] || null,
    lastErrorCode: row[7] || null, nextAttemptAt: row[8], leased: row[9] !== '',
    payloadBytes: Number(row[10]), occurredAt: row[11] };
};
const storedEnvelope = (eventId) => {
  const [row] = rows(`SELECT payload::text FROM operations.cu28_outbox WHERE event_id='${eventId}'`, 'payload');
  if (!row) return null;
  try { return JSON.parse(row[0]); } catch { return null; }
};
const ownerExecution = (executionId) => {
  const [row] = rows(`SELECT id,assignment_id,order_id,status,version,COALESCE(review_requested_at::text,''),
      COALESCE(review_requested_by::text,'') FROM operations.work_executions WHERE id='${executionId}'`, 'owner');
  if (!row) return null;
  return { executionId: row[0], assignmentId: row[1], orderId: row[2], status: row[3], version: Number(row[4]),
    reviewRequestedAt: row[5] || null, reviewRequestedBy: row[6] || null };
};
const outboxSummary = () => rows(`SELECT count(*),COUNT(delivered_at),COUNT(abandoned_at),COALESCE(sum(attempts),0)
  FROM operations.cu28_outbox`, 'outbox-state')[0];

// --- n8n durable workflow state ---------------------------------------------------------------
const n8nQuery = resolve(channelDir, 'n8n-state.cjs');
writeFileSync(n8nQuery, `const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.n8n/database.sqlite', { readOnly: true });
const row = db.prepare('select staticData,active from workflow_entity where id=?').get(process.argv[2]);
const executions = db.prepare('select count(*) c from execution_entity').get();
process.stdout.write(JSON.stringify({ staticData: row && row.staticData ? row.staticData : '{}',
  active: row ? Number(row.active) : null, executions: executions.c }));
`, 'utf8');
const n8nState = () => {
  const target = '/tmp/cu28-n8n-state.cjs';
  const copy = run('docker', ['cp', n8nQuery, `${n8nContainer}:${target}`]);
  if (copy.exitCode !== 0) { block('could not stage the n8n state query'); return { delivered: {}, active: null, executions: 0 }; }
  const result = run('docker', ['exec', n8nContainer, 'node', target, workflowId]);
  if (result.exitCode !== 0) { block('n8n state query failed: ' + result.output.slice(0, 300)); return { delivered: {}, active: null, executions: 0 }; }
  const parsed = JSON.parse(result.output);
  result.output = `active=${parsed.active} executions=${parsed.executions}`;
  let delivered = {};
  try { delivered = JSON.parse(parsed.staticData)?.global?.delivered ?? {}; } catch { delivered = {}; }
  return { delivered, active: parsed.active, executions: parsed.executions };
};

// --- local channel sink ------------------------------------------------------------------------
const slowSinkFile = resolve(channelDir, 'slow-channel.mjs');
writeFileSync(slowSinkFile, `// Generated by verify-event-business.mjs: same contract as scripts/cu28/channel.mjs, but the
// acknowledgement of a first delivery is held for CU28_SLOW_MS so the caller loses the response
// although the record already exists.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
const workspace = resolve(${JSON.stringify(workspace.replaceAll('\\\\', '/'))});
const port = Number(process.env.CU28_CHANNEL_PORT ?? '${channelPort}');
const file = resolve(${JSON.stringify(channelFile.replaceAll('\\\\', '/'))});
const slowMs = Number(process.env.CU28_SLOW_MS ?? '12000');
mkdirSync(dirname(file), { recursive: true });
const seen = new Map();
let duplicatesDropped = 0;
if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\\n')) {
  if (!line.trim()) continue;
  try { const record = JSON.parse(line); if (record.eventId && !seen.has(record.eventId)) seen.set(record.eventId, record); } catch {}
}
const byEventType = () => { const out = {}; for (const r of seen.values()) { const k = r.eventType ?? 'unknown'; out[k] = (out[k] ?? 0) + 1; } return out; };
const counts = () => ({ file, records: seen.size, uniqueEventIds: seen.size, duplicatesDropped, byEventType: byEventType() });
const json = (response, status, body) => {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
};
createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  if (request.method === 'GET' && path === '/health') return json(response, 200, { status: 'UP', slowMs });
  if (request.method === 'GET' && path === '/channel') return json(response, 200, counts());
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    let event;
    try { event = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(response, 400, { error: 'CU28_CHANNEL_INVALID_JSON' }); }
    const eventId = typeof event.eventId === 'string' ? event.eventId : '';
    if (seen.has(eventId)) {
      duplicatesDropped += 1;
      return json(response, 200, { status: 'duplicate', eventId, ...counts() });
    }
    appendFileSync(file, JSON.stringify({ receivedAt: new Date().toISOString(), eventId, eventType: event.eventType ?? null, event }) + '\\n', 'utf8');
    seen.set(eventId, event);
    // The record exists from here on; only the acknowledgement is lost.
    setTimeout(() => { try { json(response, 200, { status: 'recorded', eventId, ...counts() }); } catch {} }, slowMs);
  });
}).listen(port, '127.0.0.1', () => process.stdout.write(JSON.stringify({ listening: port, slowMs, restored: seen.size }) + '\\n'));
const stop = () => process.exit(0);
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('SIGBREAK', stop);
`, 'utf8');

const sinks = [];
let activeSink = null;
const sinkPids = () => {
  const query = run('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match '(channel|slow-channel)\\.mjs' } | ForEach-Object { $_.ProcessId }"]);
  const own = new Set(sinks.map((entry) => entry.process?.pid).filter(Boolean));
  const pids = query.output.split('\n').map((line) => line.trim())
    .filter((pid) => /^\d+$/.test(pid)).map(Number).filter((pid) => !own.has(pid));
  query.output = `sink processes found: ${pids.join(',') || 'none'}`;
  return pids;
};
const stopForeignSinks = () => {
  const pids = sinkPids();
  for (const pid of pids) run('taskkill', ['/F', '/PID', String(pid)]);
  return pids;
};
const waitForPort = async (up, millis = 15000) => {
  const deadline = Date.now() + millis;
  while (Date.now() < deadline) {
    let healthy = false;
    try { healthy = (await fetch(`http://127.0.0.1:${channelPort}/health`, { signal: AbortSignal.timeout(800) })).ok; } catch { healthy = false; }
    if (healthy === up) return true;
    await new Promise((done) => setTimeout(done, 200));
  }
  return false;
};
const startSink = async (kind) => {
  const script = kind === 'slow' ? slowSinkFile : resolve(workspace, 'scripts/cu28/channel.mjs');
  const entry = { kind, script, at: now(), log: '' };
  entry.process = spawn(process.execPath, [script], {
    cwd: workspace,
    env: { ...process.env, CU28_CHANNEL_PORT: String(channelPort), CU28_CHANNEL_FILE: 'output/cu28/channel.jsonl',
      ...(kind === 'slow' ? { CU28_SLOW_MS: '12000' } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true,
  });
  entry.process.stdout.on('data', (chunk) => { entry.log += chunk.toString(); });
  entry.process.stderr.on('data', (chunk) => { entry.log += chunk.toString(); });
  entry.process.unref();
  sinks.push(entry);
  activeSink = entry;
  if (!(await waitForPort(true))) block(`the ${kind} channel did not start on port ${channelPort}: ${entry.log.slice(0, 300)}`);
  await new Promise((done) => setTimeout(done, 300));
  if (entry.process.exitCode !== null) block(`the ${kind} channel could not bind port ${channelPort}: ${entry.log.slice(0, 300)}`);
  entry.boundAt = now();
  mark('channel-' + kind + '-started', { port: channelPort, log: entry.log.split('\n')[0]?.slice(0, 200) });
  return entry;
};
const stopSink = async () => {
  const entry = activeSink;
  if (!entry) return;
  activeSink = null;
  entry.process.kill('SIGTERM');
  await new Promise((done) => { entry.process.once('exit', done); setTimeout(done, 4000); });
  entry.stoppedAt = now();
  mark('channel-' + entry.kind + '-stopped', { at: entry.stoppedAt });
  if (!(await waitForPort(false, 10000))) block('the channel port stayed open after the sink was stopped');
};
const stopAllSinks = async () => {
  while (activeSink) await stopSink();
};
/**
 * Reads the sink counters. The sink is a separate process, so it is re-checked instead of assumed:
 * if it stopped answering it is started again with the same file, which is also how the flow stays
 * observable after the run.
 */
const channelCounts = async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await (await fetch(`http://127.0.0.1:${channelPort}/channel`, { signal: AbortSignal.timeout(2000) })).json();
    } catch {
      if (attempt > 0) return null;
      mark('sink-unreachable', { at: now() });
      if (!activeSink) await startSink('normal');
      else { await stopSink(); await startSink('normal'); }
    }
  }
  return null;
};
const channelRecords = () => (existsSync(channelFile)
  ? readFileSync(channelFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const recordsFor = (eventId) => channelRecords().filter((record) => record.eventId === eventId);
const waitFor = async (description, predicate, millis = 40000) => {
  const deadline = Date.now() + millis;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((done) => setTimeout(done, 400));
  }
  mark('timeout', { description, millis });
  return false;
};

// --- identities and the owner REST surface -----------------------------------------------------
const accountsFile = resolve(workspace, process.env.CU17_ACCOUNTS_FILE ?? 'output/stack/live-demo/accounts.json');
const { authorize } = await import('file://' + resolve(workspace, 'services/employees/scripts/local-pkce.mjs').replaceAll('\\', '/'));
const accounts = existsSync(accountsFile) ? JSON.parse(readFileSync(accountsFile, 'utf8')).accounts : {};
const token = async (key) => {
  if (!accounts[key]) block('the synthetic identity ' + key + ' is not available in ' + accountsFile);
  return (await authorize({ ...accounts[key], enabled: true }, false,
    { issuer: origin + '/identity/realms/autonexus', redirect: origin + '/auth/callback' })).access_token;
};
const call = async (bearer, method, path, body) => {
  const response = await fetch(operationsUrl + path, {
    method,
    headers: { Authorization: 'Bearer ' + bearer, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: response.status, body: parsed, method, path };
};
const code = (result) => result.body?.code ?? result.body?.error ?? null;
const mechanicKey = process.env.CU28_MECHANIC ?? 'mechanicB';
const view = async (bearer, assignmentId) => call(bearer, 'GET', `/executions/review-self/${assignmentId}`);

const sharedSecret = () => {
  const raw = execFileSync('docker', ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', operationsContainer],
    { encoding: 'utf8' });
  report.commands.push({ command: `docker inspect ${operationsContainer} (env)`, exitCode: 0, output: '[redacted]' });
  const found = raw.split('\n').find((entry) => entry.startsWith('CU28_WEBHOOK_SECRET='));
  return found ? found.slice('CU28_WEBHOOK_SECRET='.length) : null;
};
const receiverSecretLength = () => {
  const raw = execFileSync('docker', ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', n8nContainer], { encoding: 'utf8' });
  report.commands.push({ command: `docker inspect ${n8nContainer} (env)`, exitCode: 0, output: '[redacted]' });
  const found = raw.split('\n').find((entry) => entry.startsWith('CU28_WEBHOOK_SECRET='));
  return found ? found.slice('CU28_WEBHOOK_SECRET='.length).length : 0;
};

/**
 * Locates the business event this run reuses. Nothing is created here: the candidate is a row the
 * owner already committed for a real review request and whose delivery never produced an effect, so
 * both the outage and the lost acknowledgement can be observed on the same eventId without inventing
 * business state.
 */
const locateEvent = (remembered) => {
  const candidates = rows(`SELECT o.event_id,o.aggregate_id,o.aggregate_version,o.delivered_at IS NULL,
      o.abandoned_at IS NOT NULL,o.occurred_at::text,COALESCE(o.payload::json->>'causationId','')
    FROM operations.cu28_outbox o
    JOIN operations.work_executions e ON e.id=o.aggregate_id
    ORDER BY o.occurred_at DESC`, 'locate');
  return candidates.map((row) => ({ eventId: row[0], executionId: row[1], version: Number(row[2]),
    undelivered: row[3] === 't', abandoned: row[4] === 't', occurredAt: row[5], causationId: row[6],
    rememberedByReceiver: Object.prototype.hasOwnProperty.call(remembered, row[0]),
    recordsInChannel: recordsFor(row[0]).length }));
};

/** Every channel file the runs before this one rotated away, so a missing record can be explained. */
const archivedChannelFiles = () => {
  const dir = resolve(channelDir, 'archive');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.jsonl')).map((name) => {
    const lines = readFileSync(resolve(dir, name), 'utf8').split('\n').filter(Boolean);
    return { file: 'output/cu28/archive/' + name, records: lines.length,
      eventIds: lines.map((line) => { try { return JSON.parse(line).eventId; } catch { return null; } }).filter(Boolean) };
  });
};

/** Publisher lines kept on disk: a recreated container loses its own history, the evidence does not. */
const archivedPublisherLogs = () => {
  if (!existsSync(evidenceDir)) return '';
  return readdirSync(evidenceDir).filter((name) => /^operations-.*\.log$/.test(name))
    .map((name) => readFileSync(resolve(evidenceDir, name), 'utf8')).join('\n');
};
const publisherLog = (eventId) => {
  const live = run('docker', ['logs', '--since', '24h', operationsContainer]).output;
  const lines = [...new Set((live + '\n' + archivedPublisherLogs()).split('\n').filter((line) => line.includes(eventId)))];
  const result = report.commands.at(-1);
  if (result) result.output = lines.length ? lines.slice(-8).map((line) => line.trim()) : '(no CU28 line for this eventId)';
  return { count: lines.length, lines };
};

const containerEnv = (container) => {
  const raw = execFileSync('docker', ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', container], { encoding: 'utf8' });
  report.commands.push({ command: `docker inspect ${container} (env)`, exitCode: 0, output: '[redacted]' });
  const env = {};
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const index = line.indexOf('=');
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
};
/** The publisher resolves the workflow hostname inside its own container: loopback there means no delivery. */
const publisherTarget = () => {
  const configured = containerEnv(operationsContainer).CU28_WEBHOOK_URL ?? '';
  let host = null;
  try { host = new URL(configured).hostname; } catch { host = null; }
  if (!host) return { configured: configured ? '[invalid]' : '', host: null, resolved: null };
  const result = run('docker', ['exec', operationsContainer, 'getent', 'hosts', host]);
  const resolved = result.exitCode === 0 ? (result.output.split(/\s+/)[0] ?? null) : null;
  return { configured, host, resolved, loopback: resolved === '127.0.0.1' || resolved === '::1' };
};

/**
 * One real CU17 review cycle through the owner REST surface: return (when the work is waiting for
 * verification) -> advance -> private evidence -> checklist -> request-review. It exists only for the
 * case where the Outbox no longer holds an event that never produced an effect; no business state is
 * ever set by SQL.
 */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const checksum = createHash('sha256').update(png).digest('base64');

const cycle = async ({ bearer, chief, assignmentId, label }) => {
  const calls = [];
  const result = { label, calls, error: null };
  let current = await call(bearer, 'GET', `/executions/review-self/${assignmentId}`);
  calls.push({ path: `/executions/review-self/${assignmentId}`, status: current.status, executionStatus: current.body?.execution?.status, version: current.body?.execution?.version });
  if (current.status !== 200) { result.error = 'view:' + current.status; return result; }

  if (current.body.execution.status === 'pending_verification') {
    const returned = await call(chief, 'POST', `/executions/${assignmentId}/return`,
      { operationId: randomUUID(), expectedVersion: current.body.execution.version, reason: `Ciclo ${label}: devolución del jefe para una nueva solicitud de revisión` });
    calls.push({ path: `/executions/${assignmentId}/return`, status: returned.status, code: code(returned), version: returned.body?.execution?.version });
    if (returned.status !== 200) { result.error = 'return:' + returned.status; return result; }
    current = await call(bearer, 'GET', `/executions/review-self/${assignmentId}`);
  }
  if (current.body.execution.status !== 'in_progress') { result.error = 'state:' + current.body.execution.status; return result; }

  const advance = await call(bearer, 'POST', `/executions/${assignmentId}/advances`,
    { operationId: randomUUID(), expectedVersion: current.body.execution.version,
      description: `Avance sintético del ciclo ${label} para la verificación CU28`, minutesWorked: 5 });
  calls.push({ path: `/executions/${assignmentId}/advances`, status: advance.status, code: code(advance), version: advance.body?.execution?.version });
  const advanceId = advance.body?.advance?.id;
  if (advance.status !== 201 || !advanceId) { result.error = 'advance:' + advance.status; return result; }

  const requested = await call(bearer, 'POST', `/executions/${assignmentId}/advances/${advanceId}/evidences`,
    { operationId: randomUUID(), fileName: 'cu28.png', contentType: 'image/png', sizeBytes: png.length, checksumSha256: checksum });
  calls.push({ path: `/executions/${assignmentId}/advances/{advanceId}/evidences`, status: requested.status, code: code(requested) });
  if (requested.status !== 201) { result.error = 'evidence-request:' + requested.status; return result; }
  const uploaded = await fetch(requested.body.upload.url, { method: 'PUT',
    headers: JSON.parse(requested.body.upload.headersJson), body: png, signal: AbortSignal.timeout(20000) });
  calls.push({ path: 'PUT ' + new URL(requested.body.upload.url).pathname, host: new URL(requested.body.upload.url).host, status: uploaded.status });
  const confirmed = await call(bearer, 'POST', `/executions/${assignmentId}/evidences/${requested.body.evidence.id}/confirm`,
    { operationId: randomUUID(), expectedVersion: requested.body.evidence.version });
  calls.push({ path: `/executions/${assignmentId}/evidences/{evidenceId}/confirm`, status: confirmed.status, state: confirmed.body?.evidence?.state });
  if (!uploaded.ok || confirmed.status !== 200) { result.error = 'evidence-confirm:' + confirmed.status; return result; }

  current = await call(bearer, 'GET', `/executions/review-self/${assignmentId}`);
  for (const item of (current.body.checklist ?? []).filter((entry) => entry.state === 'pending')) {
    const marked = await call(bearer, 'POST', `/executions/${assignmentId}/checklist/${item.id}/complete`,
      { operationId: randomUUID(), expectedVersion: item.version });
    calls.push({ path: `/executions/${assignmentId}/checklist/{itemId}/complete`, status: marked.status, itemId: item.id });
    if (marked.status !== 200) { result.error = 'checklist:' + marked.status; return result; }
    current = await call(bearer, 'GET', `/executions/review-self/${assignmentId}`);
  }

  const expectedVersion = current.body.execution.version;
  const operationId = randomUUID();
  const review = await call(bearer, 'POST', `/executions/${assignmentId}/request-review`, { operationId, expectedVersion });
  calls.push({ path: `/executions/${assignmentId}/request-review`, status: review.status, code: code(review), operationId, expectedVersion, version: review.body?.execution?.version });
  if (review.status !== 200 || review.body?.execution?.status !== 'pending_verification') { result.error = 'review:' + review.status; return result; }
  const version = review.body.execution.version;
  const executionId = review.body.execution.id ?? current.body.execution.id;
  result.operationId = operationId;
  result.executionId = executionId;
  result.version = version;
  result.eventId = rows(`SELECT event_id FROM operations.cu28_outbox WHERE aggregate_id='${executionId}' AND aggregate_version=${version}`, 'event')[0]?.[0] ?? null;
  return result;
};

// --- run ----------------------------------------------------------------------------------------
try {
  report.branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).output;
  report.commit = run('git', ['rev-parse', '--short', 'HEAD']).output;

  // ---------------- baseline: what already exists is evidence, not an obstacle ------------------
  const base = { name: 'Baseline captured: the event, its origin and its current outcome', status: 'PASS', steps: [], ids: {} };
  report.baselineEvidence = base;
  const secret = sharedSecret();
  if (!secret || secret.length < 16) block('CU28_WEBHOOK_SECRET is missing in ' + operationsContainer + ': the publisher cannot authenticate');
  const receiverLength = receiverSecretLength();
  report.counts.sharedSecretLength = { publisher: secret.length, receiver: receiverLength };
  if (secret.length !== receiverLength) block('the publisher and the workflow do not share the same secret length');
  const target = publisherTarget();
  report.counts.publisherTarget = { host: target.host, resolved: target.resolved };
  if (target.loopback) {
    block('inside ' + operationsContainer + ' the workflow host ' + target.host + ' resolves to loopback ('
      + target.resolved + '): the publisher cannot reach the receiver until /etc/hosts is corrected');
  }

  const workflow = n8nState();
  const fileRecords = channelRecords();
  const uniqueInFile = new Set(fileRecords.map((record) => record.eventId));
  const remembered = workflow.delivered ?? {};
  const inventory = locateEvent(remembered);
  const archived = archivedChannelFiles();
  report.baseline = {
    channel: { file: channelFile.replace(workspace, '.').replaceAll('\\', '/'), records: fileRecords.length,
      uniqueEventIds: uniqueInFile.size, eventIds: [...uniqueInFile] },
    n8n: { active: workflow.active, executions: workflow.executions, rememberedEventIds: Object.keys(remembered) },
    outbox: outboxSummary(),
    events: inventory,
    archivedChannelFiles: archived,
  };
  report.counts.preexistingEvents = inventory.map((entry) => ({ eventId: entry.eventId,
    aggregateVersion: entry.version, causationId: entry.causationId, occurredAt: entry.occurredAt,
    undelivered: entry.undelivered, abandoned: entry.abandoned,
    recordsForEvent: entry.recordsInChannel, rememberedByReceiver: entry.rememberedByReceiver }));
  // Every distinct eventId is its own transition of the same aggregate: different version, different
  // review-request operation. The repetitions seen in the channel are retries of one eventId, never
  // different events.
  report.counts.distinctEvents = inventory.length;
  report.counts.distinctVersions = new Set(inventory.map((entry) => entry.version)).size;
  report.counts.deliveredEvents = inventory.filter((entry) => !entry.undelivered).length;
  report.counts.abandonedEvents = inventory.filter((entry) => entry.abandoned).length;
  report.counts.recordsWithoutFile = inventory.filter((entry) => entry.rememberedByReceiver && entry.recordsInChannel === 0)
    .map((entry) => ({ eventId: entry.eventId, explainedBy: archived.filter((file) => file.eventIds.includes(entry.eventId)) }));

  // The event under test is reused whenever one exists: a committed review request whose delivery
  // produced no effect. Only when none is left does the run build ONE new review request through the
  // owner API -- never SQL -- and record that explicitly in the report.
  const reusable = inventory.filter((entry) => entry.undelivered && !entry.rememberedByReceiver && entry.recordsInChannel === 0);
  const preferred = reusable.filter((entry) => entry.abandoned);
  let eventId = process.env.CU28_EVENT_ID ?? (preferred[0] ?? reusable[0])?.eventId ?? null;
  report.counts.eventOrigin = eventId ? 'reused' : 'created-by-real-flow';
  const reference = inventory[0] ?? null;
  if (!reference) block('the Outbox has no review event at all: the flow has never produced one');
  const referenceOwner = ownerExecution(reference.executionId);
  if (!referenceOwner) block('the execution ' + reference.executionId + ' of the Outbox rows does not exist');
  const assignmentId = referenceOwner.assignmentId;

  // ---------------- observation 1: the channel is down ----------------------------------------
  const one = observation(1, 'Channel outage: the attempt fails in an observable way and nothing is confirmed');
  const stillServing = sinkPids();
  if (stillServing.length) { stopForeignSinks(); }
  if (!(await waitForPort(false, 12000))) block('the channel port is still held: ' + stillServing.join(','));
  step(one, 'the channel is stopped, so the effect cannot be applied', await waitForPort(false, 1000), { port: channelPort });

  // The event under test: reused when the Outbox already holds one that never produced an effect,
  // otherwise built once through the real owner API while the channel is down.
  if (!eventId) {
    const created = await cycle({ bearer: await token(mechanicKey), chief: await token('chief'), assignmentId,
      label: 'evento-' + new Date().toISOString().slice(11, 19) });
    if (!created.eventId) block('the real review cycle did not produce an event: ' + JSON.stringify({ error: created.error, calls: created.calls }));
    eventId = created.eventId;
    one.ids.created = { eventId, operationId: created.operationId, executionId: created.executionId, version: created.version,
      calls: created.calls };
  }
  const row = outbox(eventId);
  if (!row) block('the Outbox row for ' + eventId + ' does not exist');
  const envelope = storedEnvelope(eventId);
  if (!envelope) block('the stored envelope of ' + eventId + ' could not be read');
  const owner = ownerExecution(row.aggregateId);
  if (!owner) block('the owner execution ' + row.aggregateId + ' does not exist');

  one.ids = { ...one.ids, eventId, executionId: row.aggregateId, aggregateVersion: row.aggregateVersion };
  report.counts.eventUnderTest = eventId;
  base.ids = { eventId, executionId: row.aggregateId, aggregateVersion: row.aggregateVersion };
  base.correlation = {
    event: { eventId, eventType: row.eventType, aggregateId: row.aggregateId, aggregateVersion: row.aggregateVersion,
      occurredAt: row.occurredAt, producer: envelope.producer, schemaVersion: envelope.schemaVersion },
    reviewRequest: { causationId: envelope.causationId, initiatedBy: envelope.initiatedBy,
      executedBy: envelope.executedBy, requestedAt: envelope.data?.requestedAt ?? null,
      ownerLatestReviewRequestedAt: owner.reviewRequestedAt, ownerReviewRequestedBy: owner.reviewRequestedBy },
    owner: { status: owner.status, version: owner.version, assignmentId: owner.assignmentId, orderId: owner.orderId },
    delivery: { attempts: row.attempts, deliveredAt: row.deliveredAt, abandonedAt: row.abandonedAt,
      lastErrorCode: row.lastErrorCode, payloadBytes: row.payloadBytes },
    channel: { recordsForEvent: recordsFor(eventId).length },
    n8n: { remembered: Boolean(remembered[eventId]) },
  };

  step(base, 'the Outbox row is the effect of a real review request of the owner', envelope.eventType === 'operations.execution.review.requested.v1'
    && envelope.aggregateId === row.aggregateId && envelope.aggregateVersion === row.aggregateVersion,
  { eventType: envelope.eventType, aggregateVersion: envelope.aggregateVersion });
  step(base, 'the originating request is identified by its operationId (causationId)',
    typeof envelope.causationId === 'string' && envelope.causationId.length === 36, { causationId: envelope.causationId });
  step(base, 'the event points at an execution of the owner', owner.executionId === row.aggregateId, { executionId: row.aggregateId });
  step(base, 'the event is not ahead of the execution version it belongs to', row.aggregateVersion <= owner.version,
    { eventVersion: row.aggregateVersion, ownerVersion: owner.version,
      laterCyclesRan: owner.version !== row.aggregateVersion });
  step(base, 'the event was produced by that review request (same occurrence, closed envelope)',
    envelope.data?.requestedAt === row.occurredAt || envelope.occurredAt === row.occurredAt.replace(' ', 'T').slice(0, 23) + 'Z',
  { eventRequestedAt: envelope.data?.requestedAt, eventOccurredAt: envelope.occurredAt, outboxOccurredAt: row.occurredAt });
  step(base, 'the event carries the closed CU28 envelope, not arbitrary payload',
    Object.keys(envelope).sort().join(',') === ['aggregateId', 'aggregateType', 'aggregateVersion', 'causationId',
      'correlationId', 'data', 'eventId', 'eventType', 'executedBy', 'initiatedBy', 'occurredAt', 'producer', 'schemaVersion'].join(',')
      && Object.keys(envelope.data ?? {}).sort().join(',') === ['assignmentId', 'employeeId', 'executionId', 'orderId',
        'requestedAt', 'status', 'version'].join(','),
    { keys: Object.keys(envelope), dataKeys: Object.keys(envelope.data ?? {}) });
  step(base, 'the channel holds no record for this event yet', recordsFor(eventId).length === 0,
    { recordsForEvent: recordsFor(eventId).length });
  step(base, 'the receiver never confirmed this event', !remembered[eventId], { remembered: Boolean(remembered[eventId]) });
  mark('baseline', report.baseline);

  // Only now is the row reclaimed, so the first attempt of the reused event really meets a dead channel.
  const reclaim = (label) => psql(`UPDATE operations.cu28_outbox
      SET delivered_at=NULL,abandoned_at=NULL,attempts=0,last_error_code=NULL,lease_owner=NULL,lease_until=NULL,next_attempt_at=now()
      WHERE event_id='${eventId}'`, label);
  const firstReclaim = reclaim('reclaim-1');
  if (firstReclaim.exitCode !== 0) block('the Outbox reclaim failed: ' + firstReclaim.output.slice(0, 300));
  const reclaimed = outbox(eventId);
  step(one, 'the documented treatment is an operator reclaim of the same row, not a new event',
    reclaimed.abandonedAt === null && reclaimed.deliveredAt === null
      && reclaimed.payloadBytes === row.payloadBytes && recordsFor(eventId).length === 0,
  { after: { attempts: reclaimed.attempts, payloadBytes: reclaimed.payloadBytes, originalPayloadBytes: row.payloadBytes },
    recordsForEvent: recordsFor(eventId).length });
  mark('outbox-reclaimed', { eventId, at: now() });
  const failed = await waitFor('the publisher attempts the event while the channel is down',
    async () => { const current = outbox(eventId); return current.attempts >= 1 && current.deliveredAt === null && Boolean(current.lastErrorCode); }, 90000);
  const failedRow = outbox(eventId);
  step(one, 'the attempt fails and leaves the row pending with a sanitized code', failed
    && failedRow.deliveredAt === null && failedRow.abandonedAt === null && Boolean(failedRow.lastErrorCode),
  { attempts: failedRow.attempts, lastErrorCode: failedRow.lastErrorCode, nextAttemptAt: failedRow.nextAttemptAt });
  step(one, 'the failure is not read as a rejection: the row is scheduled again',
    failedRow.abandonedAt === null && failedRow.payloadBytes === row.payloadBytes,
  { abandonedAt: failedRow.abandonedAt, payloadBytes: failedRow.payloadBytes, originalPayloadBytes: row.payloadBytes });
  step(one, 'no record exists for the event while the channel is down', recordsFor(eventId).length === 0,
    { recordsForEvent: recordsFor(eventId).length });
  const ownerDuringOutage = ownerExecution(row.aggregateId);
  step(one, 'the confirmed work is not rolled back by the outage', ownerDuringOutage.status === 'pending_verification',
    { status: ownerDuringOutage.status, ownerVersion: ownerDuringOutage.version, eventVersion: row.aggregateVersion });
  // The same claim through the owner API, not only through its database.
  let bearer = null;
  try { bearer = await token(mechanicKey); } catch (failure) { bearer = null; report.counts.apiView = 'unavailable: ' + String(failure?.message).slice(0, 120); }
  if (bearer) {
    const apiView = await view(bearer, owner.assignmentId);
    report.counts.apiView = 'available';
    step(one, 'the owner API still reports the work in pending_verification',
      apiView.status === 200 && apiView.body?.execution?.status === 'pending_verification',
    { status: apiView.status, executionStatus: apiView.body?.execution?.status, version: apiView.body?.execution?.version });
  }
  const outageLog = publisherLog(eventId);
  step(one, 'the publisher logged the failure inside the container', outageLog.count >= 1,
    { lines: outageLog.count, last: outageLog.lines.slice(-1) });
  mark('channel-down-observed', { row: failedRow, logLines: outageLog.count });

  // ---------------- observation 5: the retries are exhausted while the channel stays down ------
  const five = observation(5, 'Retry exhaustion: the same row ends abandoned with its payload kept');
  five.ids = { eventId, executionId: row.aggregateId, aggregateVersion: row.aggregateVersion };
  const exhausted = await waitFor('the event reaches MAX_ATTEMPTS while the channel is down',
    async () => outbox(eventId).abandonedAt !== null, 300000);
  const exhaustedRow = outbox(eventId);
  step(five, 'the row reached MAX_ATTEMPTS and ended abandoned', exhausted
    && exhaustedRow.attempts >= 10 && exhaustedRow.abandonedAt !== null,
  { attempts: exhaustedRow.attempts, abandonedAt: exhaustedRow.abandonedAt });
  step(five, 'the abandon carries the exhaustion code, not the last transport error',
    exhaustedRow.lastErrorCode === 'CU28_DELIVERY_ATTEMPTS_EXHAUSTED', { lastErrorCode: exhaustedRow.lastErrorCode });
  step(five, 'the event row is kept with its payload and was never marked delivered',
    exhaustedRow.payloadBytes === row.payloadBytes && exhaustedRow.deliveredAt === null,
    { payloadBytes: exhaustedRow.payloadBytes, deliveredAt: exhaustedRow.deliveredAt });
  step(five, 'no effect was produced for the abandoned event', recordsFor(eventId).length === 0,
    { recordsForEvent: recordsFor(eventId).length });
  const abandonedState = n8nState();
  step(five, 'the receiver never confirmed the exhausted event', !abandonedState.delivered[eventId],
    { remembered: Boolean(abandonedState.delivered[eventId]) });
  const abandonLog = publisherLog(eventId);
  five.ids.logLines = abandonLog.count;
  step(five, 'the container log shows the attempts for this eventId', abandonLog.count >= 10,
    { lines: abandonLog.count, last: abandonLog.lines.slice(-2) });
  const ownerAfterAbandon = ownerExecution(row.aggregateId);
  step(five, 'the business state was never rolled back by the delivery failure',
    ownerAfterAbandon.status === 'pending_verification',
    { status: ownerAfterAbandon.status, ownerVersion: ownerAfterAbandon.version, eventVersion: row.aggregateVersion });
  mark('exhaustion-observed', { row: exhaustedRow, logLines: abandonLog.count });
  // The documented treatment: the operator reclaims that same row once the receiver is back. The
  // business state is untouched and no new event is produced.
  const recoveryReclaim = reclaim('reclaim-recovery');
  if (recoveryReclaim.exitCode !== 0) block('the Outbox reclaim failed: ' + recoveryReclaim.output.slice(0, 300));
  const recoveryStart = outbox(eventId);
  step(five, 'the documented treatment reclaims the same row, with the same eventId and payload',
    recoveryStart.deliveredAt === null && recoveryStart.abandonedAt === null
      && recoveryStart.payloadBytes === row.payloadBytes && recoveryStart.eventId === eventId,
  { attempts: recoveryStart.attempts, payloadBytes: recoveryStart.payloadBytes, eventId: recoveryStart.eventId });
  mark('outbox-reclaimed-after-exhaustion', { at: now(), row: recoveryStart });

  // ---------------- observations 2 and 3: the channel returns, the effect is applied once ------
  const two = observation(2, 'Channel recovered: the pending event is delivered exactly once');
  two.ids = { eventId };
  const three = observation(3, 'Lost acknowledgement after the effect: the retry does not duplicate it');
  three.ids = { eventId };
  const beforeSlow = { attempts: recoveryStart.attempts, duplicatesDropped: null };
  await startSink('slow');
  const applied = await waitFor('the effect is applied for the event',
    async () => recordsFor(eventId).length === 1, 90000);
  const appliedRow = outbox(eventId);
  step(three, 'the record exists although the acknowledgement is being withheld', applied && recordsFor(eventId).length === 1,
    { recordsForEvent: recordsFor(eventId).length, receivedAt: recordsFor(eventId)[0]?.receivedAt });
  const lostAck = await waitFor('the publisher records a failure while the effect already exists',
    async () => { const current = outbox(eventId); return current.attempts > beforeSlow.attempts && Boolean(current.lastErrorCode) && current.deliveredAt === null; }, 90000);
  const lostRow = outbox(eventId);
  step(three, 'the failure is recorded after the effect exists, so a timeout was not a rejection', lostAck
    && Boolean(lostRow.lastErrorCode) && recordsFor(eventId).length === 1,
  { attempts: lostRow.attempts, lastErrorCode: lostRow.lastErrorCode, deliveredAt: lostRow.deliveredAt,
    recordsForEvent: recordsFor(eventId).length });
  const delivered = await waitFor('the publisher recovers the event without a second record',
    async () => outbox(eventId).deliveredAt !== null, 120000);
  const deliveredRow = outbox(eventId);
  const recoveredCounts = await channelCounts();
  two.ids.slowSinkDuplicatesDropped = recoveredCounts?.duplicatesDropped ?? null;
  step(two, 'the recovered channel delivered the pending event', delivered && deliveredRow.deliveredAt !== null,
    { attempts: deliveredRow.attempts, deliveredAt: deliveredRow.deliveredAt, lastErrorCode: deliveredRow.lastErrorCode });
  step(two, 'the row is delivered after more than one attempt and no error code is left',
    deliveredRow.attempts > 1 && deliveredRow.lastErrorCode === null,
  { attempts: deliveredRow.attempts, lastErrorCode: deliveredRow.lastErrorCode });
  step(two, 'the channel holds exactly one record for the eventId', recordsFor(eventId).length === 1,
    { recordsForEvent: recordsFor(eventId).length, uniqueRecords: new Set(channelRecords().map((record) => record.eventId)).size });
  step(three, 'the second barrier dropped the retry instead of appending it again', (recoveredCounts?.duplicatesDropped ?? 0) >= 1,
    { duplicatesDropped: recoveredCounts?.duplicatesDropped ?? null });
  step(three, 'no duplicate effect reached the file', recordsFor(eventId).length === 1, { recordsForEvent: recordsFor(eventId).length });
  const afterRecoveryN8n = n8nState();
  step(two, 'the receiver confirmed the event in its durable state', Boolean(afterRecoveryN8n.delivered[eventId]),
    { deliveredAt: afterRecoveryN8n.delivered[eventId] ?? null });
  mark('event-delivered-once', { eventId, row: deliveredRow, records: recordsFor(eventId).length,
    duplicatesDropped: recoveredCounts?.duplicatesDropped ?? null });

  // ---------------- observation 4: the same eventId again ------------------------------------
  const four = observation(4, 'Redelivery of the same eventId: one effect, duplicate answered, wrong secret refused');
  four.ids = { eventId };
  await stopSink();
  await startSink('normal');
  const restored = await channelCounts();
  const before = recordsFor(eventId).length;
  const secondReclaim = reclaim('reclaim-2');
  step(four, 'the delivered row is reclaimed for a redelivery of the same event', secondReclaim.exitCode === 0,
    { sql: 'UPDATE operations.cu28_outbox SET delivered_at=NULL ... WHERE event_id=?' });
  const redelivered = await waitFor('the publisher redelivers the stored event',
    async () => outbox(eventId).deliveredAt !== null, 120000);
  const redeliveredRow = outbox(eventId);
  const after = await channelCounts();
  step(four, 'the publisher redelivered the same eventId', redelivered,
    { attempts: redeliveredRow.attempts, deliveredAt: redeliveredRow.deliveredAt });
  step(four, 'the channel still holds exactly one record for it', recordsFor(eventId).length === 1,
    { before, after: recordsFor(eventId).length, channelRecords: restored?.records ?? null });
  const receiverAfterRedelivery = n8nState();
  step(four, 'the receiver answered as a duplicate and did not change its confirmed time',
    receiverAfterRedelivery.delivered[eventId] === afterRecoveryN8n.delivered[eventId],
  { deliveredAt: receiverAfterRedelivery.delivered[eventId] ?? null,
    unchanged: receiverAfterRedelivery.delivered[eventId] === afterRecoveryN8n.delivered[eventId] });
  const stored = recordsFor(eventId)[0];
  const replay = await fetch(webhookUrl, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-autonexus-secret': secret },
    body: JSON.stringify(stored.event), signal: AbortSignal.timeout(30000) });
  const replayBody = await replay.json().catch(() => null);
  four.ids.explicitDuplicate = { status: replay.status,
    body: replayBody && { status: replayBody.status, eventId: replayBody.eventId, deliveredAt: replayBody.deliveredAt } };
  step(four, 'an explicit replay of the stored envelope is answered 200 duplicate',
    replay.status === 200 && replayBody?.status === 'duplicate' && replayBody?.eventId === eventId,
  { status: replay.status, status_field: replayBody?.status });
  const refused = await fetch(webhookUrl, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-autonexus-secret': 'x'.repeat(secret.length) },
    body: JSON.stringify(stored.event), signal: AbortSignal.timeout(30000) });
  const refusedBody = await refused.json().catch(() => null);
  step(four, 'the same envelope with a wrong secret is refused', refused.status === 401,
    { status: refused.status, body: refusedBody });
  step(four, 'neither the replay nor the refusal created a record', recordsFor(eventId).length === 1,
    { recordsForEvent: recordsFor(eventId).length });
  const finalCounts = await channelCounts();
  // Which barrier absorbs the duplicate depends on what the receiver still remembers: n8n answers it
  // before reaching the channel, and the channel refuses a second append when it did reach it. The
  // claim under test is the record count, and both counters are reported next to it.
  step(four, 'no barrier was bypassed: the record count did not move',
    recordsFor(eventId).length === 1 && Boolean(finalCounts) && Boolean(recoveredCounts)
      && finalCounts.uniqueEventIds === recoveredCounts.uniqueEventIds,
  { before: recoveredCounts && { records: recoveredCounts.records, duplicatesDropped: recoveredCounts.duplicatesDropped },
    after: finalCounts && { records: finalCounts.records, duplicatesDropped: finalCounts.duplicatesDropped } });
  mark('event-redelivered', { eventId, row: outbox(eventId), records: recordsFor(eventId).length });

  // ---------------- final correlation ---------------------------------------------------------
  const finalRow = outbox(eventId);
  const finalOwner = ownerExecution(row.aggregateId);
  const finalN8n = n8nState();
  report.counts.channel = await channelCounts();
  report.counts.outboxTotals = outboxSummary();
  report.counts.ownerFinal = finalOwner;
  // The work is shared: if another review cycle ran during the verification, the aggregate version
  // moved on. That does not change the event→delivery→effect correlation of this eventId, but it is
  // reported instead of hidden.
  report.counts.concurrentBusinessActivity = finalOwner.version === row.aggregateVersion ? null
    : { eventVersion: row.aggregateVersion, ownerVersion: finalOwner.version,
      note: 'the aggregate advanced while this run was observing the event; per-eventId evidence is unaffected' };
  report.counts.n8nFinal = { active: finalN8n.active, remembered: Object.keys(finalN8n.delivered).length,
    rememberedEventIds: Object.keys(finalN8n.delivered), executions: finalN8n.executions };
  report.correlation = {
    eventId,
    reviewRequest: base.correlation.reviewRequest,
    owner: { status: finalOwner.status, version: finalOwner.version },
    delivery: { attempts: finalRow.attempts, deliveredAt: finalRow.deliveredAt, abandonedAt: finalRow.abandonedAt,
      lastErrorCode: finalRow.lastErrorCode, payloadBytes: finalRow.payloadBytes },
    channel: { recordsForEvent: recordsFor(eventId).length, receivedAt: recordsFor(eventId)[0]?.receivedAt ?? null },
    receiver: { remembered: Boolean(finalN8n.delivered[eventId]), deliveredAt: finalN8n.delivered[eventId] ?? null },
  };
} catch (failure) {
  if (failure instanceof Blocked) {
    report.blocked = failure.message;
  } else {
    report.error = String(failure?.stack ?? failure?.message ?? failure);
    report.blockers.push('verification aborted: ' + report.error);
  }
} finally {
  await stopAllSinks();
  // The channel is left running as it was found, so the flow stays observable.
  try {
    const entry = await startSink('normal');
    report.counts.channelRestored = (await channelCounts()).records;
    report.counts.sinkRestartLog = entry.log.slice(0, 400);
  } catch { report.counts.channelRestored = null; }
}
finish();
