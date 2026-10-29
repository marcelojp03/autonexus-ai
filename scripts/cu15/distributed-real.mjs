import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { workspace, node, ownerDatabase, sanitize, accounts } from './runtime.mjs';
import { createFlow, api, tokenFor } from './fixtures.mjs';
import { createFaultProxy } from './fault-proxy.mjs';

const safe = value => sanitize(String(value), []).replace(/([?&](?:code|state|session_state|code_verifier|access_token|id_token|refresh_token)=)[^\s&#]*/gi, '$1[REDACTED]');
const noJwt = value => assert.ok(!/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(JSON.stringify(value)), 'JWT must never be persisted');
const step = (saga, command) => saga.steps.find(item => item.command === command);
const processCommand = (binary, args, timeout = 45000) => new Promise((done, reject) => {
  const child = spawn(binary, args, { cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => { child.kill(); reject(new Error('Verification subprocess timed out')); }, timeout);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); code === 0 ? done(output) : reject(new Error('Verification subprocess failed: ' + safe(output))); });
});

async function stopOwnedOperations() {
  const metadata = JSON.parse(readFileSync(resolve(workspace, 'output/cu15/operations.pid.json'), 'utf8'));
  assert.equal(metadata.owner, 'operations');
  assert.ok(Number.isSafeInteger(metadata.pid) && metadata.pid > 0);
  const jar = resolve(workspace, 'services/operations/target/operations-0.0.1-SNAPSHOT.jar');
  assert.deepEqual(metadata.args, ['-jar', jar]);
  const quoted = value => "'" + value.replaceAll("'", "''") + "'";
  const script = [
    '$ErrorActionPreference=\'Stop\'',
    '$owned=' + metadata.pid,
    '$p=Get-CimInstance Win32_Process -Filter (\'ProcessId=\'+$owned)',
    'if(!$p){throw \'Owned coordinator is not running\'}',
    'if($p.ExecutablePath.Replace([char]92,[char]47) -ine \'C:/Program Files/Java/jdk-21/bin/java.exe\'){throw \'Not the scoped Java21 executable\'}',
    'if(!$p.CommandLine.Contains(' + quoted(jar) + ') -or $p.CommandLine -notmatch \'-jar\'){throw \'Not the workspace JAR\'}',
    '$listeners=@(netstat -ano -p tcp | Select-String \':8081\\s+.*LISTENING\\s+\' | ForEach-Object { [int](($_.Line.Trim() -split \'\\s+\')[-1]) } | Select-Object -Unique)',
    'if($listeners.Count -ne 1 -or $listeners[0] -ne $owned){throw \'Listener ownership mismatch\'}',
    'Stop-Process -Id $owned -ErrorAction Stop',
  ].join(';');
  await processCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  return metadata.pid;
}

export async function runMatrix({ browserProof = false, maxMinutes = 20 } = {}) {
  assert.ok(process.argv.includes('--run'), 'Real matrix requires an explicit --run');
  assert.equal(process.versions.node, '22.22.3', 'Use the fixed Node 22.22.3 binary');
  assert.ok(Number.isFinite(maxMinutes) && maxMinutes >= 5 && maxMinutes <= 30);
  const directory = resolve(workspace, 'output/cu15'); mkdirSync(directory, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const report = { runId, startedAt: new Date().toISOString(), status: 'RUNNING', scope: 'CU15 distributed real; not CU05/Flutter/offline; browser happy path separate', stages: [], fixtures: [], injections: [], diagnostics: [], browser: [] };
  const db = {}, proxies = {}, sagas = new Set(), restorations = [];
  const deadline = Date.now() + maxMinutes * 60000;
  let coordinatorChanged = false, coordinatorStopped = false, cleaning = false, interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const checkBudget = () => { if (!cleaning && (interrupted || Date.now() > deadline)) throw new Error(interrupted ? 'Interrupted; entering controlled cleanup' : 'Matrix execution budget exhausted'); };
  const persist = () => {
    if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(JSON.stringify(report))) {
      report.status = 'FAIL'; report.securityFinding = 'JWT detected in evidence source; artifact redacted'; process.exitCode = 1;
    }
    writeFileSync(resolve(directory, 'distributed-' + runId + '.json'), safe(JSON.stringify(report, null, 2)));
  };
  const record = (name, evidence) => { report.stages.push({ name, status: 'PASS', at: new Date().toISOString(), evidence }); persist(); console.log(JSON.stringify({ runId, stage: name, status: 'PASS' })); };
  const injection = (name, scope) => { report.injections.push({ label: 'INYECTADO', name, ...scope, at: new Date().toISOString() }); persist(); };
  const wait = async (name, inspect, timeout = 90000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { checkBudget(); const value = await inspect(); if (value) return value; await pause(500); }
    throw new Error('Timed out observing ' + name);
  };
  const getSaga = async id => {
    const result = await api('operations', '/confirmations/' + id, 'GET', undefined, 'jefe_taller');
    assert.equal(result.status, 200, 'Read Saga'); return result.body;
  };
  const untilSaga = (id, condition, name) => wait(name, async () => { const actual = await getSaga(id); return condition(actual) && actual; });
  const terminal = (id, status) => untilSaga(id, saga => { if (['confirmed', 'rejected'].includes(saga.status)) { assert.equal(saga.status, status); return true; } return false; }, status);
  const fixture = async options => {
    checkBudget(); const flow = await createFlow(options);
    report.fixtures.push({ marker: flow.marker, orderId: flow.order.id, quoteId: flow.quote.id, employeeId: flow.employee.id, operationId: flow.command.operationId }); persist(); return flow;
  };
  const begin = async (flow, arm) => {
    await tokenFor('jefe_taller');
    const key = 'employee:' + flow.employee.id;
    if (arm) {
      assert.ok(report.fixtures.some(item => item.employeeId === flow.employee.id), 'Barrier restricted to this run synthetic employee');
      injection('SQL short synthetic employee barrier while arming Saga-scoped transport faults', { employeeId: flow.employee.id, marker: flow.marker });
      await db.employees.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
    }
    try {
      const result = await api('operations', '/orders/' + flow.order.id + '/confirmations', 'POST', flow.command, 'jefe_taller');
      assert.equal(result.status, 202, 'Start synthetic Saga');
      sagas.add(result.body.sagaId);
      if (arm) arm(result.body);
      persist(); return result.body;
    } finally {
      if (arm) await db.employees.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
    }
  };
  const participant = async (owner, id) => {
    const result = await api(owner, '/internal/cu15/' + (owner === 'employees' ? 'assignments/' : 'quote-links/') + id, 'GET', undefined, 'technical');
    assert.equal(result.status, 200, 'Read actual participant resource'); return result.body;
  };
  const restart = async (employeesUrl, financeUrl) => {
    injection('owned coordinator restart; no participant/broker restart', { employeesUrl, financeUrl });
    const oldPid = coordinatorStopped ? null : await stopOwnedOperations();
    coordinatorChanged = true; coordinatorStopped = true;
    await wait('8081 listener released', async () => {
      // HTTP timeout does not prove the listener is gone. Wait for TCP refusal.
      return new Promise(resolvePort => {
        const socket = createConnection({ host: '127.0.0.1', port: 8081 });
        const done = released => { socket.destroy(); resolvePort(released); };
        socket.once('connect', () => done(false));
        socket.once('error', error => done(error.code === 'ECONNREFUSED'));
        socket.setTimeout(1000, () => done(false));
      });
    }, 15000);
    await processCommand(node, [resolve(workspace, 'scripts/cu15/launch.mjs'), 'operations', employeesUrl, financeUrl]);
    coordinatorStopped = false;
    await wait('coordinator ready (90s, lease 30s)', async () => {
      try { return (await fetch('http://127.0.0.1:8081/actuator/health/readiness', { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
    });
    return { oldPid, newPid: JSON.parse(readFileSync(resolve(directory, 'operations.pid.json'), 'utf8')).pid };
  };
  const dbSteps = async id => (await db.operations.query('SELECT operation_id,command,direction,status,body,fingerprint,attempts,result FROM operations.cu15_steps WHERE saga_id=$1 ORDER BY command', [id])).rows;
  const identityEvidence = async id => {
    const stored = (await db.operations.query('SELECT document FROM operations.cu15_sagas WHERE id=$1', [id])).rows[0].document;
    const human = JSON.parse(Buffer.from((await tokenFor('jefe_taller')).split('.')[1], 'base64url')).sub;
    assert.equal(stored.initiatedBy, human);
    const employees = (await db.employees.query('SELECT actor_subject,executed_by FROM employees.cu15_audit WHERE saga_id=$1', [id])).rows;
    const finance = (await db.finance.query('SELECT initiated_by,executed_by FROM cu15_audit WHERE saga_id=$1', [id])).rows;
    assert.ok(employees.length && finance.length);
    for (const row of employees) { assert.equal(row.actor_subject, human); assert.equal(row.executed_by, 'autonexus-cu15-coordinator'); }
    for (const row of finance) { assert.equal(row.initiated_by, human); assert.equal(row.executed_by, 'autonexus-cu15-coordinator'); }
    const steps = await dbSteps(id);
    const history = (await db.operations.query('SELECT snapshot FROM operations.cu15_history WHERE saga_id=$1', [id])).rows;
    const outboxes = [];
    for (const owner of ['operations', 'employees', 'finance']) {
      const table = owner === 'finance' ? 'cu15_outbox' : owner + '.cu15_outbox';
      outboxes.push(...(await db[owner].query('SELECT payload FROM ' + table + ' WHERE saga_id=$1', [id])).rows);
    }
    noJwt({ stored, steps, history, outboxes, employees, finance });
    return { initiatedBy: human, executedBy: 'autonexus-cu15-coordinator', browserJwtPersisted: false, steps: steps.map(s => ({ operationId: s.operation_id, command: s.command, fingerprint: s.fingerprint, body: s.body })) };
  };
  const finalState = async (flow, id, expected) => {
    const saga = await terminal(id, expected);
    const order = await api('operations', '/orders/' + flow.order.id);
    assert.equal(order.status, 200); assert.equal(order.body.status, expected === 'confirmed' ? 'confirmed' : 'pending_quote');
    const e = await participant('employees', id);
    assert.equal(e.status, expected === 'confirmed' ? 'confirmed' : 'released');
    const assignments = (await db.employees.query('SELECT id,status FROM employees.employee_assignments WHERE saga_id=$1', [id])).rows;
    assert.equal(assignments.length, 1);
    const links = (await db.finance.query('SELECT id,status FROM quote_confirmation_links WHERE saga_id=$1', [id])).rows;
    if (expected === 'confirmed') { assert.equal(links.length, 1); assert.equal(links[0].status, 'active'); }
    const quotes = (await db.finance.query('SELECT q.status,q.version_number,(SELECT count(*)::integer FROM quote_decisions d WHERE d.quote_id=q.id) AS decisions FROM quotes q WHERE q.id=$1', [flow.quote.id])).rows;
    assert.equal(quotes.length, 1); assert.equal(quotes[0].status, flow.quote.status); assert.equal(quotes[0].version_number, flow.quote.version);
    assert.equal(quotes[0].decisions, flow.quote.status === 'approved' ? 1 : 0);
    return { saga, assignments, links, quotes };
  };
  const browserObserve = async (flow, saga, expectedStatus) => {
    if (!browserProof) return;
    const issues = [], failed = [], entry = { sagaId: saga.sagaId, expectedStatus, issues, failed, status: 'RUNNING' };
    report.browser.push(entry);
    let browser;
    try {
      const { chromium } = createRequire(resolve(workspace, 'web/mf-employees/package.json'))(resolve(workspace, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
      browser = await chromium.launch();
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      page.on('console', message => { if (message.type() === 'error') issues.push({ type: 'console', message: safe(message.text()) }); });
      page.on('pageerror', error => issues.push({ type: 'pageerror', message: safe(error.message) }));
      page.on('requestfailed', req => failed.push({ path: new URL(req.url()).pathname, reason: safe(req.failure()?.errorText) }));
      // Authenticate on the Shell-only route before mounting Angular. This
      // avoids cancelling its startup asset requests during the OIDC redirect.
      await page.goto('http://127.0.0.1:4200/', { waitUntil: 'domcontentloaded' });
      const login = page.locator('#session-login');
      await Promise.race([login.waitFor({ state: 'visible', timeout: 30000 }), page.locator('#username').waitFor({ state: 'visible', timeout: 30000 })]);
      if (await login.isVisible()) await login.click();
      const account = accounts().find(item => item.key === 'jefe_taller');
      await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
      await page.locator('#username').fill(account.username);
      await page.locator('#password').fill(account.password);
      await page.locator('#kc-login').click();
      await page.locator('#session-logout').waitFor({ state: 'visible', timeout: 45000 });
      await page.goto('http://127.0.0.1:4200/operations/confirmations/' + saga.sagaId, { waitUntil: 'domcontentloaded' });
      await page.locator('#confirmation-status').waitFor({ state: 'visible', timeout: 45000 });
      const current = await getSaga(saga.sagaId); assert.equal(current.status, expectedStatus);
      assert.equal(await page.locator('#confirmation-success').count(), 0);
      for (const selector of ['#confirmation-next-attempt', '#confirmation-steps']) await page.locator(selector).waitFor({ state: 'visible', timeout: 15000 });
      // Recovery keeps the causal error on the uncertain step. The top-level
      // errorCode is reserved for a durable rejection and may legitimately be null.
      const causalError = current.errorCode ?? current.steps.find(item => item.errorCode)?.errorCode;
      assert.ok(causalError, 'Pending recovery must expose a causal error');
      await page.locator('#confirmation-steps').getByText(causalError, { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 });
      assert.match(await page.locator('#confirmation-saga-id').innerText(), new RegExp(saga.sagaId));
      const result = page.waitForResponse(response => response.url().endsWith('/graphql') && response.request().postDataJSON()?.query?.includes('retryServiceConfirmation'));
      await page.locator('#confirmation-retry').click();
      const response = await result; const body = await response.json();
      assert.ok(body.data?.retryServiceConfirmation?.sagaId === saga.sagaId || body.errors?.length > 0 && body.errors.every(error => error.extensions?.status === 409 || error.extensions?.httpStatus === 409 || ['VERSION_CONFLICT', 'CONFIRMATION_VERSION_CONFLICT'].includes(error.extensions?.code)), 'Retry must keep the same Saga or report a safe version conflict');
      await page.locator('#confirmation-refresh').click();
      assert.equal(await page.locator('#confirmation-success').count(), 0);
      const availability = await api('employees', '/staffing/mechanics/' + flow.employee.id + '/availability?date=' + flow.date, 'GET', undefined, 'jefe_taller');
      assert.equal(availability.status, 200);
      assert.ok(availability.body.reservations.some(item => item.sagaId === saga.sagaId && !item.orderConfirmedObserved), 'Real provisional reservation remains visible');
      mkdirSync(resolve(workspace, 'output/playwright'), { recursive: true });
      entry.screenshot = 'output/playwright/cu15-' + runId + '-' + expectedStatus + '.png';
      await page.screenshot({ path: resolve(workspace, entry.screenshot), fullPage: true });
      entry.retrySagaId = saga.sagaId; entry.provisionalReservations = availability.body.reservations.filter(item => item.sagaId === saga.sagaId);
      assert.equal(issues.length, 0, 'Browser errors retained in evidence'); assert.equal(failed.length, 0, 'Failed requests retained in evidence'); entry.status = 'PASS';
    } catch (error) { entry.status = 'FAIL'; entry.error = safe(error.message); throw error; }
    finally { await browser?.close(); persist(); }
  };

  try {
    for (const owner of ['operations', 'employees', 'finance']) {
      db[owner] = await ownerDatabase(owner);
      await db[owner].query("SET statement_timeout='8s'");
    }
    proxies.employees = await createFaultProxy('employees'); proxies.finance = await createFaultProxy('finance');
    await restart(proxies.employees.url, proxies.finance.url);

    const same = await fixture({ prefix: 'sameorder' });
    const commands = [same.command, { ...same.command, operationId: randomUUID() }];
    const concurrent = await Promise.all(commands.map(body => api('operations', '/orders/' + same.order.id + '/confirmations', 'POST', body, 'jefe_taller')));
    for (const response of concurrent) if (response.body.sagaId) sagas.add(response.body.sagaId);
    assert.equal(concurrent.filter(r => r.status === 202).length, 1);
    const winner = concurrent.findIndex(r => r.status === 202), started = concurrent[winner].body;
    sagas.add(started.sagaId);
    assert.ok([409].includes(concurrent[1 - winner].status));
    assert.ok(['ORDER_CONFIRMATION_IN_PROGRESS', 'ORDER_ALREADY_CONFIRMED', 'VERSION_CONFLICT'].includes(concurrent[1 - winner].body.code));
    const replay = await api('operations', '/orders/' + same.order.id + '/confirmations', 'POST', commands[winner], 'jefe_taller');
    assert.equal(replay.status, 202); assert.equal(replay.body.sagaId, started.sagaId);
    const sameState = await finalState(same, started.sagaId, 'confirmed');
    assert.equal((await db.operations.query('SELECT id FROM operations.cu15_sagas WHERE order_id=$1', [same.order.id])).rowCount, 1);
    record('1 same order concurrency + identical operation replay', sameState);

    const a = await fixture({ prefix: 'slotA' });
    const b = await fixture({ prefix: 'slotB', employee: a.employee, slot: { date: a.date, startsAt: a.startsAt, endsAt: a.endsAt } });
    const races = await Promise.all([begin(a), begin(b)]);
    const finished = await Promise.all(races.map(s => untilSaga(s.sagaId, x => ['confirmed', 'rejected'].includes(x.status), 'slot contender terminal')));
    assert.deepEqual(finished.map(s => s.status).sort(), ['confirmed', 'rejected']);
    const occupied = (await db.employees.query("SELECT saga_id,status FROM employees.employee_assignments WHERE employee_id=$1 AND status IN ('reserved','confirmed') AND starts_at < $3 AND ends_at > $2", [a.employee.id, a.startsAt, a.endsAt])).rows;
    assert.equal(occupied.length, 1);
    const loser = finished.find(s => s.status === 'rejected');
    assert.equal(step(loser, 'reserve_assignment').outcome, 'rejected');
    record('2 two orders same employee/slot, one occupant', { finished, occupied });

    const pending = await fixture({ prefix: 'pendingF', quoteApproved: false });
    const rejected = await begin(pending);
    const rejectedState = await finalState(pending, rejected.sagaId, 'rejected');
    assert.equal(step(rejectedState.saga, 'reserve_assignment').outcome, 'applied');
    assert.equal(step(rejectedState.saga, 'authorize_quote').outcome, 'rejected');
    const durableRejection = (await db.finance.query("SELECT outcome,result FROM cu15_operations WHERE saga_id=$1 AND command='authorize_quote'", [rejected.sagaId])).rows;
    assert.equal(durableRejection.length, 1); assert.equal(durableRejection[0].outcome, 'rejected');
    record('3 genuine pending quote rejects after E reserve; E released', { ...rejectedState, durableRejection });

    const lost = await fixture({ prefix: 'lostreply' });
    const dropBefore = proxies.finance.snapshot().droppedAfterCommit;
    const lostSaga = await begin(lost, s => {
      proxies.finance.arm({ sagaId: s.sagaId, action: 'authorize', mode: 'drop-after-commit', times: 1 });
      proxies.finance.arm({ operationId: step(s, 'authorize_quote').operationId, action: 'ledger' });
      proxies.finance.arm({ sagaId: s.sagaId, action: 'authorize' });
      injection('drop financial response AFTER real applied commit; ledger and subsequent authorize held 503', { sagaId: s.sagaId });
    });
    const recovering = await untilSaga(lostSaga.sagaId, s => s.status === 'recovery_pending' && proxies.finance.snapshot().droppedAfterCommit === dropBefore + 1, 'lost reply recovery_pending');
    const activeDuringRecovery = await participant('finance', lostSaga.sagaId); assert.equal(activeDuringRecovery.status, 'active');
    const frozen = await dbSteps(lostSaga.sagaId);
    await browserObserve(lost, recovering, 'recovery_pending');
    proxies.finance.disarm();
    const lostState = await finalState(lost, lostSaga.sagaId, 'confirmed');
    const thawed = await dbSteps(lostSaga.sagaId);
    for (const before of frozen.filter(s => s.body)) {
      const after = thawed.find(s => s.command === before.command);
      assert.equal(after.operation_id, before.operation_id); assert.deepEqual(after.body, before.body);
    }
    assert.equal((await db.finance.query("SELECT operation_id FROM cu15_operations WHERE saga_id=$1 AND command='authorize_quote' AND outcome='applied'", [lostSaga.sagaId])).rowCount, 1);
    record('4 lost real F commit response reconciles original IDs without compensation', { recovering, activeDuringRecovery, ...lostState });

    const restarting = await fixture({ prefix: 'restart' });
    const restartSaga = await begin(restarting, s => {
      proxies.finance.arm({ sagaId: s.sagaId, action: 'authorize' });
      injection('F authorize 503 BEFORE forward', { sagaId: s.sagaId });
    });
    await untilSaga(restartSaga.sagaId, s => s.status === 'recovery_pending' && step(s, 'reserve_assignment').outcome === 'applied', 'E reserved/F unavailable before restart');
    const beforeRestart = await dbSteps(restartSaga.sagaId);
    const reserved = await participant('employees', restartSaga.sagaId); assert.equal(reserved.status, 'reserved');
    const pids = await restart(proxies.employees.url, proxies.finance.url); assert.notEqual(pids.oldPid, pids.newPid);
    const afterRestart = await dbSteps(restartSaga.sagaId);
    assert.deepEqual(afterRestart.map(s => [s.operation_id, s.body]), beforeRestart.map(s => [s.operation_id, s.body]));
    proxies.finance.disarm();
    const restartState = await finalState(restarting, restartSaga.sagaId, 'confirmed');
    record('5 owned coordinator restart recovers durable IDs/body with machine identity', { pids, ...restartState, identity: await identityEvidence(restartSaga.sagaId) });

    const compensating = await fixture({ prefix: 'compensate' });
    const compensationSaga = await begin(compensating, s => {
      proxies.employees.arm({ sagaId: s.sagaId, action: 'confirm' });
      proxies.finance.arm({ sagaId: s.sagaId, action: 'cancel' });
      injection('E confirm held before forward; F cancel initially held 503', { sagaId: s.sagaId });
    });
    await untilSaga(compensationSaga.sagaId, s => s.status === 'recovery_pending' && step(s, 'authorize_quote').outcome === 'applied', 'F active/E confirm held');
    assert.equal((await participant('finance', compensationSaga.sagaId)).status, 'active');
    const employeeId = compensating.employee.id, marker = compensating.marker;
    const restore = async () => {
      const result = await db.employees.query("UPDATE employees.employee_records SET record=jsonb_set(record,'{mechanicEnabled}',$3::jsonb) WHERE id=$1 AND record->>'document'=$2 AND record->>'email'=$4", [employeeId, marker, JSON.stringify(compensating.employee.mechanicEnabled), marker.toLowerCase() + '@example.invalid']);
      assert.equal(result.rowCount, 1, 'Restore only the owned synthetic flag');
    };
    restorations.push(restore);
    injection('SQL mechanicEnabled=false ONLY synthetic employee; API guard intentionally bypassed for real confirm rejection', { sagaId: compensationSaga.sagaId, employeeId, marker });
    const changed = await db.employees.query("UPDATE employees.employee_records SET record=jsonb_set(record,'{mechanicEnabled}','false'::jsonb) WHERE id=$1 AND record->>'document'=$2 AND record->>'email'=$3 AND record->>'mechanicEnabled'='true' RETURNING id", [employeeId, marker, marker.toLowerCase() + '@example.invalid']);
    assert.equal(changed.rowCount, 1);
    proxies.employees.disarm();
    const compensationPending = await untilSaga(compensationSaga.sagaId, s => s.status === 'compensation_pending', 'compensation_pending after durable E reject and failed F cancel');
    assert.equal(step(compensationPending, 'confirm_assignment').outcome, 'rejected');
    assert.equal((await participant('finance', compensationSaga.sagaId)).status, 'active');
    assert.equal((await participant('employees', compensationSaga.sagaId)).status, 'reserved');
    await browserObserve(compensating, compensationPending, 'compensation_pending');
    proxies.finance.disarm();
    const compensationState = await finalState(compensating, compensationSaga.sagaId, 'rejected');
    assert.equal((await participant('finance', compensationSaga.sagaId)).status, 'cancelled');
    await restore(); restorations.pop();
    record('6 real E rejection, visible pending compensation, F cancel then E release', { compensationPending, ...compensationState });

    const event = await wait('published synthetic order event and employee notification', async () => {
      const rows = (await db.operations.query("SELECT id,attempts,payload,published_at FROM operations.cu15_outbox WHERE saga_id=$1 AND event_type='operations.order.confirmed.v1'", [started.sagaId])).rows;
      if (!rows.length || !rows[0].published_at) return false;
      assert.equal(rows.length, 1);
      const received = (await db.employees.query('SELECT event_id FROM employees.cu15_notifications WHERE event_id=$1', [rows[0].id])).rows;
      return received.length === 1 && rows[0];
    });
    const inboxLock = 'cu15-inbox:' + event.id;
    injection('SQL barrier on ONE synthetic Inbox eventId to observe the real duplicate consumer', { sagaId: started.sagaId, eventId: event.id });
    await db.employees.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [inboxLock]);
    const unlockInbox = async () => { await db.employees.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [inboxLock]); };
    restorations.push(unlockInbox);
    injection('SQL simulate publish-without-mark; ONE existing synthetic eventId, no queue purge', { sagaId: started.sagaId, eventId: event.id });
    const reset = await db.operations.query("UPDATE operations.cu15_outbox SET published_at=NULL,lease_owner=NULL,lease_until=NULL,next_attempt_at=now() WHERE id=$1 AND saga_id=$2 AND event_type='operations.order.confirmed.v1' AND published_at IS NOT NULL RETURNING id", [event.id, started.sagaId]);
    assert.equal(reset.rowCount, 1);
    const republished = await wait('real publisher republishes SAME event ID with confirm', async () => {
      const row = (await db.operations.query('SELECT id,attempts,payload,published_at FROM operations.cu15_outbox WHERE id=$1', [event.id])).rows[0];
      return row.published_at && row.attempts > event.attempts && row;
    });
    assert.deepEqual(republished.payload, event.payload);
    const consumer = await wait('real duplicate consumer waits on synthetic event Inbox lock', async () => {
      const waiting = (await db.employees.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pg_backend_pid()=ANY(pg_blocking_pids(pid)) AND query ILIKE '%pg_advisory_xact_lock%' ")).rows;
      return waiting.length > 0 && waiting[0];
    }, 30000);
    await unlockInbox(); restorations.pop();
    await wait('duplicate consumer completed its owner transaction', async () => {
      const active = (await db.employees.query("SELECT pid FROM pg_stat_activity WHERE pid=$1 AND state='active' AND query ILIKE '%pg_advisory_xact_lock%'", [consumer.pid])).rows;
      return active.length === 0;
    }, 30000);
    const inbox = (await db.employees.query('SELECT event_id,fingerprint FROM employees.cu15_inbox WHERE event_id=$1', [event.id])).rows;
    const notifications = (await db.employees.query('SELECT event_id,assignment_id,saga_id FROM employees.cu15_notifications WHERE event_id=$1 OR saga_id=$2', [event.id, started.sagaId])).rows;
    assert.equal(inbox.length, 1); assert.equal(notifications.length, 1);
    assert.equal((await participant('employees', started.sagaId)).orderConfirmedObserved, true);
    record('7 real Outbox replay same eventId, one Inbox/notification, observed closure', { original: event, republished, duplicateConsumerPid: consumer.pid, inbox, notifications });
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.error = safe(error.stack ?? error.message); process.exitCode = 1;
  } finally {
    cleaning = true;
    for (const restore of restorations.reverse()) {
      try { await restore(); } catch (error) { report.status = 'FAIL'; (report.cleanupErrors ??= []).push(safe(error.message)); process.exitCode = 1; }
    }
    for (const p of Object.values(proxies)) p.disarm();
    if (db.operations) for (const flow of report.fixtures) {
      try {
        const discovered = (await db.operations.query('SELECT id FROM operations.cu15_sagas WHERE order_id=$1', [flow.orderId])).rows;
        for (const row of discovered) sagas.add(row.id);
      } catch (error) { report.diagnostics.push({ orderId: flow.orderId, error: safe(error.message) }); }
    }
    for (const id of sagas) {
      try {
        const rows = (await db.operations.query('SELECT id,order_id,status,phase,version,document,next_attempt_at FROM operations.cu15_sagas WHERE id=$1', [id])).rows;
        report.diagnostics.push({ sagaId: id, saga: rows, steps: await dbSteps(id) });
      } catch (error) { report.diagnostics.push({ sagaId: id, error: safe(error.message) }); }
    }
    report.proxyCounters = Object.fromEntries(Object.entries(proxies).map(([owner, p]) => [owner, p.snapshot()]));
    if (coordinatorChanged) {
      try { await restart('http://127.0.0.1:3002', 'http://127.0.0.1:8000'); report.restoredDirect = true; }
      catch (error) { report.status = 'FAIL'; report.restoredDirect = false; (report.cleanupErrors ??= []).push(safe(error.message)); process.exitCode = 1; }
    }
    // Keep forwarding alive if direct restoration failed; never strand the coordinator on dead proxies.
    if (report.restoredDirect !== false) for (const p of Object.values(proxies)) {
      try { await p.close(); }
      catch (error) { report.status = 'FAIL'; (report.cleanupErrors ??= []).push(safe(error.message)); process.exitCode = 1; }
    }
    else { console.error('Direct restoration failed: healthy forwarding proxies retained; inspect output/cu15 evidence before terminating this runner.'); }
    for (const connection of Object.values(db)) {
      try { await connection.end(); }
      catch (error) { report.status = 'FAIL'; (report.cleanupErrors ??= []).push(safe(error.message)); process.exitCode = 1; }
    }
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    report.finishedAt = new Date().toISOString(); persist();
    console.log(JSON.stringify({ runId, status: report.status, artifact: 'output/cu15/distributed-' + runId + '.json', restoredDirect: report.restoredDirect }));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = process.argv.slice(2);
  if (!flags.includes('--run')) console.log('Not run. Real APIs, synthetic mutations and owned coordinator restarts require --run. See scripts/cu15/README.md.');
  else {
    assert.ok(flags.every(flag => ['--run', '--browser-proof'].includes(flag) || /^--max-minutes=\d+$/.test(flag)), 'Unknown argument');
    await runMatrix({ browserProof: flags.includes('--browser-proof'), maxMinutes: Number(flags.find(flag => flag.startsWith('--max-minutes='))?.split('=')[1] ?? 20) });
  }
}
