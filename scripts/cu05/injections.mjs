import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, pause } from './runtime.mjs';
import { graphql } from './probes.mjs';

const eventType = 'operations.order.confirmed.v1';
async function until(read, predicate, message, milliseconds = 90000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await pause(250); }
  assert.fail(message);
}
export async function injectionProbes(c, session, f, store, hooks, stage, browserProbe) {
  assert.equal(await hooks.verifyOwnership(), true, 'Main must authorize and verify owned runtime before TEST injections');
  assert.equal(typeof browserProbe, 'function', 'Prepared browserProbe required for notification warning evidence');
  let employees, operations;
  try {
    employees = await hooks.ownerDatabase('employees'); operations = await hooks.ownerDatabase('operations');
    if (hooks.injectionScenario !== 'global-pending') {
      assert.equal(hooks.subjectDriftMode, 'linked-pair', 'Column-only subject drift violates employee_subject CHECK; main must approve linked-pair TEST injection explicitly');
      await subjectDrift(session, f, store, employees, stage, c);
    }
    if (hooks.injectionScenario !== 'subject-drift') await globalPending(c, session, f, store, employees, operations, stage, browserProbe);
  } finally { await Promise.allSettled([employees, operations].filter(Boolean).map(db => db.end())); }
}
async function subjectDrift(session, f, store, db, stage, c) {
  const fixture = await f.createEmployee('DRIFT', 'mecanico'), account = fixture.account;
  const jwt = await session.token(account, true), gql = graphql(c, session), changedSubject = randomUUID();
  const baseline = (await db.query('SELECT subject,record FROM employees.employee_records WHERE id=$1 AND record->>\'document\'=$2 AND subject=$3 AND (record->>\'version\')::integer=$4', [account.employeeId, fixture.employee.document, account.subject, fixture.employee.version])).rows;
  assert.equal(baseline.length, 1); assert.equal(baseline[0].record.access.subject, account.subject);
  const roles = async () => (await db.query('SELECT to_jsonb(a) AS value FROM employees.security_role_assignments a WHERE employee_id=$1 ORDER BY role_name', [account.employeeId])).rows;
  const previousRoles = await roles(), snapshot = JSON.stringify(baseline[0].record), version = baseline[0].record.version;
  const owned = { INJECTED: true, kind: 'subject-linked-pair-drift-not-business-operation', employeeId: account.employeeId, document: fixture.employee.document, oldSubject: account.subject, changedSubject, version, restored: false };
  store.state.ownedResources.push(owned); store.save();
  let changed = false;
  try {
    await stage('INJECTED-owned-E-subject-linked-pair-drift-old-JWT-denied', async () => {
      expect(await session.api('employees', '/agenda/context?scope=self', 'GET', undefined, jwt), 200);
      const update = await db.query('UPDATE employees.employee_records SET subject=$1,record=jsonb_set(record,\'{access,subject}\',to_jsonb($1::text)) WHERE id=$2 AND subject=$3 AND record=$4::jsonb AND record->>\'document\'=$5 AND (record->>\'version\')::integer=$6 RETURNING id', [changedSubject, account.employeeId, account.subject, snapshot, fixture.employee.document, version]);
      changed = update.rowCount === 1; assert.equal(update.rowCount, 1, 'Ownership CAS must select only the newly created fixture');
      for (let i = 0; i < 2; i++) {
        expect(await session.api('employees', '/agenda/context?scope=self', 'GET', undefined, jwt), 403, 'AGENDA_ACCESS_DENIED');
        expect(await session.api('operations', '/agenda/me', 'GET', undefined, jwt), 403, 'AGENDA_ACCESS_DENIED');
        const result = await gql(jwt, '{myAgenda{total}}'); assert.ok(result.body.data == null);
        assert.ok(result.body.errors?.some(e => e.extensions?.code === 'FORBIDDEN' && e.extensions?.statusCode === 403));
      }
      assert.deepEqual(await roles(), previousRoles, 'Injection must not change roles or versions');
    });
  } finally {
    if (changed) await stage('INJECTED-owned-subject-drift-restored-CAS', async () => {
      const expectedDrift = JSON.parse(snapshot); expectedDrift.access.subject = changedSubject;
      const restore = await db.query('UPDATE employees.employee_records SET subject=$1,record=jsonb_set(record,\'{access,subject}\',to_jsonb($1::text)) WHERE id=$2 AND subject=$3 AND record=$4::jsonb AND record->>\'document\'=$5 AND (record->>\'version\')::integer=$6 RETURNING id', [account.subject, account.employeeId, changedSubject, JSON.stringify(expectedDrift), fixture.employee.document, version]);
      assert.equal(restore.rowCount, 1, 'Subject restore refused: ownership changed; never overwrite another writer');
      owned.restored = true; store.save(); assert.deepEqual(await roles(), previousRoles);
      assert.deepEqual((await db.query('SELECT subject,record FROM employees.employee_records WHERE id=$1', [account.employeeId])).rows, baseline, 'Subject and full record must restore exactly without a version mutation');
      expect(await session.api('employees', '/agenda/context?scope=self', 'GET', undefined, jwt), 200);
    });
  }
}
async function globalPending(c, session, f, store, employees, operations, stage, browserProbe) {
  const date = new Date(f.date + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + 1);
  const extraDate = date.toISOString().slice(0, 10), weekday = date.getUTCDay() || 7;
  expect(await session.api('employees', '/staffing/employees/' + f.a.employee.id + '/shifts', 'POST', { operationId: randomUUID(), weekday, startsAt: '22:00', endsAt: '23:59' }), 201);
  const flow = await f.createFlow(f.a, '23', true, false, { date: extraDate });
  assert.ok(store.state.flows.some(item => item.orderId === flow.orderId && item.marker === flow.marker));
  const before = (await operations.query('SELECT id,status FROM operations.work_orders WHERE id=$1 AND description=$2', [flow.orderId, flow.marker])).rows;
  assert.equal(before.length, 1); assert.equal(before[0].status, 'pending_quote');
  const identifier = 'cu05_delay_' + randomUUID().replaceAll('-', ''); assert.match(identifier, /^cu05_delay_[a-f0-9]{32}$/);
  const key = 'cu15-order:' + flow.orderId, gql = graphql(c, session);
  let locked = false, functionCreated = false, triggerCreated = false, started = false;
  const owned = { INJECTED: true, kind: 'owned-E-order-barrier-and-O-delivery-metadata-delay', orderId: flow.orderId, marker: flow.marker, date: extraDate, identifier, eventType, delaySeconds: 60, cleanup: 'pending' };
  store.state.ownedResources.push(owned); store.save();
  const assignment = async () => (await employees.query('SELECT id,saga_id,order_id,status,order_confirmed_observed FROM employees.employee_assignments WHERE saga_id=$1 AND order_id=$2 AND employee_id=$3', [flow.sagaId, flow.orderId, flow.employeeId])).rows[0];
  const saga = async () => expect(await session.api('operations', '/confirmations/' + flow.sagaId), 200);
  const agenda = async () => expect(await session.api('operations', '/agenda/me?from=' + extraDate + '&to=' + extraDate, 'GET', undefined, f.a.account), 200);
  const unlock = async () => { if (locked) { const result = await employees.query('SELECT pg_advisory_unlock(hashtextextended($1,0)) AS released', [key]); assert.equal(result.rows[0].released, true); locked = false; } };
  async function resumeDelivery() {
    if (triggerCreated) { await operations.query('DROP TRIGGER ' + identifier + ' ON operations.cu15_outbox'); triggerCreated = false; }
    if (functionCreated) { await operations.query('DROP FUNCTION operations.' + identifier + '()'); functionCreated = false; }
    if (flow.sagaId) await operations.query('UPDATE operations.cu15_outbox SET next_attempt_at=now() WHERE saga_id=$1 AND aggregate_id=$2 AND event_type=$3 AND published_at IS NULL', [flow.sagaId, flow.orderId, eventType]);
  }
  await browserProbe({ expected: 'prepare', fixture: flow, account: f.a.account });
  try {
    await stage('INJECTED-real-O-global-pending-excluded-with-owned-E-barrier', async () => {
      await employees.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]); locked = true;
      const result = expect(await session.api('operations', '/orders/' + flow.orderId + '/confirmations', 'POST', flow.command), 202);
      started = true; flow.sagaId = result.sagaId; assert.match(flow.sagaId, /^[a-f0-9-]{36}$/i); owned.sagaId = flow.sagaId; store.save();
      const rows = (await operations.query('SELECT status,confirmation_saga_id FROM operations.work_orders WHERE id=$1 AND description=$2', [flow.orderId, flow.marker])).rows;
      assert.equal(rows[0].status, 'confirmation_pending'); assert.equal(rows[0].confirmation_saga_id, flow.sagaId);
      assert.notEqual((await saga()).status, 'confirmed'); const pending = await agenda(); assert.deepEqual(pending.items, []); assert.equal(pending.total, 0);
      const graph = await gql(f.a.account, 'query($d:Date!){myAgenda(from:$d,to:$d){total items{orderId}}}', { d: extraDate });
      assert.ok(!graph.body.errors); assert.equal(graph.body.data.myAgenda.total, 0);
      await operations.query("SET lock_timeout='2s'");
      await operations.query('CREATE FUNCTION operations.' + identifier + "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.next_attempt_at := clock_timestamp() + interval '60 seconds'; RETURN NEW; END; $$"); functionCreated = true;
      await operations.query('CREATE TRIGGER ' + identifier + ' BEFORE INSERT ON operations.cu15_outbox FOR EACH ROW WHEN (NEW.saga_id=\'' + flow.sagaId + '\'::uuid AND NEW.event_type=\'' + eventType + '\') EXECUTE FUNCTION operations.' + identifier + '()'); triggerCreated = true;
    });
    await unlock();
    await stage('INJECTED-real-global-confirmed-Inbox-delayed-agenda-pending-warning', async () => {
      await until(saga, s => s.status === 'confirmed', 'Real CU15 did not confirm while only delivery metadata was delayed');
      const row = await assignment(); assert.equal(row.status, 'confirmed'); assert.equal(row.order_confirmed_observed, false); flow.assignmentId = row.id; store.save();
      const event = (await operations.query('SELECT id,next_attempt_at,published_at FROM operations.cu15_outbox WHERE saga_id=$1 AND aggregate_id=$2 AND event_type=$3', [flow.sagaId, flow.orderId, eventType])).rows;
      assert.equal(event.length, 1); assert.equal(event[0].published_at, null); assert.ok(new Date(event[0].next_attempt_at).getTime() > Date.now()); owned.eventId = event[0].id; store.save();
      const page = await agenda(); assert.equal(page.total, 1); assert.equal(page.items[0].assignmentId, row.id); assert.equal(page.items[0].confirmationObservation, 'pending');
      const graph = await gql(f.a.account, 'query($d:Date!){myAgenda(from:$d,to:$d){total items{assignmentId confirmationObservation}}}', { d: extraDate });
      assert.ok(!graph.body.errors); assert.equal(graph.body.data.myAgenda.total, 1); assert.equal(graph.body.data.myAgenda.items[0].confirmationObservation, 'pending');
      await browserProbe({ expected: 'notification-pending', fixture: flow, account: f.a.account });
      assert.equal((await assignment()).order_confirmed_observed, false, 'The 60-second injected window expired before warning proof completed');
    });
  } finally {
    try { await unlock(); } finally { await resumeDelivery(); }
    owned.cleanup = 'barrier-and-delivery-metadata-restored'; store.save();
  }
  if (started) await stage('real-publisher-and-Inbox-observed-after-owned-delay-removed', async () => {
    await until(saga, s => s.status === 'confirmed', 'CU15 terminal confirmation required after cleanup');
    await until(assignment, row => row?.order_confirmed_observed === true, 'Real E Inbox observation did not arrive');
    const published = (await operations.query('SELECT id,published_at FROM operations.cu15_outbox WHERE id=$1 AND saga_id=$2 AND event_type=$3', [owned.eventId, flow.sagaId, eventType])).rows;
    assert.equal(published.length, 1); assert.ok(published[0].published_at);
    assert.equal((await employees.query('SELECT event_id FROM employees.cu15_inbox WHERE event_id=$1', [owned.eventId])).rowCount, 1);
    assert.equal((await employees.query('SELECT event_id FROM employees.cu15_notifications WHERE event_id=$1 AND saga_id=$2', [owned.eventId, flow.sagaId])).rowCount, 1);
    const page = await agenda(); assert.equal(page.total, 1); assert.equal(page.items[0].confirmationObservation, 'observed');
    await browserProbe({ expected: 'notification-observed', fixture: flow, account: f.a.account });
  });
}
