import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AccessTokenVerifier } from '../src/infrastructure/auth/token-verifier.js';
import { BusinessError } from '../src/application/business-error.js';
import { HttpEmployeesGateway } from '../src/application/employees-gateway.js';
import { configureHttp } from '../src/infrastructure/http/configure-http.js';
import { bffEnvironment } from '../src/infrastructure/config/environment.js';

const PAGE = { items: [], total: 0, limit: 20, offset: 0 };
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';

describe('BFF CU03 GraphQL (synthetic RSA and explicit fake upstream)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let mechanic: string;
  let head: string;
  const gateway = {
    list: vi.fn(async () => PAGE),
    get: vi.fn(),
    history: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
    retryAccess: vi.fn(),
    reachable: vi.fn(async () => true),
    staffingEmployees: vi.fn(async () => []),
    schedule: vi.fn(),
    availability: vi.fn(),
    createShift: vi.fn(),
    updateShift: vi.fn(),
    deactivateShift: vi.fn(),
    createAbsence: vi.fn(),
    cancelAbsence: vi.fn(),
  };
  const config = bffEnvironment({}, process.cwd());

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    const token = (roles: string[]) =>
      new SignJWT({ iss: config.issuer, aud: config.audience, sub: 'synthetic-admin', typ: 'Bearer', exp: Math.floor(Date.now() / 1000) + 300, realm_access: { roles } })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(keys.privateKey);
    admin = await token(['administrador']);
    mechanic = await token(['mecanico']);
    head = await token(['jefe_taller']);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccessTokenVerifier)
      .useValue(new AccessTokenVerifier(config, createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] })))
      .overrideProvider(HttpEmployeesGateway)
      .useValue(gateway)
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureHttp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: unknown, bearer?: string) =>
    request(app.getHttpServer())
      .post('/graphql')
      .set('Content-Type', 'application/json')
      .set(bearer ? { Authorization: `Bearer ${bearer}` } : {})
      .send(body as object);

  it('exposes public health and reports upstream readiness', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'UP' });
    await request(app.getHttpServer()).get('/health/ready').expect(200).expect({ status: 'UP' });
    gateway.reachable.mockResolvedValueOnce(false);
    await request(app.getHttpServer()).get('/health/ready').expect(503).expect({ status: 'DOWN' });
  });

  it('rejects anonymous, non-administrator and malformed bearer generically', async () => {
    const body = { query: '{ employees { total } }' };
    await post(body).expect(401).expect({ statusCode: 401, message: 'Unauthorized' });
    const denied = await post(body, mechanic).expect(200);
    expect(denied.body.errors[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    await post(body, 'a.b.c').expect(401);
  });

  it('keeps employee operations administrator-only and allows the head only on staffing', async () => {
    const denied = await post({ query: '{ employees { total } }' }, head).expect(200);
    expect(denied.body.errors[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    gateway.staffingEmployees.mockResolvedValueOnce([]);
    const allowed = await post({ query: '{ staffingEmployees { id fullName } }' }, head).expect(200);
    expect(allowed.body).toEqual({ data: { staffingEmployees: [] } });
  });

  it('serves the allowlisted query and forwards the same bearer', async () => {
    const response = await post(
      { query: 'query List($limit: Int) { employees(limit: $limit) { total items { id version } } }', variables: { limit: 5 } },
      admin,
    ).expect(200);
    expect(response.body).toEqual({ data: { employees: { items: [], total: 0 } } });
    expect(gateway.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }), expect.any(String));
  });

  it.each([
    ['__schema introspection', '{ __schema { types { name } } }'],
    ['unknown root field', '{ operations { total } }'],
    ['named fragment', 'fragment F on Employee { id } query Q { employee(id: "' + EMPLOYEE_ID + '") { ...F } }'],
    ['multiple operations', 'query A { employees { total } } query B { employees { total } }'],
    ['malformed document', '{ employees { total } '],
  ])('rejects %s with a sanitized 400 body', async (_label, query) => {
    const response = await post({ query }, admin);
    expect(response.status).toBe(200);
    expect(response.body.errors[0].extensions).toEqual({ code: 'BAD_REQUEST', statusCode: 400 });
    expect(JSON.stringify(response.body)).not.toContain('operations');
  });

  it('rejects non-JSON payloads', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set('Content-Type', 'text/plain')
      .set({ Authorization: `Bearer ${admin}` })
      .send('query');
    expect(response.body.errors[0].extensions.code).toBe('BAD_REQUEST');
  });

  it('maps upstream business codes and hides internal messages', async () => {
    gateway.get.mockRejectedValueOnce(new BusinessError(409, 'VERSION_CONFLICT'));
    const response = await post({ query: '{ employee(id: "' + EMPLOYEE_ID + '") { id version } }' }, admin).expect(200);
    expect(response.body.errors[0].extensions).toEqual({ code: 'VERSION_CONFLICT', statusCode: 409 });
    gateway.list.mockRejectedValueOnce(new Error('internal-upstream-detail'));
    const failure = await post({ query: '{ employees { total } }' }, admin).expect(200);
    expect(failure.body.errors[0].extensions).toEqual({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    expect(JSON.stringify(failure.body)).not.toContain('internal-upstream-detail');
  });
});
