import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AccessTokenVerifier } from './access-token-verifier.js';
import { authEnvironment } from '../config/auth-environment.js';

describe('Access token validation (RSA fixtures, not real Keycloak)', () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let verifier: AccessTokenVerifier;
  const config = authEnvironment({});
  const now = Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
    verifier = new AccessTokenVerifier(config, createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }));
  });

  async function token(overrides: Record<string, unknown> = {}, key = keys.privateKey) {
    return new SignJWT({ iss: config.issuer, aud: config.audience, sub: 'synthetic-subject',
      exp: now + 60, typ: 'Bearer', realm_access: { roles: ['mecanico', 'Mecanico!', 'mecanico'] },
      ...overrides }).setProtectedHeader({ alg: 'RS256' }).sign(key);
  }

  it('accepts signed access tokens and keeps deduplicated slug realm roles', async () => {
    expect(await verifier.verify(await token())).toEqual({ subject: 'synthetic-subject', roles: ['mecanico'], permissions: [], recognized: [], clientId: undefined, scopes: [] });
  });

  it.each([
    ['wrong issuer', { iss: 'https://untrusted.invalid/realm' }],
    ['wrong audience', { aud: 'autonexus-shell' }],
    ['missing expiry', { exp: undefined }],
    ['expired', { exp: now - 10 }],
    ['future nbf', { nbf: now + 30 }],
    ['missing subject', { sub: undefined }],
    ['empty subject', { sub: '' }],
    ['missing issuer', { iss: undefined }],
    ['missing audience', { aud: undefined }],
    ['ID token even with API audience', { typ: 'ID' }],
    ['missing access token type', { typ: undefined }],
  ])('rejects %s generically', async (_name, claims) => {
    await expect(verifier.verify(await token(claims))).rejects.toThrow('Unauthorized');
  });

  it('rejects a different RSA signing key', async () => {
    const other = await generateKeyPair('RS256');
    await expect(verifier.verify(await token({}, other.privateKey))).rejects.toThrow('Unauthorized');
  });

  it('rejects malformed, none and HS256 tokens', async () => {
    const hs = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32));
    for (const value of ['malformed', 'eyJhbGciOiJub25lIn0.e30.', hs]) {
      await expect(verifier.verify(value)).rejects.toThrow('Unauthorized');
    }
  });

  it('allows only the five-second clock tolerance', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifier.verify(await token({ exp: now - 2, nbf: now + 2 }))).resolves.toBeDefined();
  });

  it('does not infer workshop roles from client roles', async () => {
    expect(await verifier.verify(await token({ realm_access: undefined,
      resource_access: { 'autonexus-employees-api': { roles: ['administrador'] } } })))
      .toEqual({ subject: 'synthetic-subject', roles: [], permissions: [], recognized: [], clientId: undefined, scopes: [] });
  });

  it('fails closed if key lookup is unavailable', async () => {
    const unavailable = new AccessTokenVerifier(config, () => Promise.reject(new Error('private details')));
    await expect(unavailable.verify(await token())).rejects.toThrow('Unauthorized');
  });
});
