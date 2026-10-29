import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import { AccessTokenVerifier } from './token-verifier.js';

describe('CU05 custom role token verification', () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  const config = { issuer: 'https://identity.example.invalid/realms/test', audience: 'autonexus-employees-api' };
  beforeAll(async () => { keys = await generateKeyPair('RS256'); });
  const token = (roles: unknown, issuer = config.issuer, audience = config.audience) => new SignJWT({ typ: 'Bearer', realm_access: { roles } })
    .setProtectedHeader({ alg: 'RS256' }).setSubject('synthetic-custom-role')
    .setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('60s').sign(keys.privateKey);
  const verifier = () => new AccessTokenVerifier(config, async () => keys.publicKey);

  it('preserves a custom-only role without granting permissions locally', async () => {
    const identity = await verifier().verify(await token(['agenda_custom', 'agenda_custom', 'Bad!', 'default-roles-test', 42]));
    expect(identity).toEqual({ subject: 'synthetic-custom-role', roles: ['agenda_custom'] });
    expect(Object.isFrozen(identity.roles)).toBe(true);
  });
  it('retains initial roles and discards malformed role claims', async () => {
    expect((await verifier().verify(await token(['administrador', 'mecanico']))).roles).toEqual(['administrador', 'mecanico']);
    expect((await verifier().verify(await token('agenda_custom'))).roles).toEqual([]);
  });
  it('still rejects a wrong issuer or audience', async () => {
    await expect(verifier().verify(await token(['agenda_custom'], 'https://other.example.invalid'))).rejects.toThrow('Unauthorized');
    await expect(verifier().verify(await token(['agenda_custom'], config.issuer, 'other-api'))).rejects.toThrow('Unauthorized');
  });
});
