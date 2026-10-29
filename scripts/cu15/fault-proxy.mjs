import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions = new Set(['reserve', 'confirm', 'release', 'authorize', 'cancel', 'ledger']);
const modes = new Set(['before-503', 'drop-after-commit']);

async function proxy(target) {
  const rules = new Map(), operations = new Map(), sockets = new Set(), retired = [];
  const counts = { received: 0, forwarded: 0, injected503: 0, droppedAfterCommit: 0, upstreamErrors: 0 };
  const server = http.createServer(async (incoming, outgoing) => {
    counts.received++;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 65536) { outgoing.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const path = new URL(incoming.url, 'http://127.0.0.1').pathname;
      const participant = path.match(/^\/internal\/cu15\/(?:assignments|quote-links)\/([0-9a-f-]+)(?:\/(reserve|confirm|release|authorize|cancel))?$/i);
      const ledger = path.match(/^\/internal\/cu15\/operations\/([0-9a-f-]+)$/i);
      let sagaId = participant?.[1], operationId;
      const action = ledger && incoming.method === 'GET' ? 'ledger' : participant?.[2];
      if (body.length && action) {
        try { operationId = JSON.parse(body).operationId; } catch { /* Forward invalid bodies unchanged. */ }
        if (uuid.test(operationId ?? '') && uuid.test(sagaId ?? '')) operations.set(operationId, sagaId);
      }
      if (ledger) { operationId = ledger[1]; sagaId = operations.get(operationId); }
      const rule = [...rules.values()].find(r => r.remaining > 0 && r.action === action && (r.sagaId !== undefined && r.sagaId === sagaId || r.operationId !== undefined && r.operationId === operationId));
      if (rule) { rule.hits++; if (Number.isFinite(rule.remaining)) rule.remaining--; }
      if (rule?.mode === 'before-503') {
        counts.injected503++;
        outgoing.writeHead(503, { 'Content-Type': 'application/json', 'X-CU15-Injection': 'INYECTADO' }).end(JSON.stringify({ code: 'INJECTED_TRANSPORT_UNAVAILABLE' }));
        return;
      }
      counts.forwarded++;
      const upstream = http.request({ hostname: target.hostname, port: target.port, path: incoming.url, method: incoming.method, headers: { ...incoming.headers, host: target.host } }, response => {
        const received = [];
        response.on('data', chunk => received.push(chunk));
        response.on('end', () => {
          const payload = Buffer.concat(received);
          let durable = false;
          try {
            const result = JSON.parse(payload);
            durable = response.statusCode === 200 && result.outcome === 'applied' && result.sagaId === sagaId && result.operationId === operationId && Boolean(result.committedAt);
          } catch { /* A non-envelope response never proves a commit. */ }
          if (rule?.mode === 'drop-after-commit' && durable) {
            counts.droppedAfterCommit++;
            outgoing.destroy();
          } else { outgoing.writeHead(response.statusCode, response.headers); outgoing.end(payload); }
        });
        response.on('error', () => outgoing.destroy());
      });
      upstream.setTimeout(15000, () => upstream.destroy());
      upstream.on('error', () => {
        counts.upstreamErrors++;
        if (!outgoing.headersSent) outgoing.writeHead(502, { 'Content-Type': 'application/json' });
        outgoing.end(JSON.stringify({ code: 'UPSTREAM_UNAVAILABLE' }));
      });
      outgoing.on('close', () => upstream.destroy());
      upstream.end(body);
    } catch { outgoing.destroy(); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    arm({ sagaId, operationId, action, mode = 'before-503', times = Infinity }) {
      assert.ok(uuid.test(sagaId ?? '') || uuid.test(operationId ?? ''), 'A synthetic Saga/operation scope is mandatory');
      assert.ok(actions.has(action) && modes.has(mode));
      assert.ok(times === Infinity || Number.isSafeInteger(times) && times > 0);
      assert.ok(mode !== 'drop-after-commit' || action !== 'ledger');
      const id = randomUUID(); rules.set(id, { id, sagaId, operationId, action, mode, remaining: times, hits: 0 }); return id;
    },
    disarm(id) {
      for (const rule of [...rules.values()]) if (!id || rule.id === id) { retired.push({ ...rule, active: false }); rules.delete(rule.id); }
    },
    snapshot() { return { ...counts, rules: [...retired, ...[...rules.values()].map(r => ({ ...r, active: true }))].map(r => ({ ...r, label: 'INYECTADO', remaining: Number.isFinite(r.remaining) ? r.remaining : 'unbounded' })) }; },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}

export async function createFaultProxy(owner) {
  assert.ok(['employees', 'finance'].includes(owner));
  return proxy(new URL(owner === 'employees' ? 'http://127.0.0.1:3002' : 'http://127.0.0.1:8000'));
}

export async function selfTest() {
  let forwarded = 0;
  const sagaId = randomUUID(), operationId = randomUUID();
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    forwarded++;
    assert.equal(req.headers.authorization, 'Bearer RAM-only-unit-value');
    const body = Buffer.concat(chunks).toString();
    const rejected = body && JSON.parse(body).reject === true;
    res.writeHead(rejected ? 409 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ sagaId, operationId, outcome: rejected ? 'rejected' : 'applied', committedAt: new Date().toISOString(), body }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  let p;
  try {
    p = await proxy(new URL('http://127.0.0.1:' + upstream.address().port));
    const headers = { Authorization: 'Bearer RAM-only-unit-value', 'Content-Type': 'application/json' };
    const send = () => fetch(p.url + '/internal/cu15/quote-links/' + sagaId + '/authorize', { method: 'POST', headers, body: JSON.stringify({ operationId }) });
    const before = p.arm({ sagaId, action: 'authorize', times: 1 });
    const unavailable = await send(); assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).outcome, undefined); assert.equal(forwarded, 0);
    const forwardedResult = await send(); assert.equal(forwardedResult.status, 200);
    assert.equal((await forwardedResult.json()).body, JSON.stringify({ operationId })); assert.equal(forwarded, 1); p.disarm(before);
    p.arm({ sagaId, action: 'authorize', mode: 'drop-after-commit', times: 1 });
    await assert.rejects(send); assert.equal(forwarded, 2); assert.equal(p.snapshot().droppedAfterCommit, 1);
    p.arm({ sagaId, action: 'ledger' });
    assert.equal((await fetch(p.url + '/internal/cu15/operations/' + operationId, { headers })).status, 503);
    assert.equal((await fetch(p.url + '/internal/cu15/operations/' + randomUUID(), { headers })).status, 200, 'Saga ledger rule cannot affect an unrelated operation');
    p.arm({ operationId: randomUUID(), action: 'ledger' });
    assert.equal((await fetch(p.url + '/internal/cu15/operations/' + randomUUID(), { headers })).status, 200, 'Operation rule cannot match undefined Saga scope');
    p.arm({ sagaId: randomUUID(), action: 'authorize' });
    assert.equal((await send()).status, 200, 'Other Saga is unaffected');
    p.disarm(); assert.equal((await send()).status, 200);
    assert.ok(p.snapshot().rules.every(rule => !rule.active));
    p.arm({ sagaId, action: 'authorize', mode: 'drop-after-commit', times: 1 });
    const rejected = await fetch(p.url + '/internal/cu15/quote-links/' + sagaId + '/authorize', { method: 'POST', headers, body: JSON.stringify({ operationId, reject: true }) });
    assert.equal(rejected.status, 409); assert.equal((await rejected.json()).outcome, 'rejected');
    assert.equal(p.snapshot().droppedAfterCommit, 1, 'A rejected response cannot be labeled as a dropped commit');
    assert.throws(() => p.arm({ action: 'authorize' }));
    assert.ok(!JSON.stringify(p.snapshot()).includes('RAM-only-unit-value'));
    return { status: 'PASS', scope: 'pure loopback proxy unit test, no owner services or databases' };
  } finally { await p?.close(); await new Promise(resolve => upstream.close(resolve)); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--self-test')) {
  console.log(JSON.stringify(await selfTest()));
}
