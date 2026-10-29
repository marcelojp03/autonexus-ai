import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { civilDate, openLedger, command, prepareCredential, seed, run, pkceLogin, idpTransportUrl, callbackCode, session } from './demo.mjs';

const publicOrigin = 'http://127.0.0.1:18420';
const now = new Date('2026-10-29T02:00:00Z');
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'autonexus-demo-synthetic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const disk = dir => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
test('synthetic owner TTL renewal uses expires_in margin and bounded 401 preserves exact command', async () => {
  let clock = 0, issued = 0, state, unauthorized = 0;
  const ownerCalls = [];
  const request = async (value, options) => {
    const url = new URL(value);
    if (url.origin === 'http://operations:8081') {
      ownerCalls.push({ body: options.body, token: options.headers.Authorization });
      if (unauthorized > 0) { unauthorized--; return new Response(null, { status: 401 }); }
      return Response.json({ ok: true });
    }
    if (url.pathname.endsWith('/auth')) {
      state = url.searchParams.get('state');
      return new Response('<form id="kc-form-login" action="' + publicOrigin + '/identity/realms/autonexus/login-actions/authenticate"></form>');
    }
    if (url.pathname.endsWith('/authenticate')) return new Response(null, { status: 302, headers: { location: publicOrigin + '/auth/callback#code=synthetic&state=' + state } });
    if (url.pathname.endsWith('/token')) { issued++; return Response.json({ access_token: 'synthetic-' + issued, expires_in: 60 }); }
    assert.ok(url.pathname.endsWith('/userinfo')); return Response.json({ sub: 'synthetic-admin' });
  };
  const transport = session(publicOrigin, { username: 'synthetic', password: 'not-real' }, {}, request, { now: () => clock });
  const body = { operationId: randomUUID(), firstName: 'Frozen' };
  await transport.api('operations', '/customers', 'POST', body); assert.equal(issued, 1);
  clock = 44999; await transport.api('operations', '/customers'); assert.equal(issued, 1);
  clock = 45000; await transport.api('operations', '/customers'); assert.equal(issued, 2);
  clock = 120000; await transport.api('operations', '/customers'); assert.equal(issued, 3);
  unauthorized = 1;
  await transport.api('operations', '/customers', 'POST', body); assert.equal(issued, 4);
  assert.equal(ownerCalls.at(-1).body, ownerCalls.at(-2).body);
  assert.notEqual(ownerCalls.at(-1).token, ownerCalls.at(-2).token);
  unauthorized = 2;
  const before = ownerCalls.length;
  await assert.rejects(transport.api('operations', '/customers', 'POST', body), /DEMO_OWNER_HTTP_401/);
  assert.equal(ownerCalls.length - before, 2);
});
test('synthetic management TTL checked before both identity GET and single credential PUT', async () => {
  let clock = 0, issued = 0, puts = 0, failPut = false;
  const account = { employeeId: randomUUID(), subject: randomUUID(), password: 'not-real' }; account.username = 'employee-' + account.employeeId;
  const authorizations = [];
  const request = async (url, options) => {
    if (url.endsWith('/token')) { issued++; return Response.json({ access_token: 'synthetic-machine-' + issued, expires_in: 60 }); }
    authorizations.push(options.headers.Authorization);
    if (options.method === 'PUT') { puts++; return new Response(null, { status: failPut ? 401 : 204 }); }
    clock += 45000;
    return Response.json({ id: account.subject, username: account.username, enabled: true, attributes: { employeeId: [account.employeeId] } });
  };
  const transport = session(publicOrigin, {}, { clientId: 'autonexus-employees-admin', clientSecret: 'not-real' }, request, { now: () => clock });
  await transport.setCredential(account);
  assert.equal(issued, 2); assert.equal(puts, 1); assert.notEqual(authorizations[0], authorizations[1]);
  clock += 60000; failPut = true;
  await assert.rejects(transport.setCredential(account), /DEMO_CREDENTIAL_SET_UNCERTAIN/);
  assert.equal(issued, 4); assert.equal(puts, 2, 'Credential PUT is never retried on 401');
});
test('synthetic IdP adaptation accepts configured origin/exact authentication path only', () => {
  const path = '/identity/realms/autonexus/login-actions/authenticate', allow = p => p === path;
  assert.equal(idpTransportUrl(publicOrigin + path + '?execution=x', publicOrigin, allow), 'http://keycloak:8080' + path + '?execution=x');
  for (const value of ['http://localhost:18420' + path, publicOrigin + '/other', publicOrigin + path + '#x', 'http://user@127.0.0.1:18420' + path, 'http://evil.invalid' + path]) assert.throws(() => idpTransportUrl(value, publicOrigin, allow), /UNTRUSTED_IDP_URL/);
  assert.equal(callbackCode(publicOrigin + '/auth/callback#code=ok&state=s', publicOrigin, 's'), 'ok');
  for (const value of [publicOrigin + '/auth/callback#code=ok&state=wrong', publicOrigin + '/auth/callback#code=ok&state=s&state=s', publicOrigin + '/auth/callback?code=ok&state=s', publicOrigin + '/wrong#code=ok&state=s']) assert.throws(() => callbackCode(value, publicOrigin, 's'));
});
test('synthetic PKCE uses public redirect for authorize/exchange, cookies, fragment/state, and never navigates callback', async () => {
  let auth, called = 0;
  const account = { username: 'synthetic', password: 'not-real', subject: randomUUID() };
  const request = async (value, options) => {
    called++; const url = new URL(value);
    assert.equal(url.origin, 'http://keycloak:8080');
    if (url.pathname.endsWith('/auth')) {
      auth = url.searchParams;
      assert.equal(auth.get('redirect_uri'), publicOrigin + '/auth/callback');
      assert.equal(auth.get('response_mode'), 'fragment');
      return new Response('<form id="kc-form-login" action="' + publicOrigin + '/identity/realms/autonexus/login-actions/authenticate?session_code=s&amp;execution=e"></form>', { headers: { 'set-cookie': 'AUTH_SESSION_ID=synthetic; Path=/identity' } });
    }
    if (url.pathname.endsWith('/authenticate')) {
      assert.equal(options.headers.Cookie, 'AUTH_SESSION_ID=synthetic');
      assert.equal(url.searchParams.get('execution'), 'e');
      return new Response(null, { status: 302, headers: { location: publicOrigin + '/auth/callback#code=synthetic&state=' + auth.get('state') } });
    }
    if (url.pathname.endsWith('/token')) {
      assert.equal(options.body.get('grant_type'), 'authorization_code');
      assert.equal(options.body.get('redirect_uri'), auth.get('redirect_uri'));
      assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), auth.get('code_challenge'));
      return Response.json({ access_token: 'synthetic-ram-only', expires_in: 60 });
    }
    assert.ok(url.pathname.endsWith('/userinfo')); return Response.json({ sub: account.subject });
  };
  const result = await pkceLogin(publicOrigin, account, request);
  assert.equal(result.subject, account.subject); assert.equal(called, 4);
});
test('synthetic management verifies subject/username/employee attribute before PUT', async () => {
  const account = { employeeId: randomUUID(), subject: randomUUID(), password: 'not-real' }; account.username = 'employee-' + account.employeeId;
  let puts = 0, drift = true;
  const transport = session(publicOrigin, {}, { clientId: 'autonexus-employees-admin', clientSecret: 'not-real' }, async (url, options) => {
    if (url.endsWith('/token')) { assert.equal(options.body.get('grant_type'), 'client_credentials'); return Response.json({ access_token: 'synthetic-management', expires_in: 60 }); }
    if (options.method === 'PUT') { puts++; return new Response(null, { status: 204 }); }
    return Response.json({ id: account.subject, username: account.username, enabled: true, attributes: { employeeId: [drift ? randomUUID() : account.employeeId] } });
  });
  await assert.rejects(transport.setCredential(account), /IDENTITY_OWNERSHIP_DRIFT/); assert.equal(puts, 0);
  drift = false; await transport.setCredential(account); assert.equal(puts, 1);
});
test('synthetic guard rejects missing or nonliteral enablement before files/network', async () => {
  for (const enabled of [undefined, false, 'TRUE', '1', 'false']) await assert.rejects(run({ enabled, configDir: '/not-readable' }), /DEMO_EXPLICIT_ENABLE_REQUIRED/);
});
test('synthetic La Paz date freezes +7 days and expired/origin drift fails without retiming', t => {
  const dir = temporary(t), ledger = openLedger(dir, publicOrigin, now);
  assert.equal(civilDate(now), '2026-10-28'); assert.equal(ledger.state.date, '2026-11-04');
  const before = readFileSync(join(dir, 'manifest.json'), 'utf8');
  assert.deepEqual(openLedger(dir, publicOrigin, now).state, ledger.state);
  assert.throws(() => openLedger(dir, publicOrigin, new Date('2026-11-05T12:00:00Z')), /EXPIRED_NEW_VERSION_REQUIRED/);
  assert.throws(() => openLedger(dir, 'http://localhost:18420', now), /MANIFEST_DRIFT/);
  assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf8'), before);
});
test('synthetic response loss replays frozen operation/body across reopened ledger', async t => {
  const dir = temporary(t), ledger = openLedger(dir, publicOrigin, now), transport = fakeTransport(dir);
  transport.loseNextResponse();
  await assert.rejects(command(ledger, transport.api, 'sample', 'operations', '/customers', { firstName: 'Original' }, 'customer'), /SYNTHETIC_RESPONSE_LOST/);
  const prepared = disk(dir).steps.sample;
  const reopened = openLedger(dir, publicOrigin, now);
  const result = await command(reopened, transport.api, 'sample', 'operations', '/customers', { firstName: 'Changed after crash' }, 'customer');
  assert.equal(result.firstName, 'Original');
  assert.deepEqual(transport.calls[0].body, transport.calls[1].body);
  assert.equal(reopened.state.steps.sample.body.operationId, prepared.body.operationId);
  assert.equal(transport.results.size, 1);
});
test('synthetic full demo ordering, two distinct jobs, completed replay is GET-only and preserves edits/credentials', async t => {
  const dir = temporary(t), ledger = openLedger(dir, publicOrigin, now), transport = fakeTransport(dir);
  assert.deepEqual(await seed(ledger, transport), { employees: 5, jobs: 2, date: '2026-11-04' });
  assert.equal(Object.keys(ledger.state.steps).length, 28);
  assert.equal(transport.credentials.size, 5);
  const accounts = readFileSync(join(dir, 'accounts.json'), 'utf8');
  const customer = transport.resources.get('operations/customers/' + ledger.state.steps['mechanicA.customer'].result.id);
  customer.firstName = 'Human business edit'; customer.version++;
  const mechanic = transport.resources.get('employees/employees/' + ledger.state.accounts.mechanicA.employeeId);
  mechanic.phone = '+59171111111'; mechanic.version++;
  const beforeCount = transport.resources.size;
  transport.calls.length = 0;
  await seed(openLedger(dir, publicOrigin, now), transport);
  assert.ok(transport.calls.every(call => call.method === 'GET'));
  assert.equal(transport.resources.size, beforeCount);
  assert.equal(customer.firstName, 'Human business edit'); assert.equal(mechanic.phone, '+59171111111');
  assert.equal(readFileSync(join(dir, 'accounts.json'), 'utf8'), accounts);
  assert.equal(readFileSync(join(dir, 'manifest.json'), 'utf8').includes('synthetic-ram-only'), false);
  if (process.platform !== 'win32') for (const file of ['manifest.json', 'accounts.json']) assert.equal(statSync(join(dir, file)).mode & 0o777, 0o600);
});
test('synthetic revoked role fails read-only rather than restoring it', async t => {
  const dir = temporary(t), ledger = openLedger(dir, publicOrigin, now), transport = fakeTransport(dir);
  await seed(ledger, transport);
  const role = [...transport.resources.values()].find(v => v.roleName === 'mecanico'); role.status = 'revoked';
  transport.calls.length = 0;
  await assert.rejects(seed(openLedger(dir, publicOrigin, now), transport), /DEMO_ROLE_DRIFT/);
  assert.ok(transport.calls.every(c => c.method === 'GET')); assert.equal(role.status, 'revoked');
});
test('synthetic missing resource never recreates a completed step', async t => {
  const dir = temporary(t), ledger = openLedger(dir, publicOrigin, now), transport = fakeTransport(dir);
  await seed(ledger, transport);
  transport.resources.delete('operations/customers/' + ledger.state.steps['mechanicA.customer'].result.id);
  transport.calls.length = 0;
  await assert.rejects(seed(openLedger(dir, publicOrigin, now), transport));
  assert.ok(transport.calls.every(c => c.method === 'GET'));
});
test('synthetic pending Saga resumes same intent and rejected Saga is not success', async t => {
  const dir = temporary(t), ledger = openLedger(dir, publicOrigin, now), transport = fakeTransport(dir);
  transport.setPending(true);
  await assert.rejects(seed(ledger, transport, { wait: async () => {}, attempts: 2 }), /DEMO_SAGA_PENDING/);
  const saved = structuredClone(ledger.state.steps['mechanicA.confirmation']);
  transport.setPending(false); await seed(openLedger(dir, publicOrigin, now), transport);
  assert.deepEqual(disk(dir).steps['mechanicA.confirmation'], saved);
  transport.setRejected(true); transport.calls.length = 0;
  await assert.rejects(seed(openLedger(dir, publicOrigin, now), transport), /DEMO_SAGA_REJECTED/);
  assert.ok(transport.calls.every(c => c.method === 'GET'));
});
test('synthetic uncertain credential tests existing password on retry and never resets again', async t => {
  const dir = temporary(t), ledger = openLedger(dir, publicOrigin, now), account = ledger.state.accounts.mechanicA;
  Object.assign(account, { employeeId: randomUUID(), subject: randomUUID() });
  ledger.state.steps['employee.mechanicA'] = { state: 'done', result: { id: account.employeeId } }; ledger.save();
  let resets = 0, works = false;
  const transport = { async setCredential() { resets++; assert.equal(disk(dir).accounts.mechanicA.credentialState, 'attempted'); throw new Error('SYNTHETIC_LOST'); }, async login() { if (!works) throw new Error('SYNTHETIC_LOGIN_FAILED'); return { subject: account.subject }; } };
  await assert.rejects(prepareCredential(ledger, account, transport), /SYNTHETIC_LOST/);
  const reopened = openLedger(dir, publicOrigin, now), retryAccount = reopened.state.accounts.mechanicA;
  await assert.rejects(prepareCredential(reopened, retryAccount, transport), /UNCERTAIN_NO_RESET_ALLOWED/);
  works = true; await prepareCredential(reopened, retryAccount, transport);
  assert.equal(resets, 1); assert.equal(retryAccount.credentialState, 'verified');
  await prepareCredential(reopened, retryAccount, transport); assert.equal(resets, 1);
  await assert.rejects(prepareCredential(reopened, { ...retryAccount, employeeId: randomUUID() }, transport), /ACCOUNT_NOT_OWNED/);
});
test('synthetic lost ledger with existing private export fails closed', t => {
  const dir = temporary(t), ledger = openLedger(dir, publicOrigin, now); ledger.exportAccounts();
  rmSync(join(dir, 'manifest.json'));
  assert.throws(() => openLedger(dir, publicOrigin, now), /LEDGER_MISSING/);
  assert.equal(existsSync(join(dir, 'manifest.json')), false);
});
function fakeTransport(dir) {
  const resources = new Map(), results = new Map(), calls = [], credentials = new Map();
  let loseResponse = false, pending = false, rejected = false;
  return {
    resources, results, calls, credentials,
    loseNextResponse() { loseResponse = true; },
    setPending(value) { pending = value; },
    setRejected(value) { rejected = value; },
    async api(owner, path, method = 'GET', body) {
      calls.push({ owner, path, method, body: structuredClone(body) });
      if (method === 'GET') {
        if (path.endsWith('/roles')) return { items: [...resources.values()].filter(v => v.employeeId === path.split('/')[3] && v.roleName) };
        if (path.endsWith('/schedule')) return { shifts: [...resources.values()].filter(v => v.employeeId === path.split('/')[3] && v.weekday) };
        const resource = resources.get(owner + path);
        assert.ok(resource, 'Synthetic resource must exist: ' + owner + path);
        if (path.startsWith('/confirmations/')) return { ...resource, status: pending ? 'running' : rejected ? 'rejected' : 'confirmed' };
        return structuredClone(resource);
      }
      assert.equal(method, 'POST');
      const durable = Object.values(disk(dir).steps).find(s => s.body.operationId === body.operationId);
      assert.ok(durable, 'Command persisted before synthetic request');
      assert.deepEqual(durable.body, body);
      assert.equal(Object.keys(disk(dir).accounts).length, 5, 'Credentials prepared before employee creation');
      if (results.has(body.operationId)) return structuredClone(results.get(body.operationId));
      const id = randomUUID();
      let result, resource = { ...body, id, version: 1, status: 'active' };
      if (path === '/employees') {
        resource.access = { status: 'synced', subject: randomUUID() }; result = { employee: resource };
      } else if (path.endsWith('/roles')) {
        resource.employeeId = path.split('/')[3];
        resource.subject = resources.get('employees/employees/' + resource.employeeId).access.subject;
        resource.syncStatus = 'synced'; result = { assignment: resource };
      } else if (path.endsWith('/shifts')) {
        resource.employeeId = path.split('/')[3]; result = { shift: resource };
      } else if (path.endsWith('/decision')) {
        resource = resources.get(owner + path.replace('/decision', ''));
        resource.status = 'approved'; resource.version++; result = { quote: resource };
      } else if (path.endsWith('/confirmations')) {
        const order = resources.get(owner + path.replace('/confirmations', ''));
        assert.equal(body.expectedVersion, order.version);
        assert.equal(body.quoteVersion, resources.get('finance/quotes/' + body.quoteId).version);
        assert.equal(body.employeeVersion, resources.get('employees/employees/' + body.employeeId).version);
        assert.equal(body.requiredSpecialty, 'Diagnóstico general');
        resource = { sagaId: id, orderId: order.id, status: 'confirmed' };
        order.status = 'confirmed'; order.version++;
        resources.set('operations/confirmations/' + id, resource); result = resource;
      } else {
        const key = { '/customers': 'customer', '/vehicles': 'vehicle', '/services': 'service', '/receptions': 'reception', '/orders': 'order', '/quotes': 'quote' }[path];
        assert.ok(key, 'Known synthetic route');
        if (key === 'order') { resource.number = 'DEMO-' + id.slice(0, 8); resource.status = 'pending_quote'; }
        result = { [key]: resource };
      }
      if (!path.endsWith('/decision')) resources.set(owner + path + '/' + id, resource);
      results.set(body.operationId, structuredClone(result));
      if (loseResponse) { loseResponse = false; throw new Error('SYNTHETIC_RESPONSE_LOST'); }
      return structuredClone(result);
    },
    async setCredential(account) {
      assert.equal(disk(dir).accounts[account.key].credentialState, 'attempted');
      assert.equal(disk(dir).accounts[account.key].password, account.password);
      assert.equal(credentials.has(account.employeeId), false, 'Never reset twice');
      credentials.set(account.employeeId, account.password);
    },
    async login(account) {
      assert.equal(credentials.get(account.employeeId), account.password);
      return { subject: account.subject, token: 'synthetic-ram-only' };
    },
  };
}
