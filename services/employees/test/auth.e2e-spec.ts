import 'reflect-metadata';
import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AccessTokenVerifier } from '../src/infrastructure/auth/access-token-verifier.js';
import { authEnvironment } from '../src/infrastructure/config/auth-environment.js';
import { configureHttp } from '../src/infrastructure/http/configure-http.js';
import { PostgresReadinessProbe } from '../src/infrastructure/postgres/postgres-readiness-probe.js';

@Controller('future')
class UnconfiguredController {
  @Get()
  get() { return { mustNotBeReached: true }; }
}

describe('CU01 HTTP (signed RSA fixtures and fake DB, not Keycloak integration)', () => {
  let app: NestExpressApplication;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  const config = authEnvironment({});
  const check = vi.fn<() => Promise<void>>();
  let lookup: ReturnType<typeof vi.fn<JWTVerifyGetKey>>;

  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
    lookup = vi.fn(createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }));
    const module = await Test.createTestingModule({ imports: [AppModule], controllers: [UnconfiguredController] })
      .overrideProvider(PostgresReadinessProbe).useValue({ check })
      .overrideProvider(AccessTokenVerifier).useValue(new AccessTokenVerifier(config, lookup))
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureHttp(app, config);
    await app.init();
  });

  afterAll(async () => { await app.close(); });

  async function token(roles: string[] = ['mecanico'], overrides: Record<string, unknown> = {}) {
    return new SignJWT({ iss: config.issuer, aud: config.audience, sub: 'synthetic-subject',
      typ: 'Bearer', exp: Math.floor(Date.now() / 1000) + 60, realm_access: { roles }, ...overrides })
      .setProtectedHeader({ alg: 'RS256' }).sign(keys.privateKey);
  }

  it('keeps both health endpoints public without any key lookup', async () => {
    check.mockResolvedValue(undefined);
    lookup.mockClear();
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'UP' });
    await request(app.getHttpServer()).get('/health/ready').expect(200).expect({ status: 'UP' });
    check.mockRejectedValueOnce(new Error('private DB details'));
    await request(app.getHttpServer()).get('/health/ready').expect(503).expect({ status: 'DOWN' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns generic 401 without bearer and ignores cookies/query', async () => {
    const bearer = await token();
    const response = await request(app.getHttpServer()).get('/technical/session')
      .query({ access_token: bearer }).set('Cookie', 'access_token=' + bearer);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
  });

  it('rejects altered signatures and duplicate bearer headers generically', async () => {
    const signed = await token();
    const segments = signed.split('.');
    segments[2] = (segments[2][0] === 'A' ? 'B' : 'A') + segments[2].slice(1);
    const altered = await request(app.getHttpServer()).get('/technical/session')
      .set('Authorization', 'Bearer ' + segments.join('.'));
    expect(altered.status).toBe(401);
    expect(altered.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    const duplicated = await request(app.getHttpServer()).get('/technical/session')
      .set({ Authorization: ['Bearer ' + signed, 'Bearer ' + signed] });
    expect(duplicated.status).toBe(401);
    expect(duplicated.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
  });

  it.each(['malformed', 'Basic anything', 'Bearer malformed', 'Bearer a.b.c, Bearer d.e.f', 'Bearer  a.b.c'])
    ('rejects malformed authorization %s', async (header) => {
      const response = await request(app.getHttpServer()).get('/technical/session').set('Authorization', header);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    });

  it.each(['administrador', 'recepcionista', 'mecanico', 'jefe_taller', 'responsable_financiero'])
    ('accepts each recognized realm role %s with exact DTO', async (role) => {
      const response = await request(app.getHttpServer()).get('/technical/session')
        .set('Authorization', 'Bearer ' + await token([role, 'unknown']));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ resource: 'session', service: 'employees', subject: 'synthetic-subject', roles: [role] });
    });

  it('returns generic 403 for a valid identity without recognized role', async () => {
    const response = await request(app.getHttpServer()).get('/technical/session')
      .set('Authorization', 'Bearer ' + await token(['unknown']));
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ statusCode: 403, message: 'Forbidden' });
  });

  it('requires administrador only on the technical admin resource', async () => {
    const denied = await request(app.getHttpServer()).get('/technical/admin')
      .set('Authorization', 'Bearer ' + await token());
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ statusCode: 403, message: 'Forbidden' });
    const allowed = await request(app.getHttpServer()).get('/technical/admin')
      .set('Authorization', 'Bearer ' + await token(['administrador']));
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ resource: 'admin', service: 'employees', authorized: true });
  });

  it('denies future endpoints lacking policy even for administrador', async () => {
    await request(app.getHttpServer()).get('/future').expect(401);
    const response = await request(app.getHttpServer()).get('/future')
      .set('Authorization', 'Bearer ' + await token(['administrador']));
    expect(response.status).toBe(403);
  });

  it.each([{ typ: 'ID' }, { aud: 'autonexus-shell' }, { iss: 'https://untrusted.invalid' },
    { exp: undefined }, { exp: 1 }, { nbf: 9999999999 }])
    ('sanitizes invalid signed claims %#', async (claims) => {
      const response = await request(app.getHttpServer()).get('/technical/session')
        .set('Authorization', 'Bearer ' + await token(['administrador'], claims));
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    });

  it.each(config.origins)('permits only explicit CORS origin %s without credentials', async (origin) => {
    const response = await request(app.getHttpServer()).options('/technical/session')
      .set('Origin', origin).set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Authorization');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-methods']).toBe('GET,OPTIONS');
    expect(response.headers['access-control-allow-headers']).toBe('Authorization');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it.each(['http://localhost:4200', 'https://untrusted.invalid', 'null', 'http://127.0.0.1:4203'])
    ('does not reflect unauthorized CORS origin %s', async (origin) => {
      const response = await request(app.getHttpServer()).get('/technical/session').set('Origin', origin);
      expect(response.status).toBe(401);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
});
