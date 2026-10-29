/** Real Finance participant: Keycloak + owner PostgreSQL + RabbitMQ, no mocks. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workspace, technicalToken, userToken, request, ownerDatabase, runFinance, financeKernel } from './runtime.mjs';
import { setTimeout as pause } from 'node:timers/promises';

const api = 'http://127.0.0.1:8000';
const stages = [], evidence = {};
let db;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = (command, sagaId, body) => createHash('sha256').update(JSON.stringify(canonical({ clientId: 'autonexus-cu15-coordinator', command, sagaId, body }))).digest('hex');
const day = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + 7 * 86400000));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
};
try {
  db = await ownerDatabase('finance');
  const human = await userToken('administrador'), technical = await technicalToken();
  assert.equal((await request(api + '/quotes', technical)).status, 403, 'technical identity cannot enter human CRUD');
  assert.equal((await request(api + '/internal/cu15/operations/' + randomUUID(), human)).status, 403, 'human admin cannot impersonate the service client');
  assert.equal((await request(api + '/internal/cu15/operations/' + randomUUID(), technical)).status, 404, 'missing ledger remains unknown');
  stages.push('real-machine-identity-and-human-boundary');
  const orderId = randomUUID(), suffix = randomUUID().slice(0, 8).toUpperCase();
  const created = await request(api + '/quotes', human, 'POST', {
    operationId: randomUUID(), orderReference: orderId, orderNumber: 'CU15-F-' + suffix,
    customerReference: randomUUID(), vehicleReference: randomUUID(), vehiclePlate: 'F15' + suffix,
    validUntil: day(), notes: 'CU15 participant synthetic fixture',
    items: [{ serviceReference: randomUUID(), description: 'Prueba financiera CU15', quantity: 1, unitPrice: 100 }],
  });
  assert.equal(created.status, 201, 'synthetic quote prerequisite');
  const quote = created.body.quote;
  Object.assign(evidence, { quoteId: quote.id, orderId });
  const approved = await request(api + '/quotes/' + quote.id + '/decision', human, 'POST', { operationId: randomUUID(), decision: 'approved', evidence: 'Autorización sintética explícita para verificar CU15' });
  assert.equal(approved.status, 200);
  const sagaId = randomUUID(), initiatedBy = JSON.parse(Buffer.from(human.split('.')[1], 'base64url')).sub;
  const metadata = { initiatedBy, authorizedAt: new Date().toISOString() };
  evidence.sagaIds = [sagaId];
  const body = { operationId: randomUUID(), expectedVersion: 0, orderId, quoteId: quote.id, quoteVersion: quote.version, ...metadata };
  const url = api + '/internal/cu15/quote-links/' + sagaId;
  const linked = await request(url + '/authorize', technical, 'POST', body);
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.outcome, 'applied');
  assert.equal(linked.body.fingerprint, hash('authorize_quote', sagaId, body), 'cross-language canonical fingerprint');
  const link = linked.body.resource;
  assert.equal(link.status, 'active'); assert.equal(link.quoteVersion, quote.version); assert.equal(link.orderId, orderId);
  const persisted = await db.query('SELECT status,quote_id,quote_version,order_id FROM quote_confirmation_links WHERE saga_id=$1', [sagaId]);
  assert.equal(persisted.rows[0].status, 'active'); assert.equal(persisted.rows[0].quote_id, quote.id);
  assert.equal((await request(api + '/internal/cu15/operations/' + body.operationId, technical)).body.outcome, 'applied');
  stages.push('durable-approved-version-link-with-atomic-ledger');
  const countBefore = Number((await db.query('SELECT count(*) AS n FROM cu15_outbox WHERE saga_id=$1', [sagaId])).rows[0].n);
  const replay = await request(url + '/authorize', technical, 'POST', Object.fromEntries(Object.entries(body).reverse()));
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.resource.id, link.id);
  const conflict = await request(url + '/authorize', technical, 'POST', { ...body, quoteVersion: quote.version + 1 });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM cu15_outbox WHERE saga_id=$1', [sagaId])).rows[0].n), countBefore);
  stages.push('canonical-replay-and-different-content-conflict-no-extra-outbox');
  const cancelled = await request(url + '/cancel', technical, 'POST', { operationId: randomUUID(), expectedVersion: link.version, reasonCode: 'SAGA_REJECTED', ...metadata });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.resource.status, 'cancelled');
  assert.equal((await request(url, technical)).body.status, 'cancelled');
  const original = await request(url + '/authorize', technical, 'POST', body);
  assert.equal(original.body.resource.status, 'active', 'historical result is not current resource');
  assert.equal((await request(url, technical)).body.status, 'cancelled', 'historical replay cannot reactivate');
  const late = await request(url + '/authorize', technical, 'POST', { ...body, operationId: randomUUID() });
  assert.equal(late.body.outcome, 'rejected'); assert.equal(late.body.errorCode, 'QUOTE_LINK_CANCELLED');
  const unchanged = await db.query('SELECT q.status,q.version_number,count(d.id)::integer decisions FROM quotes q JOIN quote_decisions d ON d.quote_id=q.id WHERE q.id=$1 GROUP BY q.id', [quote.id]);
  assert.deepEqual(unchanged.rows[0], { status: 'approved', version_number: quote.version, decisions: 1 });
  stages.push('cancel-preserves-approval-and-terminal-link');
  const contenders = [randomUUID(), randomUUID()];
  evidence.sagaIds.push(...contenders);
  // Windows' development HTTP server is serial. Use independent real PHP
  // kernels and observe two PostgreSQL lock waiters, not a false HTTP race.
  const barrier = 'finance.cu15:order:' + orderId;
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [barrier]);
  const jobs = contenders.map(id => financeKernel('/internal/cu15/quote-links/' + id + '/authorize', technical, { ...body, operationId: randomUUID() }));
  const results = Promise.all(jobs.map(job => job.done));
  let observed = false;
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const waiting = await db.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='cu15-finance-concurrency' AND wait_event_type='Lock'");
      if (Number(waiting.rows[0].n) >= 2) { observed = true; break; }
      await pause(100);
    }
  } finally { await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [barrier]); }
  const attempts = await results;
  assert.ok(observed, 'two real concurrent owner DB sessions must be observed');
  evidence.concurrency = 'independent real PHP kernels + two PostgreSQL lock waiters; controlled test barrier';
  assert.equal(attempts.filter(result => result.body.outcome === 'applied').length, 1, JSON.stringify(attempts.map(result => ({ status: result.status, outcome: result.body.outcome, code: result.body.errorCode }))));
  assert.equal(attempts.filter(result => result.body.outcome === 'rejected').length, 1);
  const winner = attempts.find(result => result.body.outcome === 'applied').body.resource;
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM quote_confirmation_links WHERE order_id=$1 AND status='active'", [orderId])).rows[0].n), 1);
  const released = await request(api + '/internal/cu15/quote-links/' + winner.sagaId + '/cancel', technical, 'POST', { operationId: randomUUID(), expectedVersion: winner.version, reasonCode: 'SAGA_REJECTED', ...metadata });
  assert.equal(released.body.resource.status, 'cancelled');
  stages.push('real-postgres-concurrent-link-exclusion');
  const ids = [sagaId, ...contenders];
  const pending = Number((await db.query('SELECT count(*) AS n FROM cu15_outbox WHERE saga_id=ANY($1::uuid[]) AND published_at IS NULL', [ids])).rows[0].n);
  assert.ok(pending > 0, 'outbox is committed separately from publication');
  let remaining = pending;
  for (let attempt = 0; attempt < 64 && remaining > 0; attempt++) {
    const publication = runFinance(['artisan', 'cu15:publish-outbox', '--once', '--no-ansi']);
    assert.equal(publication.status, 0, publication.output);
    const after = await db.query('SELECT count(*) FILTER (WHERE published_at IS NULL) AS n,count(*) FILTER (WHERE last_error_code IS NOT NULL) AS errors FROM cu15_outbox WHERE saga_id=ANY($1::uuid[])', [ids]);
    assert.equal(Number(after.rows[0].errors), 0, 'broker must confirm, not merely return exit0');
    remaining = Number(after.rows[0].n);
  }
  assert.equal(remaining, 0, 'every committed event must actually be confirmed');
  stages.push('real-rabbitmq-publisher-confirms-persisted');
  Object.assign(evidence, { quoteId: quote.id, sagaIds: ids, linkId: link.id, outboxEvents: pending });
  console.log(JSON.stringify({ pass: true, stages, evidence }));
} catch (error) { process.exitCode = 1; console.error(JSON.stringify({ pass: false, stages, message: String(error?.message ?? error) })); }
finally {
  await db?.end(); mkdirSync(resolve(workspace, 'output/cu15'), { recursive: true });
  writeFileSync(resolve(workspace, 'output/cu15/finance-real.json'), JSON.stringify({ pass: !process.exitCode, stages, evidence }, null, 2));
}
