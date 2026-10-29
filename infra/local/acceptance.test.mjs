import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { matchesGraphResponse, chromiumRuntime, relayAddress, validateLedger, minimalWork, restResult, graphDenied, sanitizedError } from './acceptance.mjs';

const publicOrigin = 'http://127.0.0.1:4288';
test('UI response correlation rejects automatic or stale filter requests', () => {
  const response = (variables, field = 'myAgenda') => ({ url: () => publicOrigin + '/graphql', request: () => ({ method: () => 'POST', postDataJSON: () => ({ query: field + '(from:$from,to:$to){total}', variables }) }) });
  const expected = { from: '2026-11-05', to: '2026-11-05', priority: undefined, employeeId: undefined };
  assert.equal(matchesGraphResponse(response({ from: '2026-10-29', to: '2026-10-29' }), publicOrigin, 'myAgenda', expected), false);
  assert.equal(matchesGraphResponse(response({ from: expected.from, to: expected.to }), publicOrigin, 'myAgenda', expected), true);
  assert.equal(matchesGraphResponse(response({ ...expected, priority: 'alta' }), publicOrigin, 'myAgenda', expected), false);
  assert.equal(matchesGraphResponse(response(expected, 'teamAgenda'), publicOrigin, 'myAgenda', expected), false);
  assert.equal(matchesGraphResponse(response({ ...expected, employeeId: 'other' }), publicOrigin, 'myAgenda', expected), false);
});
function ledger() {
  const state = { version: 1, completedAt: '2026-10-29T12:00:00Z', publicOrigin, date: '2026-11-05', accounts: {}, steps: {} };
  for (const key of ['mechanicA', 'mechanicB', 'chief']) {
    state.accounts[key] = { credentialState: 'verified', subject: randomUUID(), employeeId: randomUUID(), username: 'synthetic', password: 'private-test-only' };
  }
  for (const key of ['mechanicA', 'mechanicB']) {
    state.steps[key + '.order'] = { state: 'done', result: { id: randomUUID(), number: 'SYNTHETIC-' + key } };
    state.steps[key + '.confirmation'] = { state: 'done' };
  }
  return state;
}
function work() {
  return { assignmentId: randomUUID(), orderId: randomUUID(), employee: { id: randomUUID(), fullName: 'Synthetic', status: 'active' },
    vehicle: { id: randomUUID(), plate: 'TEST', make: 'Test', model: 'Test' }, services: [{ serviceId: randomUUID(), serviceName: 'Test', quantity: 1, estimatedMinutes: 30 }] };
}
const denial = (code = 'FORBIDDEN', statusCode = 403) => ({ status: 200, body: { errors: [{ extensions: { code, statusCode } }] } });

test('import is silent and does not read private files, start listeners or call APIs', () => {
  const url = new URL('./acceptance.mjs', import.meta.url).href;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e',
    'import fs from "node:fs"; import net from "node:net"; import {syncBuiltinESMExports} from "node:module";' +
    'fs.readFileSync=()=>{throw Error("IMPORT_PRIVATE_READ")}; fs.mkdirSync=()=>{throw Error("IMPORT_WRITE")};' +
    'net.createServer=()=>{throw Error("IMPORT_LISTENER")}; syncBuiltinESMExports();' +
    'globalThis.fetch=()=>{throw Error("IMPORT_NETWORK")}; await import(' + JSON.stringify(url) + ');'], { encoding: 'utf8' });
  assert.equal(output, '');
});

test('relay accepts only an exact IPv4 loopback HTTP origin and configurable port', () => {
  assert.deepEqual(relayAddress(publicOrigin), { host: '127.0.0.1', port: 4288 });
  assert.deepEqual(relayAddress('http://127.0.0.1:4289'), { host: '127.0.0.1', port: 4289 });
  for (const origin of [undefined, '', 'https://127.0.0.1:4288', 'http://localhost:4288', 'http://[::1]:4288',
    'http://0.0.0.0:4288', 'http://web:8080', 'http://127.0.0.1:4288/', 'http://127.0.0.1:4288/path',
    'http://127.0.0.1:4288?x=1', 'http://127.0.0.1:4288#x', 'http://user:private@127.0.0.1:4288',
    'http://127.0.0.1:0', 'http://127.0.0.1:65536']) assert.throws(() => relayAddress(origin));
});

test('ledger requires completed seed, matching origin, distinct verified linked accounts and saved orders', () => {
  const valid = ledger(); assert.equal(validateLedger(valid, publicOrigin), valid);
  const mutations = [state => delete state.completedAt, state => state.completedAt = 'invalid',
    state => state.version = 2, state => state.publicOrigin = 'http://127.0.0.1:4289',
    state => state.accounts.mechanicB.subject = state.accounts.mechanicA.subject,
    state => state.accounts.mechanicB.employeeId = state.accounts.mechanicA.employeeId,
    state => state.accounts.chief.credentialState = 'attempted', state => delete state.accounts.mechanicA.password,
    state => state.steps['mechanicA.order'].state = 'prepared', state => delete state.steps['mechanicB.order'].result.number];
  for (const mutate of mutations) { const state = ledger(); mutate(state); assert.throws(() => validateLedger(state, publicOrigin)); }
});

test('privacy is a closed allowlist at work, employee, vehicle and service boundaries', () => {
  assert.doesNotThrow(() => minimalWork(work()));
  for (const key of ['customerId', 'customerName', 'quoteId', 'totalAmount', 'approvalSnapshot', 'access_token', 'unknown']) {
    const value = work(); value[key] = 'private'; assert.throws(() => minimalWork(value), /SNAPSHOT_PRIVACY_VIOLATION/);
  }
  for (const [parent, key] of [['employee', 'document'], ['employee', 'subject'], ['vehicle', 'customerId'], ['services', 'unitPrice'], ['services', 'referenceRate']]) {
    const value = work(); (parent === 'services' ? value.services[0] : value[parent])[key] = 'private';
    assert.throws(() => minimalWork(value), /SNAPSHOT_PRIVACY_VIOLATION/);
  }
});

test('REST probes require exact HTTP/code and no payload alongside denial', () => {
  assert.deepEqual(restResult({ status: 403, body: { error: 'forbidden' } }, 403, 'forbidden'), { error: 'forbidden' });
  assert.doesNotThrow(() => restResult({ status: 404, body: { code: 'AGENDA_WORK_NOT_FOUND', statusCode: 404 } }, 404, 'AGENDA_WORK_NOT_FOUND'));
  for (const response of [{ status: 401, body: { error: 'forbidden' } }, { status: 403, body: { error: 'unauthorized' } },
    { status: 403, body: { error: 'forbidden', data: { private: true } } }, { status: 403, body: { error: 'forbidden', customerId: 'private' } }]) {
    assert.throws(() => restResult(response, 403, 'forbidden'));
  }
});

test('GraphQL denials require exact envelope, every error code/status and no aliased data', () => {
  assert.doesNotThrow(() => graphDenied(denial(), 'FORBIDDEN', 403));
  const emptyAliases = denial(); emptyAliases.body.data = { own: null, other: null };
  assert.doesNotThrow(() => graphDenied(emptyAliases, 'FORBIDDEN', 403));
  const leaked = denial(); leaked.body.data = { own: { total: 1 }, other: null };
  const mixed = denial(); mixed.body.errors.push({ extensions: { code: 'BAD_REQUEST', statusCode: 400 } });
  const extra = denial(); extra.body.private = 'not allowed';
  for (const response of [leaked, mixed, extra, { ...denial(), status: 403 }, denial('SERVICE_UNAVAILABLE', 503), { status: 200, body: { errors: [] } }]) {
    assert.throws(() => graphDenied(response, 'FORBIDDEN', 403));
  }
});

test('diagnostics with credentials, URLs, bodies or JWT-like strings retain only code and known line references', () => {
  const error = new Error('password=private https://private.invalid/?token=secret eyJsecret.secret.secret');
  error.stack += '\n at file:///private/acceptance.mjs:123:9\n at file:///private/demo.mjs:9:2';
  assert.deepEqual(sanitizedError(error), { code: 'ACCEPTANCE_FAILED', refs: ['acceptance.mjs:123:9', 'demo.mjs:9:2'] });
  try { relayAddress('private'); } catch (failure) { assert.equal(sanitizedError(failure).code, 'RELAY_ORIGIN_INVALID'); }
});

test('pnpm browser runtime resolves the locked peer without relying on top-level hoisting', () => {
  const calls = [], engine = {};
  const makeRequire = path => {
    calls.push(path);
    if (path === '/app/web/mf-employees/package.json') return { resolve(name) { assert.equal(name, '@vitest/browser-playwright'); return '/synthetic/peer.mjs'; } };
    assert.equal(path, '/synthetic/peer.mjs');
    return name => { assert.equal(name, 'playwright'); return { chromium: engine }; };
  };
  assert.equal(chromiumRuntime(makeRequire), engine);
  assert.deepEqual(calls, ['/app/web/mf-employees/package.json', '/synthetic/peer.mjs']);
});
test('container runner preserves real browser and raw TCP paths without interception or session injection', () => {
  const source = readFileSync(new URL('./acceptance.mjs', import.meta.url), 'utf8');
  assert.match(source, /client\.pipe\(upstream\); upstream\.pipe\(client\)/);
  assert.match(source, /host: 'web', port: 8080/);
  assert.match(source, /timezoneId: 'Pacific\/Auckland'/);
  assert.doesNotMatch(source, /\.route\(|addInitScript|setExtraHTTPHeaders|addCookies|storageState|ignoreHTTPSErrors|--no-sandbox|docker\.sock|\.token\(\)/);
});
