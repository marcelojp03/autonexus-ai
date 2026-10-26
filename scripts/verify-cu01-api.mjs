/** Real local Code+PKCE/HTTP acceptance probe, NOT browser/SSO evidence.
 * Credentials and issued tokens stay in this process; response bodies never logged.
 * Start IdP and both services first, then: node scripts/verify-cu01-api.mjs
 */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const issuer = 'http://127.0.0.1:8180/realms/autonexus';
const client = 'autonexus-shell';
const redirect = 'http://127.0.0.1:4200/auth/callback';
const services = { operations: 'http://127.0.0.1:8081', employees: 'http://127.0.0.1:3002' };
const results = [];
const request = (url, options = {}) => fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(8000) });
const formPost = (url, values, extra = {}) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(extra.headers ?? {}) }, body: new URLSearchParams(values) });
const payload = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
function record(check, details = {}) { results.push({ check, pass: true, ...details }); console.log(JSON.stringify(results.at(-1))); }

async function authorize(fixture, wrongPassword = false) {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const query = new URLSearchParams({ client_id: client, redirect_uri: redirect, response_type: 'code', response_mode: 'fragment', scope: 'openid profile', state, nonce: randomBytes(24).toString('base64url'), code_challenge: challenge, code_challenge_method: 'S256' });
  const response = await request(issuer + '/protocol/openid-connect/auth?' + query);
  assert.equal(response.status, 200, 'Authorization form unavailable.');
  const html = await response.text();
  const match = html.match(/<form\b[^>]*\baction="([^"]+)"/i);
  assert.ok(match, 'Authorization form not found.');
  const action = new URL(match[1].replaceAll('&amp;', '&'));
  assert.equal(action.origin, 'http://127.0.0.1:8180');
  assert.ok(action.pathname.startsWith('/realms/autonexus/login-actions/'));
  const cookies = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const posted = await formPost(action, { username: fixture.username, password: wrongPassword ? fixture.password + randomBytes(8).toString('hex') : fixture.password, credentialId: '' }, { headers: { Cookie: cookies } });
  if (wrongPassword || !fixture.enabled) {
    assert.equal(posted.status, 200, 'Rejected login must remain on the login form.');
    assert.equal(posted.headers.get('location'), null);
    assert.ok((await posted.text()).includes('kc-login'), 'Rejected login must not authorize.');
    return null;
  }
  assert.equal(posted.status, 302, 'Active account did not authorize.');
  const callback = new URL(posted.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, redirect);
  const parameters = new URLSearchParams(callback.hash.slice(1));
  assert.equal(parameters.get('state'), state);
  assert.ok(parameters.get('code'), 'Authorization code missing.');
  const exchanged = await formPost(issuer + '/protocol/openid-connect/token', { grant_type: 'authorization_code', client_id: client, redirect_uri: redirect, code: parameters.get('code'), code_verifier: verifier });
  assert.equal(exchanged.status, 200, 'PKCE token exchange failed.');
  const tokens = await exchanged.json();
  assert.equal(tokens.token_type?.toLowerCase(), 'bearer');
  assert.ok(typeof tokens.access_token === 'string' && typeof tokens.id_token === 'string' && typeof tokens.refresh_token === 'string');
  return tokens;
}

async function resource(service, path, token, expected) {
  const response = await request(services[service] + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  assert.equal(response.status, expected, 'Unexpected protected resource status.');
  const body = await response.text();
  assert.ok(!/eyJ[A-Za-z0-9_-]+\.|stacktrace|DB_PASSWORD|jdbc:/i.test(body), 'Response exposed sensitive details.');
  if (expected === 200 && path === '/technical/session') {
    const parsed = JSON.parse(body);
    assert.deepEqual(Object.keys(parsed).sort(), ['resource', 'roles', 'service', 'subject']);
    assert.equal(parsed.service, service);
    assert.equal(parsed.resource, 'session');
    assert.ok(typeof parsed.subject === 'string' && Array.isArray(parsed.roles));
  }
  if (expected === 200 && path === '/technical/admin') assert.deepEqual(JSON.parse(body), { resource: 'admin', service, authorized: true });
}

try {
  const accounts = JSON.parse(readFileSync(new URL('../infra/keycloak/.local/test-accounts.json', import.meta.url), 'utf8'));
  const account = key => {
    const value = accounts.find(item => item.key === key);
    assert.ok(value && typeof value.username === 'string' && typeof value.password === 'string', 'Private account fixture missing.');
    return value;
  };
  for (const service of Object.keys(services)) {
    const health = service === 'operations' ? '/actuator/health/' : '/health/';
    for (const suffix of service === 'operations' ? ['liveness', 'readiness'] : ['live', 'ready']) {
      const response = await request(services[service] + health + suffix);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'UP' });
    }
    await resource(service, '/technical/session', null, 401);
    await resource(service, '/technical/session', 'invalid', 401);
    const allowed = await request(services[service] + '/technical/session', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4200', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4200');
    assert.notEqual(allowed.headers.get('access-control-allow-credentials'), 'true');
    const foreign = await request(services[service] + '/technical/session', { method: 'OPTIONS', headers: { Origin: 'https://untrusted.invalid', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    assert.notEqual(foreign.headers.get('access-control-allow-origin'), 'https://untrusted.invalid');
    record('public-health-anonymous-invalid-cors', { service });
  }
  await authorize(account('mecanico'), true); record('incorrect-credentials-rejected');
  await authorize(account('deshabilitado')); record('disabled-account-rejected');
  let retained;
  for (const key of ['administrador', 'mecanico', 'sin_rol']) {
    const tokens = await authorize(account(key));
    const claims = payload(tokens.access_token);
    assert.equal(claims.iss, issuer);
    assert.equal(claims.typ, 'Bearer');
    assert.ok(claims.exp > claims.iat && claims.exp - claims.iat <= 60);
    for (const service of Object.keys(services)) {
      assert.ok([claims.aud].flat().includes('autonexus-' + service + '-api'));
      await resource(service, '/technical/session', tokens.access_token, key === 'sin_rol' ? 403 : 200);
      await resource(service, '/technical/admin', tokens.access_token, key === 'administrador' ? 200 : 403);
      await resource(service, '/technical/session', tokens.id_token, 401);
      const parts = tokens.access_token.split('.');
      parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
      await resource(service, '/technical/session', parts.join('.'), 401);
    }
    record('real-keycloak-access-rbac-idtoken-altered-signature', { accountRole: key });
    if (key === 'mecanico') retained = tokens;
  }
  const refreshed = await formPost(issuer + '/protocol/openid-connect/token', { grant_type: 'refresh_token', client_id: client, refresh_token: retained.refresh_token });
  assert.equal(refreshed.status, 200);
  const fresh = await refreshed.json();
  for (const service of Object.keys(services)) await resource(service, '/technical/session', fresh.access_token, 200);
  record('real-token-endpoint-refresh');
  const logout = await formPost(issuer + '/protocol/openid-connect/logout', { client_id: client, id_token_hint: fresh.id_token, post_logout_redirect_uri: 'http://127.0.0.1:4200/' });
  assert.ok([200, 302, 303].includes(logout.status), 'OIDC logout failed.');
  const deniedRefresh = await formPost(issuer + '/protocol/openid-connect/token', { grant_type: 'refresh_token', client_id: client, refresh_token: fresh.refresh_token });
  assert.equal(deniedRefresh.status, 400, 'Logout did not prevent refresh.');
  for (const service of Object.keys(services)) await resource(service, '/technical/session', fresh.access_token, 200);
  record('logout-rejects-refresh-but-issued-jwt-still-valid');
  // Run this acceptance command detached, not as a blocking interactive tool wait.
  const until = payload(fresh.access_token).exp * 1000 + 6000;
  while (Date.now() < until) await new Promise(resolve => setTimeout(resolve, Math.min(10000, until - Date.now())));
  for (const service of Object.keys(services)) await resource(service, '/technical/session', fresh.access_token, 401);
  retained = null;
  record('issued-jwt-rejected-after-expiry-and-clock-tolerance');
  console.log(JSON.stringify({ pass: true, checks: results.length, evidence: 'real-Keycloak-and-HTTP-not-browser' }));
} catch {
  console.error(JSON.stringify({ pass: false, completedChecks: results.length, message: 'CU01 API acceptance failed. Sensitive request/response values suppressed.' }));
  process.exitCode = 1;
}
