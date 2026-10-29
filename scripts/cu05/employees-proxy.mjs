import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export function createEmployeesProxy(upstream, injectedTarget = '/agenda/assignments/check') {
  const target = new URL(upstream);
  assert.ok(['http:', 'https:'].includes(target.protocol) && !target.username && !target.password);
  assert.ok(['/agenda/context', '/agenda/assignments/check', '/agenda/team/employees'].includes(injectedTarget));
  let armed = false, injected = 0, forwarded = 0;
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (armed && path === injectedTarget) {
      injected++;
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'AGENDA_DEPENDENCY_UNAVAILABLE', message: 'INJECTED CU05 TEST owner failure' })); return;
    }
    forwarded++;
    const headers = { ...req.headers, host: target.host }; delete headers.connection;
    const destination = new URL(target.href); destination.pathname = target.pathname.replace(/\/$/, '') + path; destination.search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = send(destination, { method: req.method, headers, timeout: 20000 }, upstreamResponse => {
      res.writeHead(upstreamResponse.statusCode, upstreamResponse.headers); upstreamResponse.pipe(res);
    });
    outgoing.on('timeout', () => outgoing.destroy());
    outgoing.on('error', () => { if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: 'AGENDA_DEPENDENCY_UNAVAILABLE' })); });
    req.on('aborted', () => outgoing.destroy()); req.pipe(outgoing);
  });
  return {
    listen: () => new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => accept('http://127.0.0.1:' + server.address().port)); }),
    arm: () => { armed = true; }, disarm: () => { armed = false; },
    snapshot: () => ({ INJECTED: true, target: injectedTarget, injected, forwarded }),
    close: () => new Promise((accept, reject) => server.close(error => error ? reject(error) : accept())),
  };
}

export async function withOwnedEmployeesFailure(c, hooks, probe) {
  assert.equal(await hooks.verifyOwnership(), true, 'Main must verify metadata + CIM expected JAR + listener before runtime switch');
  const proxy = createEmployeesProxy(c.employees);
  const url = await proxy.listen();
  try {
    await hooks.switchToProxy(url);
    await probe(proxy);
  } finally {
    proxy.disarm();
    try { await hooks.restoreDirect(c.employees); assert.equal(await hooks.verifyDirect(c.employees), true, 'DIRECT restoration must be positively verified'); }
    catch {
      const error = new Error('CU05_DIRECT_RESTORE_FAILED_PROXY_RETAINED_FORWARDING');
      error.code = 'CU05_DIRECT_RESTORE_FAILED_PROXY_RETAINED_FORWARDING';
      error.proxy = proxy; error.proxyUrl = url;
      throw error;
    }
    await proxy.close();
  }
}
