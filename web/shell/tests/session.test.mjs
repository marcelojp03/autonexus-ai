import assert from 'node:assert/strict';
import test from 'node:test';
import { browserOidcConfig, createBrowserSession, safeReturnTo } from '../../browser-auth/session.ts';

function browser(path = '/') {
  globalThis.location = new URL(path, 'http://127.0.0.1:4200');
  const stored = new Map();
  globalThis.sessionStorage = { setItem: (k, v) => stored.set(k, v), getItem: k => stored.get(k) ?? null, removeItem: k => stored.delete(k) };
  globalThis.history = { replaceState: (_s, _t, url) => { globalThis.location = new URL(url, location.origin); } };
  return stored;
}
function fake(authenticated = true) {
  return { authenticated, token: authenticated ? 'unit-only' : undefined, tokenParsed: { sub: 'synthetic', preferred_username: '<test>', realm_access: { roles: ['mecanico', 'unrecognized'] } },
    init: async () => authenticated, login: async () => {}, logout: async () => {}, updateToken: async () => false,
    clearToken() { this.token = undefined; this.authenticated = false; this.onAuthLogout?.(); },
  };
}
function owner(sdk) { return createBrowserSession(sdk, { origin: location.origin, application: 'shell' }); }

test('container deployment uses exact same-origin public OIDC and GraphQL endpoints', async () => {
  browser(); const origin = location.origin;
  globalThis.__AUTONEXUS_CONFIG__ = { version: 1, oidcUrl: origin + '/identity', graphqlUrl: origin + '/graphql', technicalUrls: { employees: origin + '/technical/employees', operations: origin + '/technical/operations' } };
  const oldFetch = globalThis.fetch; const o = owner(fake());
  try {
    assert.equal(browserOidcConfig('shell').url, origin + '/identity');
    await o.start();
    globalThis.fetch = async url => { assert.equal(url, origin + '/graphql'); return new Response(JSON.stringify({ data: { ok: true } })); };
    assert.deepEqual(await o.session.requestBusiness('{securityCatalog{effective}}'), { data: { ok: true } });
    globalThis.fetch = async url => { assert.equal(url, origin + '/technical/employees/session'); return new Response(JSON.stringify({ resource: 'session', service: 'employees', subject: 'synthetic', roles: ['mecanico'] })); };
    await o.session.requestTechnical('employees', 'session');
  } finally { globalThis.fetch = oldFetch; delete globalThis.__AUTONEXUS_CONFIG__; o.dispose(); }
});

test('CU05 custom-only role survives session presentation without granting business authority', async () => {
  browser('/employees/agenda'); const sdk = fake();
  sdk.tokenParsed.realm_access.roles = ['agenda_custom', 'agenda_custom', 'Bad!', '', 42, 'default-roles-autonexus'];
  const o = owner(sdk);
  try {
    await o.start();
    const state = o.session.snapshot();
    assert.equal(state.authenticated, true);
    assert.deepEqual(state.identity.roles, ['agenda_custom']);
    assert.ok(Object.isFrozen(state.identity.roles));
    assert.equal('permissions' in state.identity, false);
  } finally { o.dispose(); }
});

test('CU16 evidence bytes go to a presigned HTTPS URL without bearer credentials', async () => {
  browser(); const sdk = fake(); const o = owner(sdk); const oldFetch = globalThis.fetch; await o.start();
  const body = new Uint8Array([1, 2, 3]).buffer;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://private-bucket.s3.us-east-1.amazonaws.com/evidence/object');
      assert.equal(init.method, 'PUT');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.body, body);
      assert.equal(init.headers['If-None-Match'], '*');
      assert.equal(init.headers['x-amz-checksum-sha256'], 'checksum-only');
      assert.equal(Object.keys(init.headers).some(key => ['authorization', 'cookie'].includes(key.toLowerCase())), false);
      return new Response(null, { status: 200 });
    };
    const result = await o.session.uploadEvidence({ url: 'https://private-bucket.s3.us-east-1.amazonaws.com/evidence/object', method: 'PUT', headers: { 'If-None-Match': '*', 'x-amz-checksum-sha256': 'checksum-only' }, expiresAt: new Date(Date.now() + 60000).toISOString() }, body);
    assert.deepEqual(result, { completed: true, status: 200 });
  } finally { globalThis.fetch = oldFetch; o.dispose(); }
});

test('CU15 logout cleans owned recovery even without a mounted consumer, never other subjects or tokens', async () => {
  const stored = browser(); const sdk = fake(); const o = owner(sdk); await o.start();
  stored.set('cu15:pending:synthetic', 'synthetic-command'); stored.set('cu15:pending:other', 'other-command');
  const unsubscribe = o.session.subscribe(() => {}); unsubscribe();
  try { await o.session.logout(); assert.equal(stored.has('cu15:pending:synthetic'), false); assert.deepEqual([...stored], [['cu15:pending:other', 'other-command']]); }
  finally { o.dispose(); }
});

test('CU15 owner disposal is not logout and preserves recovery through reload', async () => {
  const stored = browser(); const sdk = fake(); const o = owner(sdk); await o.start();
  stored.set('cu15:pending:synthetic', 'synthetic-command');
  o.session.subscribe(state => { if (!state.authenticated) stored.delete('cu15:pending:synthetic'); });
  o.dispose();
  assert.deepEqual([...stored], [['cu15:pending:synthetic', 'synthetic-command']]);
});

test('CU15 IdP logout or refresh failure removes owned metadata without active views', async () => {
  for (const event of ['onAuthLogout', 'onAuthRefreshError']) {
    const stored = browser(); const sdk = fake(); const o = owner(sdk); await o.start();
    stored.set('cu15:pending:synthetic', 'synthetic-command'); stored.set('unrelated', 'preserved');
    try { sdk[event](); assert.deepEqual([...stored], [['unrelated', 'preserved']]); } finally { o.dispose(); }
  }
});

test('return routes accept only owned paths and reject OAuth metadata and escapes', () => {
  for (const path of ['/employees', '/operations/dashboard/v1?tab=work', '/employees/widgets']) assert.equal(safeReturnTo(path, 'shell'), path);
  for (const path of ['https://outside.invalid', '//outside.invalid', '/employees-other', '/employees/../auth/callback', '/employees/%2e%2e/auth', '/employees/%252e%252e/auth', '/employees/\\evil', '/employees?code=secret', '/employees?%61ccess_token=x', '/operations#access_token=x']) assert.equal(safeReturnTo(path, 'shell'), null);
  for (const path of ['/#/widgets', '/#/dashboard/v1?tab=test']) assert.equal(safeReturnTo(path, 'employees'), path);
  assert.equal(safeReturnTo('/#/passport/callback?code=x', 'employees'), null);
});

test('finance routes work for Shell and standalone without widening return destinations', () => {
  for (const application of ['shell', 'finance']) {
    for (const path of ['/finance', '/finance/quotes?orderId=unit']) assert.equal(safeReturnTo(path, application), path);
    for (const path of ['/finance-other', '/finance/../employees', '/finance/%2e%2e/employees', '/finance%2fquotes', '/finance?code=unit', '/finance?%61ccess_token=x', '/finance#token=x', '//outside.invalid', '/finance/%252e%252e/']) assert.equal(safeReturnTo(path, application), null);
  }
  assert.equal(safeReturnTo('/employees', 'finance'), null);
  assert.equal(safeReturnTo('/#/widgets', 'finance'), null);
});

test('finance callback defaults safely and restores only finance metadata', async () => {
  for (const [storedRoute, expected] of [[null, '/finance'], ['/finance/quotes?orderId=unit', '/finance/quotes?orderId=unit'], ['/employees', '/finance'], ['/finance?code=unit', '/finance']]) {
    const stored = browser('/auth/callback#code=unit&state=unit');
    if (storedRoute) stored.set('autonexus:returnTo:finance', storedRoute);
    const o = createBrowserSession(fake(), { origin: location.origin, application: 'finance' });
    try { await o.start(); assert.equal(location.pathname + location.search, expected); assert.equal(location.hash, ''); assert.equal(stored.size, 0); } finally { o.dispose(); }
  }
});

test('finance protected deep link starts login once with route-only storage', async () => {
  const stored = browser('/finance/quotes?orderId=unit'); const sdk = fake(false); let count = 0;
  sdk.login = async options => { count++; assert.equal(options.redirectUri, location.origin + '/auth/callback'); };
  const o = createBrowserSession(sdk, { origin: location.origin, application: 'finance' });
  try { await o.start(); await o.start(); assert.equal(count, 1); assert.deepEqual([...stored], [['autonexus:returnTo:finance', '/finance/quotes?orderId=unit']]); } finally { o.dispose(); }
});
test('anonymous root does not loop; protected route stores only validated return metadata', async () => {
  const stored = browser('/'); const sdk = fake(false); let calls = 0;
  sdk.login = async () => { calls++; };
  const first = owner(sdk); await first.start(); assert.equal(calls, 0); first.dispose();
  const metadata = browser('/operations/widgets?tab=one'); const second = owner(sdk); await second.start(); assert.equal(calls, 1);
  assert.deepEqual([...metadata.entries()], [['autonexus:returnTo:shell', '/operations/widgets?tab=one']]);
  second.dispose(); assert.equal(stored.size, 0);
});
test('callback is cleaned and restored before immutable identity notification', async () => {
  const stored = browser('/auth/callback#code=unit&state=unit'); stored.set('autonexus:returnTo:shell', '/operations/widgets');
  const sdk = fake(); let init;
  sdk.init = async options => { init = options; return true; };
  const o = owner(sdk); await o.start();
  assert.equal(location.pathname, '/operations/widgets'); assert.equal(location.hash, ''); assert.equal(stored.size, 0);
  assert.equal(init.flow, 'standard'); assert.equal(init.pkceMethod, 'S256'); assert.equal(init.responseMode, 'fragment'); assert.equal('onLoad' in init, false);
  assert.deepEqual(o.session.snapshot().identity.roles, ['mecanico', 'unrecognized']);
  assert.ok(Object.isFrozen(o.session.snapshot().identity.roles)); o.dispose();
});
test('allowlist, safe DTO mapping, 403 preserves session and 401 invalidates it', async () => {
  browser(); const sdk = fake(); const o = owner(sdk); await o.start(); let calls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(url, 'http://127.0.0.1:3002/technical/session'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer unit-only'); return new Response(JSON.stringify({ resource: 'session', service: 'employees', subject: 'synthetic', roles: ['mecanico'], secret: 'discarded' })); };
  try {
    await assert.rejects(o.session.requestTechnical('outside', 'session'), /no permitido/); assert.equal(calls, 0);
    const result = await o.session.requestTechnical('employees', 'session'); assert.equal('secret' in result, false);
    globalThis.fetch = async () => new Response('', { status: 403 });
    await assert.rejects(o.session.requestTechnical('operations', 'admin'), /403/); assert.equal(o.session.snapshot().authenticated, true);
    globalThis.fetch = async () => new Response('', { status: 401 });
    await assert.rejects(o.session.requestTechnical('operations', 'session'), /401/); assert.equal(o.session.snapshot().phase, 'error'); assert.equal(sdk.token, undefined);
  } finally { globalThis.fetch = oldFetch; o.dispose(); }
});
test('refresh failure clears SDK, blocks transport and never redirects', async () => {
  browser(); const sdk = fake(); let login = 0; sdk.login = async () => { login++; };
  const o = owner(sdk); await o.start(); sdk.updateToken = async () => { throw new Error('private sdk detail'); };
  await assert.rejects(o.session.requestTechnical('employees', 'session'), /No se pudo renovar/);
  assert.equal(o.session.snapshot().phase, 'error'); assert.equal(sdk.token, undefined); assert.equal(login, 0); o.dispose();
});
test('logout invalidates immediately, captures ID hint before clearing, late refresh cannot revive', async () => {
  browser(); const sdk = fake(); const o = owner(sdk); await o.start(); let finish;
  sdk.updateToken = () => new Promise(resolve => { finish = () => { sdk.token = 'late-unit'; sdk.authenticated = true; resolve(true); }; });
  const request = o.session.requestTechnical('employees', 'session');
  sdk.logout = async options => { assert.equal(options.logoutMethod, 'POST'); assert.equal(sdk.token, 'unit-only'); assert.equal(o.session.snapshot().authenticated, false); };
  await o.session.logout(); finish(); await assert.rejects(request, /Sesión no disponible/);
  assert.equal(o.session.snapshot().phase, 'anonymous'); assert.equal(sdk.token, undefined); o.dispose();
});
test('dispose aborts requests, removes subscriptions and invalidates snapshot without IdP logout', async () => {
  browser(); const sdk = fake(); const o = owner(sdk); await o.start(); let notices = 0; let logout = 0;
  sdk.logout = async () => { logout++; }; o.session.subscribe(() => notices++);
  o.dispose(); const count = notices; sdk.onAuthRefreshError?.(); assert.equal(notices, count); assert.equal(logout, 0); assert.equal(o.session.snapshot().authenticated, false);
});
test('malformed roles fail closed and do not confer presentation privileges', async () => {
  browser(); const sdk = fake(); sdk.tokenParsed.realm_access.roles = 'administrador';
  const o = owner(sdk); await o.start(); assert.deepEqual(o.session.snapshot().identity.roles, []); o.dispose();
});
test('periodic refresh uses 10s and validity30; failure cancels interval', async () => {
  browser(); const originalInterval = globalThis.setInterval; const originalClear = globalThis.clearInterval; let tick; let cancelled = false;
  globalThis.setInterval = (fn, delay) => { assert.equal(delay, 10000); tick = fn; return 123; };
  globalThis.clearInterval = id => { if (id === 123) cancelled = true; };
  const sdk = fake(); let count = 0; sdk.updateToken = async validity => { assert.equal(validity, 30); count++; throw new Error('private'); };
  const o = owner(sdk);
  try { await o.start(); tick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(count, 1); assert.equal(cancelled, true); assert.equal(o.session.snapshot().phase, 'error'); }
  finally { o.dispose(); globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear; }
});
test('in-flight fetch is aborted on dispose and network exceptions are sanitized', async () => {
  browser(); const sdk = fake(); const o = owner(sdk); await o.start(); const originalFetch = globalThis.fetch; let signal; let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => { signal = options.signal; signal.addEventListener('abort', () => reject(new Error('private transport detail'))); enter(); });
  try { const request = o.session.requestTechnical('employees', 'session'); await entered; o.dispose(); assert.equal(signal.aborted, true); await assert.rejects(request, /^Error: No se pudo contactar/); }
  finally { o.dispose(); globalThis.fetch = originalFetch; }
});
test('DTO fields must match requested resource and known role types', async () => {
  browser(); const sdk = fake(); const o = owner(sdk); await o.start(); const originalFetch = globalThis.fetch;
  try {
    for (const body of [{ service: 'operations', resource: 'session', subject: 'x', roles: [] }, { service: 'employees', resource: 'session', subject: 'x', roles: ['unknown'] }, { service: 'employees', resource: 'session', subject: 7, roles: [] }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body)); await assert.rejects(o.session.requestTechnical('employees', 'session'), /inválida/);
    }
  } finally { globalThis.fetch = originalFetch; o.dispose(); }
});
test('logout keeps SDK hint until deferred consumer teardown and late refresh settle', async () => {
  browser(); const sdk = fake(); const o = owner(sdk); await o.start(); let refreshEnd; let teardownEnd;
  sdk.updateToken = () => new Promise(resolve => { refreshEnd = resolve; });
  sdk.logout = () => new Promise(resolve => { teardownEnd = () => { assert.equal(sdk.token, 'unit-only'); resolve(); }; });
  const request = o.session.requestTechnical('employees', 'session'); const logout = o.session.logout(); refreshEnd(false);
  await assert.rejects(request, /Sesión no disponible/); assert.equal(o.session.snapshot().authenticated, false); teardownEnd(); await logout; assert.equal(sdk.token, undefined); o.dispose();
});
test('subscriber logout during startup cannot install a new refresh timer', async () => {
  browser(); const sdk = fake(); const o = owner(sdk); const originalInterval = globalThis.setInterval; let timers = 0; let logout;
  globalThis.setInterval = () => { timers++; return 123; };
  o.session.subscribe(snapshot => { if (snapshot.authenticated) logout = o.session.logout(); });
  try { await o.start(); await logout; assert.equal(timers, 0); assert.equal(o.session.snapshot().phase, 'anonymous'); }
  finally { o.dispose(); globalThis.setInterval = originalInterval; }
});
