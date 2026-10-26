import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
const issuer = 'http://127.0.0.1:8180/realms/autonexus';
const client = 'autonexus-shell';
const redirect = 'http://127.0.0.1:4200/auth/callback';
const request = (url, options = {}) =>
  fetch(url, {
    ...options,
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  });
const formPost = (url, values, extra = {}) =>
  request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(extra.headers ?? {}),
    },
    body: new URLSearchParams(values),
  });

export async function authorize(fixture, wrongPassword = false) {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  const query = new URLSearchParams({
    client_id: client,
    redirect_uri: redirect,
    response_type: 'code',
    response_mode: 'fragment',
    scope: 'openid profile',
    state,
    nonce: randomBytes(24).toString('base64url'),
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const response = await request(
    issuer + '/protocol/openid-connect/auth?' + query,
  );
  assert.equal(response.status, 200, 'Authorization form unavailable.');
  const html = await response.text();
  const match = html.match(/<form\b[^>]*\baction="([^"]+)"/i);
  assert.ok(match, 'Authorization form not found.');
  const action = new URL(match[1].replaceAll('&amp;', '&'));
  assert.equal(action.origin, 'http://127.0.0.1:8180');
  assert.ok(action.pathname.startsWith('/realms/autonexus/login-actions/'));
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const posted = await formPost(
    action,
    {
      username: fixture.username,
      password: wrongPassword
        ? fixture.password + randomBytes(8).toString('hex')
        : fixture.password,
      credentialId: '',
    },
    { headers: { Cookie: cookies } },
  );
  if (wrongPassword || !fixture.enabled) {
    assert.equal(
      posted.status,
      200,
      'Rejected login must remain on the login form.',
    );
    assert.equal(posted.headers.get('location'), null);
    assert.ok(
      (await posted.text()).includes('kc-login'),
      'Rejected login must not authorize.',
    );
    return null;
  }
  assert.equal(posted.status, 302, 'Active account did not authorize.');
  const callback = new URL(posted.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, redirect);
  const parameters = new URLSearchParams(callback.hash.slice(1));
  assert.equal(parameters.get('state'), state);
  assert.ok(parameters.get('code'), 'Authorization code missing.');
  const exchanged = await formPost(issuer + '/protocol/openid-connect/token', {
    grant_type: 'authorization_code',
    client_id: client,
    redirect_uri: redirect,
    code: parameters.get('code'),
    code_verifier: verifier,
  });
  assert.equal(exchanged.status, 200, 'PKCE token exchange failed.');
  const tokens = await exchanged.json();
  assert.equal(tokens.token_type?.toLowerCase(), 'bearer');
  assert.ok(
    typeof tokens.access_token === 'string' &&
      typeof tokens.id_token === 'string' &&
      typeof tokens.refresh_token === 'string',
  );
  return tokens;
}
