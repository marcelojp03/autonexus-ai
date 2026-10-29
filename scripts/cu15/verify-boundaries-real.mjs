import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';

export async function main() {
  assert.ok(process.argv.includes('--run'), 'Explicit --run required; no APIs executed');
  assert.equal(process.versions.node, '22.22.3');
  const { workspace, php, serviceEnvironment, ownerDatabase, financeKernel } = await import('./runtime.mjs');
  const { api, createFlow, tokenFor } = await import('./fixtures.mjs');
  const runId = randomUUID(), directory = resolve(workspace, 'output/cu15/boundaries-' + runId);
  mkdirSync(directory, { recursive: true });
  const report = { runId, INYECTADO: true, scope: 'G1 E/F owner boundaries only; no global CU15 confirmation or broker delivery claim', stages: [], fixtures: [], cleanup: [] };
  const databases = [], resources = [], jobs = [], pending = [];
  let metadata;
  const save = () => writeFileSync(resolve(directory, 'result.json'), JSON.stringify(report, null, 2));
  const summary = r => ({ status: r.status, code: r.body?.code, outcome: r.body?.outcome, errorCode: r.body?.errorCode, resourceId: r.body?.resource?.id, resourceStatus: r.body?.resource?.status, quoteId: r.body?.quote?.id });
  async function stage(name, action) {
    const entry = { name, status: 'RUNNING', INYECTADO: true };
    report.stages.push(entry); save(); console.log('STAGE ' + name + ' RUNNING');
    try { await action(entry); entry.status = 'PASS'; }
    catch (error) { entry.status = 'FAIL'; entry.error = error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Execution failed; raw diagnostics withheld'; throw error; }
    finally { save(); console.log('STAGE ' + name + ' ' + entry.status); }
  }
  async function fixture(approved) {
    const f = await createFlow({ prefix: 'G1', quoteApproved: approved });
    report.fixtures.push({ marker: f.marker, orderId: f.order.id, quoteId: f.quote.id, employeeId: f.employee.id }); save(); return f;
  }
  async function connect(owner) { const db = await ownerDatabase(owner); databases.push(db); return db; }
  async function waiters(db, pid, minimum, entry, application) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const result = await db.query("WITH RECURSIVE blocked(pid) AS (SELECT a.pid FROM pg_stat_activity a WHERE a.datname=current_database() AND $1::int=ANY(pg_blocking_pids(a.pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid)) WHERE a.datname=current_database()) SELECT a.pid,a.application_name,a.wait_event_type,a.wait_event FROM pg_stat_activity a JOIN blocked b USING(pid) WHERE a.wait_event_type='Lock' AND ($2::text IS NULL OR a.application_name=$2)", [pid, application ?? null]);
      entry.waits = result.rows;
      entry.kernelSessions = (await db.query("SELECT pid,application_name,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=current_database() AND application_name='cu15-finance-concurrency'")).rows;
      if (result.rows.length >= minimum) { save(); return; }
      await pause(75);
    }
    assert.fail('Required real owner SQL waiters were not observed');
  }
  const kernelFile = resolve(directory, 'finance-boundary-kernel.php');
  writeFileSync(kernelFile, [
    '<?php', 'try {',
    '$v=json_decode(stream_get_contents(STDIN),true,64,JSON_THROW_ON_ERROR);',
    "if (!preg_match('~^/quotes/[a-f0-9-]{36}/(revisions|decision)$~D',$v['path']??'')) throw new RuntimeException();",
    "$root=$v['root']; define('LARAVEL_START',microtime(true)); require $root.'/vendor/autoload.php';",
    "$app=require $root.'/bootstrap/app.php'; $kernel=$app->make(Illuminate\\Contracts\\Http\\Kernel::class); $kernel->bootstrap();",
    "Illuminate\\Support\\Facades\\DB::statement(\"SET application_name = 'cu15-finance-concurrency'\");",
    "$request=Illuminate\\Http\\Request::create($v['path'],'POST',[],[],[],['CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_AUTHORIZATION'=>'Bearer '.$v['token']],json_encode($v['body'],JSON_THROW_ON_ERROR));",
    "$response=$kernel->handle($request); echo json_encode(['status'=>$response->getStatusCode(),'body'=>json_decode($response->getContent(),true,64,JSON_THROW_ON_ERROR)],JSON_THROW_ON_ERROR); $kernel->terminate($request,$response);",
    '} catch (Throwable) { exit(1); }',
  ].join('\n'), { flag: 'wx' });
  function humanKernel(path, token, body) {
    const child = spawn(php, [kernelFile], { cwd: resolve(workspace, 'services/finance'), env: { ...process.env, ...serviceEnvironment('finance'), APP_DEBUG: 'false' }, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    jobs.push(child); let stdout = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stdin.end(JSON.stringify({ root: resolve(workspace, 'services/finance'), path, token, body }));
    return new Promise((accept, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('kernel timeout')); }, 45000);
      child.once('error', () => { clearTimeout(timer); reject(new Error('kernel startup failed')); });
      child.once('exit', code => { clearTimeout(timer); if (code !== 0) return reject(new Error('kernel failed')); try { accept(JSON.parse(stdout)); } catch { reject(new Error('kernel JSON failed')); } });
    });
  }
  const revision = f => ({ operationId: randomUUID(), expectedVersion: f.quote.version, validUntil: f.date, notes: f.marker, items: [{ serviceReference: f.service.id, description: f.marker, quantity: 1, unitPrice: 110 }] });
  async function ledger(db, owner, operationId, result) {
    const table = owner === 'employees' ? 'employees.cu15_operations' : 'cu15_operations';
    const row = (await db.query('SELECT result FROM ' + table + ' WHERE operation_id=$1', [operationId])).rows[0];
    assert.ok(row, 'Committed owner ledger required'); assert.deepEqual(row.result, result.body, 'HTTP must match committed ledger');
  }
  try {
    const human = await tokenFor();
    metadata = { initiatedBy: JSON.parse(Buffer.from(human.split('.')[1], 'base64url')).sub, authorizedAt: new Date().toISOString() };
    const finance = await connect('finance'), employees = await connect('employees');
    for (const approved of [false, true]) await stage(approved ? 'F-approved-link-vs-revision' : 'F-pending-decision-vs-revision', async entry => {
      const f = await fixture(approved), sagaId = randomUUID();
      entry.ids = { quoteId: f.quote.id, orderId: f.order.id, sagaId };
      if (approved) resources.push({ owner: 'finance', sagaId });
      const blocker = await connect('finance');
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const before = (await finance.query('SELECT * FROM quote_decisions WHERE quote_id=$1', [f.quote.id])).rows;
      const technical = approved ? await tokenFor('technical') : null;
      const body = { operationId: randomUUID(), expectedVersion: 0, orderId: f.order.id, quoteId: f.quote.id, quoteVersion: f.quote.version, ...metadata };
      await blocker.query('BEGIN'); await blocker.query('SELECT id FROM quotes WHERE id=$1 FOR UPDATE', [f.quote.id]);
      let attempts;
      try {
        const revise = humanKernel('/quotes/' + f.quote.id + '/revisions', await tokenFor(), revision(f));
        let other;
        if (approved) { const k = financeKernel('/internal/cu15/quote-links/' + sagaId + '/authorize', technical, body); jobs.push(k.process); other = k.done; }
        else other = humanKernel('/quotes/' + f.quote.id + '/decision', await tokenFor(), { operationId: randomUUID(), decision: 'approved', evidence: f.marker });
        pending.push(revise, other);
        attempts = Promise.all([revise, other]); attempts.catch(() => {});
        await waiters(finance, pid, 2, entry, 'cu15-finance-concurrency');
      } finally {
        await blocker.query('ROLLBACK');
        if (attempts) {
          const settled = await Promise.allSettled([attempts]);
          if (settled[0].status === 'fulfilled') entry.results = settled[0].value.map(summary);
          else entry.kernelFailure = 'Kernel process failed or timed out';
          save();
        }
      }
      const [revised, other] = await attempts;
      entry.results = [summary(revised), summary(other)];
      const rows = (await finance.query('SELECT id,status,version_number FROM quotes WHERE order_reference=$1 ORDER BY version_number', [f.order.id])).rows;
      const decisions = (await finance.query('SELECT * FROM quote_decisions WHERE quote_id=$1', [f.quote.id])).rows;
      entry.quotes = rows; entry.decisionCount = decisions.length;
      if (approved) {
        assert.equal(revised.status, 409); assert.equal(revised.body.code, 'QUOTE_APPROVED_IMMUTABLE');
        assert.equal(other.status, 200); assert.equal(other.body.outcome, 'applied');
        assert.deepEqual(decisions, before, 'Approval unchanged');
        assert.deepEqual(rows, [{ id: f.quote.id, status: 'approved', version_number: f.quote.version }]);
        const link = (await finance.query('SELECT * FROM quote_confirmation_links WHERE saga_id=$1', [sagaId])).rows[0];
        assert.equal(link.status, 'active'); assert.equal(link.quote_id, f.quote.id); assert.equal(link.order_id, f.order.id); assert.equal(link.quote_version, f.quote.version);
        const snapshot = typeof link.approval_snapshot === 'string' ? JSON.parse(link.approval_snapshot) : link.approval_snapshot;
        assert.equal(snapshot.id, decisions[0].id); assert.equal(snapshot.decision, 'approved');
        await ledger(finance, 'finance', body.operationId, other);
        entry.link = { id: link.id, status: link.status, approvalId: snapshot.id };
      } else if (other.status === 200) {
        assert.equal(revised.status, 409); assert.equal(revised.body.code, 'QUOTE_APPROVED_IMMUTABLE');
        assert.equal(rows.length, 1); assert.equal(rows[0].status, 'approved'); assert.equal(decisions.length, 1); assert.equal(decisions[0].decision, 'approved');
      } else {
        assert.equal(other.status, 409); assert.equal(other.body.code, 'QUOTE_ALREADY_DECIDED'); assert.equal(revised.status, 200);
        assert.equal(decisions.length, 0); assert.deepEqual(rows.map(r => r.status), ['superseded', 'pending']); assert.equal(revised.body.quote.id, rows[1].id);
      }
    });
    for (const phase of ['reserve', 'confirm']) for (const writer of ['disable', 'deactivate', 'shift', 'absence']) await stage('E-' + phase + '-vs-' + writer, async entry => {
      const f = await fixture(true), sagaId = randomUUID(); resources.push({ owner: 'employees', sagaId });
      entry.ids = { employeeId: f.employee.id, orderId: f.order.id, sagaId };
      entry.interleaving = 'INYECTADO: participant waits on own order advisory lock before employee lock; human writer runs while participant request remains in flight';
      const path = '/internal/cu15/assignments/' + sagaId;
      const reserveBody = { operationId: randomUUID(), expectedVersion: 0, orderId: f.order.id, employeeId: f.employee.id, employeeVersion: f.employee.version, requiredSpecialty: f.requiredSpecialty, startsAt: f.startsAt, endsAt: f.endsAt, ...metadata };
      if (phase === 'confirm') assert.equal((await api('employees', path + '/reserve', 'POST', reserveBody, 'technical')).body.outcome, 'applied');
      const command = phase === 'reserve' ? reserveBody : { operationId: randomUUID(), expectedVersion: 1, ...metadata };
      entry.ids.operationId = command.operationId;
      const shift = (await employees.query('SELECT id,version,weekday FROM employees.employee_shifts WHERE employee_id=$1 AND active', [f.employee.id])).rows[0];
      let writerPath, method = 'POST', body = { operationId: randomUUID(), expectedVersion: f.employee.version };
      if (writer === 'disable') {
        writerPath = '/employees/' + f.employee.id; method = 'PUT';
        body = { ...body, firstName: f.employee.firstName, lastName: f.employee.lastName, document: f.employee.document, email: f.employee.email, phone: f.employee.phone, jobTitle: f.employee.jobTitle, startDate: f.employee.startDate, specialties: f.employee.specialties, mechanicEnabled: false };
      } else if (writer === 'deactivate') writerPath = '/employees/' + f.employee.id + '/deactivate';
      else if (writer === 'shift') {
        writerPath = '/staffing/shifts/' + shift.id; method = 'PUT';
        body = { operationId: randomUUID(), expectedVersion: shift.version, weekday: shift.weekday, startsAt: '14:00', endsAt: '18:00' };
      } else {
        writerPath = '/staffing/employees/' + f.employee.id + '/absences'; body = { operationId: randomUUID(), startsOn: f.date, endsOn: f.date, reason: f.marker };
      }
      const blocker = await connect('employees'), key = 'cu15-order:' + f.order.id;
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await blocker.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
      let attempt, written;
      try {
        attempt = api('employees', path + '/' + phase, 'POST', command, 'technical'); pending.push(attempt); attempt.catch(() => {});
        await waiters(employees, pid, 1, entry);
        written = await api('employees', writerPath, method, body); entry.writerResult = summary(written);
      } finally { await blocker.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]); }
      const result = await attempt; entry.participantResult = summary(result);
      await ledger(employees, 'employees', command.operationId, result);
      assert.ok([200, 201, 409].includes(written.status), 'Writer must apply or reject business rule, never transient 503');
      if (phase === 'reserve') {
        assert.ok([200, 201].includes(written.status), 'Unreserved writer applies'); assert.equal(result.status, 409); assert.equal(result.body.outcome, 'rejected');
        const expected = { disable: ['EMPLOYEE_VERSION_CONFLICT', 'MECHANIC_NOT_ENABLED'], deactivate: ['EMPLOYEE_VERSION_CONFLICT', 'EMPLOYEE_INACTIVE'], shift: ['OUTSIDE_WORKING_HOURS'], absence: ['EMPLOYEE_ABSENT'] };
        assert.ok(expected[writer].includes(result.body.errorCode), 'Expected real eligibility/calendar rejection');
      } else {
        assert.equal(written.status, 409);
        assert.ok((['disable', 'deactivate'].includes(writer) ? ['AFFECTS_PENDING_ASSIGNMENT'] : ['AFFECTS_PENDING_CONFIRMATION', 'AFFECTS_CONFIRMED_ASSIGNMENT']).includes(written.body.code), 'Pending guard rejects writer');
        assert.equal(result.status, 200); assert.equal(result.body.outcome, 'applied'); assert.equal(result.body.resource.status, 'confirmed');
      }
      const assignments = (await employees.query('SELECT id,status,order_confirmed_observed FROM employees.employee_assignments WHERE saga_id=$1', [sagaId])).rows;
      entry.committedState = assignments;
      const record = (await employees.query('SELECT record FROM employees.employee_records WHERE id=$1', [f.employee.id])).rows[0].record;
      entry.employee = { id: record.id, status: record.status, mechanicEnabled: record.mechanicEnabled, version: record.version };
      entry.shifts = (await employees.query('SELECT id,active,starts_at,ends_at,version FROM employees.employee_shifts WHERE employee_id=$1', [f.employee.id])).rows;
      entry.absences = (await employees.query('SELECT id,active,starts_on::text,ends_on::text FROM employees.employee_absences WHERE employee_id=$1', [f.employee.id])).rows;
      if (phase === 'reserve' && writer === 'disable') assert.equal(record.mechanicEnabled, false);
      if (phase === 'reserve' && writer === 'deactivate') assert.equal(record.status, 'inactive');
      if (phase === 'reserve' && writer === 'shift') assert.equal(entry.shifts[0].starts_at, '14:00:00');
      if (phase === 'reserve' && writer === 'absence') assert.ok(entry.absences.some(a => a.active && a.starts_on === f.date && a.ends_on === f.date));
      if (phase === 'reserve') assert.equal(assignments.length, 0);
      for (const row of assignments) {
        const employee = (await employees.query('SELECT record FROM employees.employee_records WHERE id=$1', [f.employee.id])).rows[0].record;
        assert.equal(row.status, 'confirmed'); assert.equal(row.order_confirmed_observed, false);
        assert.equal(employee.status, 'active'); assert.equal(employee.mechanicEnabled, true); assert.ok(employee.specialties.includes(f.requiredSpecialty));
        const availability = await api('employees', '/staffing/employees/' + f.employee.id + '/availability?date=' + f.date);
        assert.equal(availability.status, 200);
        const valid = await employees.query("SELECT EXISTS(SELECT 1 FROM employees.employee_shifts s WHERE s.employee_id=$1 AND s.active AND s.weekday=EXTRACT(ISODOW FROM $2::timestamptz AT TIME ZONE 'America/La_Paz') AND s.starts_at <= ($2::timestamptz AT TIME ZONE 'America/La_Paz')::time AND s.ends_at >= ($3::timestamptz AT TIME ZONE 'America/La_Paz')::time AND (s.break_start IS NULL OR s.break_start >= ($3::timestamptz AT TIME ZONE 'America/La_Paz')::time OR s.break_end <= ($2::timestamptz AT TIME ZONE 'America/La_Paz')::time)) AS within_shift, EXISTS(SELECT 1 FROM employees.employee_absences x WHERE x.employee_id=$1 AND x.active AND x.starts_on <= $4::date AND x.ends_on >= $4::date) AS absent", [f.employee.id, f.startsAt, f.endsAt, f.date]);
        entry.calendar = valid.rows[0]; assert.equal(valid.rows[0].within_shift, true); assert.equal(valid.rows[0].absent, false);
      }
    });
    report.pass = true;
  } catch { report.pass = false; process.exitCode = 1; }
  finally {
    await Promise.allSettled(pending);
    for (const child of jobs) if (child.exitCode === null && child.signalCode === null) child.kill();
    for (const resource of resources) {
      try {
        const base = resource.owner === 'finance' ? '/internal/cu15/quote-links/' : '/internal/cu15/assignments/';
        const current = await api(resource.owner, base + resource.sagaId, 'GET', undefined, 'technical');
        assert.ok([200, 404].includes(current.status), 'Cleanup must reconcile the owned resource');
        const action = resource.owner === 'finance' ? 'cancel' : 'release';
        const body = { operationId: randomUUID(), expectedVersion: current.status === 404 ? 0 : current.body.version, reasonCode: 'SAGA_REJECTED', ...metadata };
        const cleaned = await api(resource.owner, base + resource.sagaId + '/' + action, 'POST', body, 'technical');
        assert.equal(cleaned.status, 200); assert.equal(cleaned.body.outcome, 'applied'); assert.equal(cleaned.body.resource.status, action === 'cancel' ? 'cancelled' : 'released');
        const replay = await api(resource.owner, base + resource.sagaId + '/' + action, 'POST', body, 'technical'); assert.equal(replay.body.replayed, true);
        report.cleanup.push({ ...resource, result: summary(cleaned), replayed: true });
      } catch { report.cleanup.push({ ...resource, status: 'FAIL' }); report.pass = false; process.exitCode = 1; }
    }
    for (const db of databases) await db.end();
    save(); console.log(JSON.stringify({ pass: report.pass, runId, evidence: resolve(directory, 'result.json'), INYECTADO: true }));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--run')) { console.error('Preparation only. Explicit --run required; no APIs executed.'); process.exitCode = 2; }
  else await main();
}
