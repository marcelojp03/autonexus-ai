/** Optional operator-only verification. Separate owner credentials, READ ONLY transactions, no app composition. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

export async function main(args = process.argv.slice(2)) {
  assert.ok(args.includes('--run'));
  const module = await import('pg'), Client = module.Client ?? module.default.Client;
  const state = JSON.parse(readFileSync('/state/bootstrap.json', 'utf8'));
  const demo = JSON.parse(readFileSync('/demo-state/manifest.json', 'utf8')); assert.ok(demo.completedAt);
  const cases = ['mechanicA', 'mechanicB'].map(key => ({ name: 'demo-' + key, sagaId: demo.steps[key + '.confirmation'].result.sagaId }));
  const recovery = JSON.parse(readFileSync('/evidence/recovery-finish.json', 'utf8'));
  assert.equal(recovery.pass, true); cases.push({ name: 'recovery', sagaId: recovery.sagaId });
  for (const item of cases) assert.match(item.sagaId, /^[a-f0-9-]{36}$/);
  const clients = {};
  const report = { pass: false, readOnlyOwnerConnections: true, cases: [] };
  try {
    for (const owner of ['operations', 'employees', 'finance']) {
      const client = new Client({ host: 'postgres', port: 5432, database: 'autonexus_' + owner, user: 'autonexus_' + owner, password: state.secrets[owner + 'Db'], connectionTimeoutMillis: 5000, query_timeout: 5000 });
      await client.connect(); await client.query('BEGIN READ ONLY'); clients[owner] = client;
    }
    const one = async (client, sql, values) => { const result = await client.query(sql, values); assert.equal(result.rowCount, 1); return result.rows[0]; };
    for (const item of cases) {
      const { sagaId } = item;
      const saga = await one(clients.operations, 'SELECT id,order_id,status FROM operations.cu15_sagas WHERE id=$1', [sagaId]); assert.equal(saga.status, 'confirmed');
      const order = await one(clients.operations, 'SELECT id,status,assignment_id,quote_link_id,employee_id FROM operations.work_orders WHERE confirmation_saga_id=$1', [sagaId]); assert.equal(order.status, 'confirmed'); assert.equal(order.id, saga.order_id);
      const assignment = await one(clients.employees, 'SELECT id,order_id,employee_id,status,order_confirmed_observed FROM employees.employee_assignments WHERE saga_id=$1', [sagaId]);
      assert.equal(assignment.id, order.assignment_id); assert.equal(assignment.order_id, order.id); assert.equal(assignment.employee_id, order.employee_id); assert.equal(assignment.status, 'confirmed'); assert.equal(assignment.order_confirmed_observed, true);
      const link = await one(clients.finance, 'SELECT id,order_id,status FROM quote_confirmation_links WHERE saga_id=$1', [sagaId]); assert.equal(link.id, order.quote_link_id); assert.equal(link.order_id, order.id); assert.equal(link.status, 'active');
      const operations = await clients.employees.query('SELECT command,count(*)::integer AS total FROM employees.cu15_operations WHERE saga_id=$1 GROUP BY command', [sagaId]);
      for (const command of ['reserve_assignment', 'confirm_assignment']) assert.equal(operations.rows.find(row => row.command === command)?.total, 1);
      const financial = await one(clients.finance, 'SELECT count(*)::integer AS total FROM cu15_operations WHERE saga_id=$1 AND command=$2 AND outcome=$3', [sagaId, 'authorize_quote', 'applied']); assert.equal(financial.total, 1);
      const global = await one(clients.operations, 'SELECT id,published_at FROM operations.cu15_outbox WHERE saga_id=$1 AND event_type=$2', [sagaId, 'operations.order.confirmed.v1']); assert.ok(global.published_at);
      const receipt = await one(clients.employees, 'SELECT count(*)::integer AS total FROM employees.cu15_inbox WHERE event_id=$1', [global.id]); assert.equal(receipt.total, 1);
      const notification = await one(clients.employees, 'SELECT count(*)::integer AS total FROM employees.cu15_notifications WHERE event_id=$1 AND saga_id=$2 AND assignment_id=$3', [global.id, sagaId, assignment.id]); assert.equal(notification.total, 1);
      let delivered = false;
      for (let i = 0; i < 80; i++) {
        const event = await one(clients.finance, 'SELECT id,published_at FROM cu15_outbox WHERE saga_id=$1 AND event_type=$2', [sagaId, 'finance.cu15.quote_link.authorized.v1']);
        const inbox = await clients.operations.query('SELECT event_id FROM operations.cu15_inbox WHERE event_id=$1', [event.id]);
        if (event.published_at && inbox.rowCount === 1) { delivered = true; break; } await pause(500);
      }
      assert.equal(delivered, true, 'Financial publisher and real Operations Inbox must complete');
      report.cases.push({ name: item.name, referencesMatch: true, logicalEffectsUnique: true, financeOutboxDelivered: true, globalOutboxAndInboxObserved: true, notificationCount: 1 });
    }
    report.pass = true;
  } finally {
    for (const client of Object.values(clients)) { await client.query('ROLLBACK').catch(() => {}); await client.end().catch(() => {}); }
    console.log(JSON.stringify(report));
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('FAIL durable effects proof; private diagnostics omitted'); process.exitCode = 1; });
