import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { TOOL_DEFINITIONS, parseToolInput, ConsultationInputError, outputSchema } from '../dist/domain/consultation.js';
import { ConsultationService } from '../dist/application/consultation-service.js';
import { OperationsReader, MAX_OWNER_BYTES } from '../dist/infrastructure/operations-reader.js';

const { z } = await import('zod');
const id = '12345678-1234-4234-8234-123456789abc';
const at = '2026-11-05T14:00:00Z';
const secret = 'PRIVATE_CANARY';
const service = { serviceId: id, serviceName: 'Inspection', quantity: 1, estimatedMinutes: 30, referenceRate: secret, notes: secret };
const order = { id, number: 'OT-0001', status: 'confirmed', priority: 'normal', version: 1, createdAt: at,
  updatedAt: at, items: [service], customerName: secret, vehiclePlate: secret, notes: secret, description: secret, quotation: { price: secret } };
const work = { assignmentId: id, orderId: id, orderNumber: 'OT-0001', employee: { id, fullName: secret },
  vehicle: { plate: secret }, startsAt: at, endsAt: '2026-11-05T15:00:00Z', priority: 'normal', status: 'confirmed',
  orderVersion: 1, assignmentVersion: 1, observedAt: at, confirmationObservation: 'observed', executionStatus: 'in_progress',
  executionProgress: { advances: 2, lastAdvanceAt: at, availableEvidence: 1, notes: secret }, services: [service], description: secret };
const advance = sequence => ({ id, sequence, minutesWorked: 10, occurredAt: at, recordedAt: at, version: 1,
  description: secret, evidences: [{ state: 'available', fileName: secret, url: secret, object: { key: secret } }] });
const execution = { id, orderId: id, orderNumber: 'OT-0001', assignmentId: id, employeeId: id, status: 'in_progress',
  startedAt: at, version: 1, advances: [advance(1), advance(2), advance(3)], evidenceSummary: { pending: 0, available: 3, failed: 0, notes: secret } };
const fakeService = raw => new ConsultationService({ read: async () => raw });
const json = raw => new Response(JSON.stringify(raw), { headers: { 'content-type': 'application/json' } });
const adapter = fetch => new OperationsReader({ baseUrl: 'http://127.0.0.1:8081', tokenProvider: async () => 'exchanged-api-token', fetch });

test('unit: exactly six closed read-only definitions with required metadata', () => {
  assert.deepEqual(TOOL_DEFINITIONS.map(t => t.name), ['autonexus_list_orders', 'autonexus_get_order', 'autonexus_list_my_agenda',
    'autonexus_list_team_agenda', 'autonexus_get_my_execution', 'autonexus_get_team_execution']);
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(tool.title && tool.description && tool.scope && tool.permission && tool.inputSchema && tool.outputSchema);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
  }
  assert.deepEqual(parseToolInput('autonexus_list_orders', {}), { limit: 20, offset: 0, responseFormat: 'json' });
  assert.equal(z.toJSONSchema(outputSchema).type, 'object');
  assert.equal(outputSchema.safeParse({ source: 'operations', observedAt: at, scope: 'global', ok: true }).success, false);
  assert.equal(outputSchema.safeParse({ source: 'operations', observedAt: at, scope: 'global', ok: false, data: [] }).success, false);
});

test('unit: unknown fields, arbitrary URLs/methods, invalid IDs and paging are rejected before fetch', async () => {
  let calls = 0;
  const reader = adapter(async () => { calls++; return json(order); });
  for (const input of [{ id: '../orders' }, { id: id + '?x=1' }, { id: '1-1-1-1-1' }, { id, url: 'http://127.0.0.1:1' }, { id, method: 'POST' }]) {
    await assert.rejects(reader.read('autonexus_get_order', input), ConsultationInputError);
  }
  for (const input of [{ limit: 0 }, { limit: 51 }, { limit: '20' }, { offset: -1 }, { offset: 100001 }, { offset: 1.1 },
    { status: 'completed' }, { from: '2026-11-05' }, { customerId: id }, { responseFormat: 'html' }]) {
    await assert.rejects(reader.read('autonexus_list_orders', input), ConsultationInputError);
  }
  await assert.rejects(reader.read('autonexus_delete_order', { id }), ConsultationInputError);
  await assert.rejects(reader.read('autonexus_get_my_execution', { orderId: id }), ConsultationInputError);
  assert.equal(calls, 0);
});

test('unit: civil dates are real, inclusive and limited to 31 La Paz days', () => {
  for (const [from, to] of [['2026-02-29', '2026-03-01'], ['2026-02-30', '2026-03-01'], ['2026-11-05', '2026-11-04'],
    ['2026-01-01', '2026-02-01'], ['2026-1-01', '2026-01-02'], ['0000-01-01', '0000-01-02']]) {
    assert.throws(() => parseToolInput('autonexus_list_my_agenda', { from, to }), ConsultationInputError);
  }
  assert.ok(parseToolInput('autonexus_list_my_agenda', { from: '2026-01-01', to: '2026-01-31' }));
  assert.ok(parseToolInput('autonexus_list_team_agenda', { from: '2028-02-29', to: '2028-02-29', employeeId: id }));
  assert.throws(() => parseToolInput('autonexus_list_my_agenda', { from: '2026-11-05', to: '2026-11-05', employeeId: id }), ConsultationInputError);
});

test('unit: all routes use GET, only allowlisted query, exchanged token and no redirects', async () => {
  const requests = [];
  const reader = adapter(async (url, init) => { requests.push({ url, init }); return json({}); });
  const cases = [
    ['autonexus_list_orders', { status: 'confirmed' }, '/orders', 'limit=20&offset=0&status=confirmed'],
    ['autonexus_get_order', { id }, '/orders/' + id, ''],
    ['autonexus_list_my_agenda', { from: '2026-11-05', to: '2026-11-05' }, '/agenda/me', 'from=2026-11-05&to=2026-11-05&limit=20&offset=0'],
    ['autonexus_list_team_agenda', { from: '2026-11-05', to: '2026-11-05', employeeId: id }, '/agenda/team', 'from=2026-11-05&to=2026-11-05&employeeId=' + id + '&limit=20&offset=0'],
    ['autonexus_get_my_execution', { assignmentId: id, advanceLimit: 1, advanceOffset: 1 }, '/executions/me/' + id, ''],
    ['autonexus_get_team_execution', { assignmentId: id }, '/executions/team/' + id, '']
  ];
  for (const [name, input, path, query] of cases) {
    await reader.read(name, { ...input, responseFormat: 'markdown' });
    const { url, init } = requests.at(-1);
    assert.equal(url.origin, 'http://127.0.0.1:8081');
    assert.equal(url.pathname, path);
    assert.equal(url.searchParams.toString(), query);
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, 'Bearer exchanged-api-token');
    assert.ok(init.signal instanceof AbortSignal); assert.equal(init.body, undefined);
  }
});

test('unit: recursive order and agenda allowlists drop private fields for both formats', async () => {
  for (const responseFormat of ['json', 'markdown']) {
    const detail = await fakeService(order).execute('autonexus_get_order', { id, responseFormat });
    assert.equal(detail.ok, true); assert.equal(detail.scope, 'global');
    assert.equal(JSON.stringify(detail).includes(secret), false);
    assert.deepEqual(Object.keys(detail.data.items[0]).sort(), ['estimatedMinutes', 'quantity', 'serviceId', 'serviceName']);
    const agenda = await fakeService({ actor: { fullName: secret }, items: [work], total: 1, limit: 20, offset: 0,
      from: '2026-11-05', to: '2026-11-05', timeZone: 'America/La_Paz', observedAt: at })
      .execute('autonexus_list_my_agenda', { from: '2026-11-05', to: '2026-11-05', responseFormat });
    assert.equal(agenda.ok, true); assert.equal(agenda.scope, 'self');
    assert.deepEqual(agenda.data[0].employee, { id });
    assert.deepEqual(agenda.data[0].executionProgress, { advances: 2, lastAdvanceAt: at, availableEvidence: 1 });
    assert.equal(JSON.stringify(agenda).includes(secret), false);
    assert.deepEqual(agenda.period, { from: '2026-11-05', to: '2026-11-05', timeZone: 'America/La_Paz' });
    assert.ok(outputSchema.safeParse(agenda).success);
  }
});

test('unit: owner period metadata must confirm the reported agenda interval and zone', async () => {
  const page = { items: [work], total: 1, limit: 20, offset: 0, from: '2026-11-05',
    to: '2026-11-05', timeZone: 'America/La_Paz', observedAt: at };
  const input = { from: '2026-11-05', to: '2026-11-05' };
  for (const change of [value => { delete value.from; }, value => { value.to = '2026-11-06'; },
    value => { value.timeZone = 'UTC'; }, value => { delete value.observedAt; }]) {
    const raw = structuredClone(page); change(raw);
    const result = await fakeService(raw).execute('autonexus_list_my_agenda', input);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'OWNER_INVALID_RESPONSE');
  }
  const valid = await fakeService(page).execute('autonexus_list_my_agenda', input);
  assert.equal(valid.ok, true); assert.equal(valid.observedAt, at);
});

test('unit: owner execution is validated in full then advances are paginated locally', async () => {
  const svc = fakeService(execution);
  const result = await svc.execute('autonexus_get_team_execution', { assignmentId: id, advanceLimit: 1, advanceOffset: 1 });
  assert.equal(result.ok, true); assert.equal(result.scope, 'team');
  assert.deepEqual(result.page, { total: 3, limit: 1, offset: 1, hasMore: true, nextOffset: 2 });
  assert.equal(result.data.advances[0].sequence, 2);
  assert.deepEqual(result.data.advances[0].evidenceCounts, { pending: 0, available: 1, failed: 0 });
  assert.equal(JSON.stringify(result).includes(secret), false);
  const beyond = await svc.execute('autonexus_get_my_execution', { assignmentId: id, advanceOffset: 100000 });
  assert.deepEqual(beyond.page, { total: 3, limit: 20, offset: 100000, hasMore: false, nextOffset: null });
  const malformed = structuredClone(execution); delete malformed.advances[2].sequence;
  const invalid = await fakeService(malformed).execute('autonexus_get_my_execution', { assignmentId: id, advanceLimit: 1 });
  assert.equal(invalid.error.code, 'OWNER_INVALID_RESPONSE');
});

test('unit: list pagination is consistent and critical missing shapes are safe errors', async () => {
  const result = await fakeService({ items: [order], total: 2, limit: 1, offset: 0 }).execute('autonexus_list_orders', { limit: 1 });
  assert.deepEqual(result.page, { total: 2, limit: 1, offset: 0, hasMore: true, nextOffset: 1 });
  for (const raw of [{}, [], { items: [], total: 1, limit: 20, offset: 0 }, { items: [order], total: 1, limit: 50, offset: 0 },
    { items: [{ ...order, items: null }], total: 1, limit: 20, offset: 0 }]) {
    const result = await fakeService(raw).execute('autonexus_list_orders', {});
    assert.equal(result.ok, false); assert.equal(result.error.status, 503); assert.equal(result.error.code, 'OWNER_INVALID_RESPONSE');
    assert.equal('data' in result, false);
  }
});

test('unit: owner 401/403/404/503 remain sanitized errors, never empty lists', async () => {
  for (const status of [401, 403, 404, 503]) {
    const svc = new ConsultationService(adapter(async () => new Response(secret, { status })));
    const result = await svc.execute('autonexus_list_orders', {});
    assert.equal(result.ok, false); assert.equal(result.error.status, status);
    assert.equal('data' in result, false); assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('unit: JSON byte limit applies to declared and streamed bodies, malformed JSON is safe', async () => {
  const bodies = [
    [() => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(MAX_OWNER_BYTES + 1) } }), 'OWNER_RESPONSE_TOO_LARGE'],
    [() => new Response(' '.repeat(MAX_OWNER_BYTES + 1), { headers: { 'content-type': 'application/json' } }), 'OWNER_RESPONSE_TOO_LARGE'],
    [() => new Response(secret, { headers: { 'content-type': 'application/json' } }), 'OWNER_INVALID_RESPONSE'],
    [() => new Response('{}', { headers: { 'content-type': 'text/html' } }), 'OWNER_INVALID_RESPONSE'],
    [() => { throw new Error(secret); }, 'OWNER_UNAVAILABLE']
  ];
  for (const [fetch, code] of bodies) {
    const result = await new ConsultationService(adapter(fetch)).execute('autonexus_list_orders', {});
    assert.equal(result.ok, false); assert.equal(result.error.code, code);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('unit: native fetch does not follow redirects or forward bearer to another endpoint', async t => {
  let redirected = 0;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/orders')) { res.writeHead(302, { location: '/forbidden-target' }); res.end(); }
    else { redirected++; res.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const reader = new OperationsReader({ baseUrl: 'http://127.0.0.1:' + server.address().port, tokenProvider: async () => 'exchanged-token' });
  const result = await new ConsultationService(reader).execute('autonexus_list_orders', {});
  assert.equal(result.error.code, 'OWNER_UNAVAILABLE'); assert.equal(redirected, 0);
});

test('unit: exact 512 KiB JSON boundary is accepted, larger multi-byte JSON is not', async () => {
  const text = 'x'.repeat(MAX_OWNER_BYTES - 2);
  assert.equal(await adapter(async () => json(text)).read('autonexus_list_orders', {}), text);
  await assert.rejects(adapter(async () => json('é'.repeat(MAX_OWNER_BYTES / 2))).read('autonexus_list_orders', {}),
    error => error.code === 'OWNER_RESPONSE_TOO_LARGE' && error.status === 503);
});

test('unit: native fetch aborts a stalled JSON body after five seconds with sanitized timeout', async t => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.write('{');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const reader = new OperationsReader({ baseUrl: 'http://127.0.0.1:' + server.address().port, tokenProvider: async () => 'exchanged-token' });
  const start = Date.now();
  const result = await new ConsultationService(reader).execute('autonexus_list_orders', {});
  assert.equal(result.ok, false); assert.equal(result.error.code, 'OWNER_TIMEOUT');
  assert.ok(Date.now() - start >= 4500); assert.ok(Date.now() - start < 10000);
});
