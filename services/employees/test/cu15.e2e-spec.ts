import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthorizeActor } from '../src/application/authorize-actor.js';
import { AccessTokenVerifier } from '../src/infrastructure/auth/access-token-verifier.js';
import { authEnvironment } from '../src/infrastructure/config/auth-environment.js';
import { configureHttp } from '../src/infrastructure/http/configure-http.js';
import { PostgresAssignmentRepository } from '../src/infrastructure/postgres/postgres-assignment-repository.js';
import { PostgresMechanicProjection } from '../src/infrastructure/postgres/postgres-mechanic-projection.js';
import { PostgresReadinessProbe } from '../src/infrastructure/postgres/postgres-readiness-probe.js';
import {
  CU15_CLIENT,
  digest,
  type AssignmentCommand,
  type CommandBody,
} from '../src/domain/assignment.js';
import { EmployeeError } from '../src/domain/employee.js';
const id = '11111111-1111-4111-8111-111111111111';
const common = {
  operationId: id,
  expectedVersion: 0,
  initiatedBy: 'human',
  authorizedAt: '2026-10-28T12:00:00.000Z',
};
describe('CU15 HTTP contract (signed RSA fixtures, explicit repository/authorization fakes)', () => {
  let app: NestExpressApplication,
    technical: string,
    human: string,
    wrongScope: string,
    wrongClient: string;
  const authorize = vi.fn(async () => ({
    permissions: ['confirmations:read'],
    recognized: ['jefe_taller'],
  }));
  const execute = vi.fn(
    async (
      sagaId: string,
      command: AssignmentCommand,
      body: CommandBody,
      clientId: string,
    ) => ({
      operationId: body.operationId,
      sagaId,
      command,
      fingerprint: digest({ clientId, command, sagaId, body }),
      outcome: 'rejected',
      resource: null,
      errorCode: 'MECHANIC_NOT_ENABLED',
      committedAt: '2026-10-28T12:00:00.000Z',
      replayed: false,
    }),
  );
  const page = vi.fn(async () => ({
    items: [
      {
        id,
        fullName: 'Ana Perez',
        jobTitle: 'Mecánica',
        status: 'inactive',
        version: 2,
        mechanicEnabled: false,
        specialties: [],
        eligible: false,
        eligibilityReasons: [
          'EMPLOYEE_INACTIVE',
          'MECHANIC_NOT_ENABLED',
          'SPECIALTY_REQUIRED',
        ],
      },
    ],
    total: 1,
    limit: 20,
    offset: 0,
  }));
  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    const config = authEnvironment({});
    const token = (azp: string, scope: string, roles: string[] = []) =>
      new SignJWT({
        iss: config.issuer,
        aud: config.audience,
        sub: 'synthetic-subject',
        typ: 'Bearer',
        exp: Math.floor(Date.now() / 1000) + 300,
        azp,
        scope,
        realm_access: { roles },
      })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(keys.privateKey);
    technical = await token(
      CU15_CLIENT,
      'cu15.staffing.reserve cu15.staffing.read cu15.staffing.confirm cu15.staffing.release',
    );
    human = await token('autonexus-bff', 'openid', ['jefe_taller']);
    wrongScope = await token(CU15_CLIENT, 'openid');
    wrongClient = await token('other-service', 'cu15.staffing.reserve');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccessTokenVerifier)
      .useValue(
        new AccessTokenVerifier(
          config,
          createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }),
        ),
      )
      .overrideProvider(AuthorizeActor)
      .useValue({ resolve: authorize })
      .overrideProvider(PostgresReadinessProbe)
      .useValue({ check: async () => undefined })
      .overrideProvider(PostgresAssignmentRepository)
      .useValue({
        execute,
        get: async () => ({
          sagaId: id,
          status: 'released',
          version: 1,
          tombstone: true,
        }),
        operation: async () => {
          throw new EmployeeError(404, 'OPERATION_NOT_FOUND');
        },
      })
      .overrideProvider(PostgresMechanicProjection)
      .useValue({ page })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureHttp(app, config);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    execute.mockClear();
    authorize.mockClear();
    page.mockClear();
  });
  const reserve = {
    ...common,
    orderId: id,
    employeeId: id,
    employeeVersion: 1,
    requiredSpecialty: 'Motor',
    startsAt: '2099-10-28T09:00:00-04:00',
    endsAt: '2099-10-28T10:00:00-04:00',
  };
  it('keeps rejected command envelopes at HTTP409 and normalizes before fingerprint', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/cu15/assignments/' + id + '/reserve')
      .auth(technical, { type: 'bearer' })
      .send(reserve)
      .expect(409);
    expect(response.body).toMatchObject({
      operationId: id,
      sagaId: id,
      command: 'reserve_assignment',
      outcome: 'rejected',
      errorCode: 'MECHANIC_NOT_ENABLED',
      resource: null,
      replayed: false,
    });
    expect(execute).toHaveBeenCalledWith(
      id,
      'reserve_assignment',
      expect.objectContaining({ startsAt: '2099-10-28T13:00:00.000Z' }),
      CU15_CLIENT,
    );
    expect(authorize).not.toHaveBeenCalled();
  });
  it.each(['confirm', 'release'])(
    'binds exact %s command route',
    async (action) => {
      await request(app.getHttpServer())
        .post('/internal/cu15/assignments/' + id + '/' + action)
        .auth(technical, { type: 'bearer' })
        .send({
          ...common,
          expectedVersion: 1,
          ...(action === 'release' ? { reasonCode: 'COMPENSATION' } : {}),
        })
        .expect(409);
      expect(execute.mock.calls[0]?.[1]).toBe(action + '_assignment');
    },
  );
  it.each(['human', 'wrongScope', 'wrongClient', 'anonymous'])(
    'rejects %s from technical writes before human lookup',
    async (name) => {
      let call = request(app.getHttpServer()).post(
        '/internal/cu15/assignments/' + id + '/reserve',
      );
      if (name !== 'anonymous')
        call = call.auth(
          name === 'human'
            ? human
            : name === 'wrongScope'
              ? wrongScope
              : wrongClient,
          { type: 'bearer' },
        );
      await call.send(reserve).expect(name === 'anonymous' ? 401 : 403);
      expect(execute).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
    },
  );
  it('rejects malformed commands with standard validation errors, not durable rejection', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/cu15/assignments/' + id + '/reserve')
      .auth(technical, { type: 'bearer' })
      .send({ ...reserve, token: 'untrusted' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.outcome).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });
  it('returns tombstones directly and operation404 as unknown', async () => {
    await request(app.getHttpServer())
      .get('/internal/cu15/assignments/' + id)
      .auth(technical, { type: 'bearer' })
      .expect(200)
      .expect({ sagaId: id, status: 'released', version: 1, tombstone: true });
    const result = await request(app.getHttpServer())
      .get('/internal/cu15/operations/' + id)
      .auth(technical, { type: 'bearer' })
      .expect(404);
    expect(result.body.code).toBe('OPERATION_NOT_FOUND');
    expect(result.body.outcome).toBeUndefined();
  });
  it('denies technical identity on human CRUD and projections without querying human permissions', async () => {
    await request(app.getHttpServer())
      .get('/employees')
      .auth(technical, { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/staffing/mechanics')
      .auth(technical, { type: 'bearer' })
      .expect(403);
    expect(authorize).not.toHaveBeenCalled();
  });
  it('serves all human candidates with explanations, closed fields and pagination', async () => {
    const response = await request(app.getHttpServer())
      .get('/staffing/mechanics?search=Ana')
      .auth(human, { type: 'bearer' })
      .expect(200);
    expect(response.body.items[0]).toMatchObject({
      eligible: false,
      mechanicEnabled: false,
      version: 2,
    });
    expect(page).toHaveBeenCalledWith({ search: 'Ana', limit: 20, offset: 0 });
    await request(app.getHttpServer())
      .get('/staffing/mechanics?status=active')
      .auth(human, { type: 'bearer' })
      .expect(400);
  });
});
