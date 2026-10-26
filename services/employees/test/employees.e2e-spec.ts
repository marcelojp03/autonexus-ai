import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AccessTokenVerifier } from '../src/infrastructure/auth/access-token-verifier.js';
import { authEnvironment } from '../src/infrastructure/config/auth-environment.js';
import { configureHttp } from '../src/infrastructure/http/configure-http.js';
import { PostgresEmployeeRepository } from '../src/infrastructure/postgres/postgres-employee-repository.js';
import { PostgresReadinessProbe } from '../src/infrastructure/postgres/postgres-readiness-probe.js';
import { EmployeeError } from '../src/domain/employee.js';
describe('CU03 HTTP authorization (synthetic RSA; explicit fake repository)', () => {
  let app: NestExpressApplication, admin: string, mechanic: string;
  const routes = [
    ['get', '/employees'],
    ['get', '/employees/11111111-1111-4111-8111-111111111111'],
    ['get', '/employees/11111111-1111-4111-8111-111111111111/history'],
    ['post', '/employees'],
    ['put', '/employees/11111111-1111-4111-8111-111111111111'],
    ['post', '/employees/11111111-1111-4111-8111-111111111111/deactivate'],
    ['post', '/employees/11111111-1111-4111-8111-111111111111/access/retry'],
  ] as const;
  const list = vi.fn(async () => ({
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  }));
  beforeAll(async () => {
    const keys = await generateKeyPair('RS256'),
      config = authEnvironment({});
    const token = (role: string) =>
      new SignJWT({
        iss: config.issuer,
        aud: config.audience,
        sub: 'synthetic-admin',
        typ: 'Bearer',
        exp: Math.floor(Date.now() / 1000) + 300,
        realm_access: { roles: [role] },
      })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(keys.privateKey);
    admin = await token('administrador');
    mechanic = await token('mecanico');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccessTokenVerifier)
      .useValue(
        new AccessTokenVerifier(
          config,
          createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }),
        ),
      )
      .overrideProvider(PostgresReadinessProbe)
      .useValue({ check: async () => undefined })
      .overrideProvider(PostgresEmployeeRepository)
      .useValue({ list })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureHttp(app, config);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  it.each(routes)(
    'requires session and administrator for %s %s',
    async (method, path) => {
      await request(app.getHttpServer())
        [method](path)
        .expect(401)
        .expect({ statusCode: 401, message: 'Unauthorized' });
      await request(app.getHttpServer())
        [method](path)
        .set('Authorization', 'Bearer ' + mechanic)
        .expect(403)
        .expect({ statusCode: 403, message: 'Forbidden' });
    },
  );
  it('serves authorized list, rejects invalid queries before persistence', async () => {
    await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', 'Bearer ' + admin)
      .expect(200)
      .expect({ items: [], total: 0, limit: 20, offset: 0 });
    for (const path of [
      '/employees?limit=1&limit=2',
      '/employees?unknown=x',
      '/employees?limit=1.5',
    ])
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer ' + admin)
        .expect(400);
  });
  it('sanitizes persistence failures', async () => {
    list.mockRejectedValueOnce(
      new EmployeeError(503, 'PERSISTENCE_UNAVAILABLE'),
    );
    await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', 'Bearer ' + admin)
      .expect(503)
      .expect({
        statusCode: 503,
        message: 'Service unavailable',
        code: 'PERSISTENCE_UNAVAILABLE',
      });
  });
  it('does not expose deletion', async () => {
    await request(app.getHttpServer())
      .delete('/employees/11111111-1111-4111-8111-111111111111')
      .set('Authorization', 'Bearer ' + admin)
      .expect(404);
  });
});
