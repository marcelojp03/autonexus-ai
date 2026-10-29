import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AccessTokenVerifier } from './token-verifier.js';

describe('Remote JWKS adapter (ephemeral synthetic issuer, not Keycloak)', () => {
  it('is lazy, uses only configured JWKS, caches keys and cools down unknown kids', async () => {
    const keys = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture-key', alg: 'RS256' };
    let hits = 0;
    const paths: string[] = [];
    const server = createServer((req, res) => {
      hits++;
      paths.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const internal = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const issuer = 'https://public.workshop.test/identity/realms/autonexus';
      const verifier = new AccessTokenVerifier({ issuer, jwksUri: internal + '/protocol/openid-connect/certs', audience: 'autonexus-employees-api' });
      expect(hits).toBe(0);
      async function token(kid = 'fixture-key') {
        return new SignJWT({ typ: 'Bearer' }).setIssuer(issuer).setAudience('autonexus-employees-api')
          .setSubject('fixture-subject').setExpirationTime('1m')
          .setProtectedHeader({ alg: 'RS256', kid, jku: 'http://untrusted.invalid/jwks' }).sign(keys.privateKey);
      }
      const signed = await token();
      await verifier.verify(signed);
      await verifier.verify(signed);
      expect(hits).toBe(1);
      expect(paths).toEqual(['/protocol/openid-connect/certs']);
      await expect(verifier.verify(await token('unknown-key'))).rejects.toThrow('Unauthorized');
      expect(hits).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); });
    }
  });

  it('fails closed at the configured two-second JWKS timeout', async () => {
    const keys = await generateKeyPair('RS256');
    const server = createServer(() => { /* Intentionally unresponsive external dependency. */ });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const internal = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const issuer = 'https://public.workshop.test/identity/realms/autonexus';
      const verifier = new AccessTokenVerifier({ issuer, jwksUri: internal + '/protocol/openid-connect/certs', audience: 'autonexus-employees-api' });
      const signed = await new SignJWT({ typ: 'Bearer' }).setIssuer(issuer).setAudience('autonexus-employees-api')
        .setSubject('fixture-subject').setExpirationTime('1m').setProtectedHeader({ alg: 'RS256' }).sign(keys.privateKey);
      const started = performance.now();
      await expect(verifier.verify(signed)).rejects.toThrow('Unauthorized');
      expect(performance.now() - started).toBeLessThan(5000);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); });
    }
  }, 10000);
});
