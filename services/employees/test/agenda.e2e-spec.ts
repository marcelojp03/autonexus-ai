import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AuthorizeActor } from '../src/application/authorize-actor.js';
import { AccessTokenVerifier } from '../src/infrastructure/auth/access-token-verifier.js';
import { authEnvironment } from '../src/infrastructure/config/auth-environment.js';
import { PostgresAgendaRepository } from '../src/infrastructure/postgres/postgres-agenda-repository.js';
import { PostgresReadinessProbe } from '../src/infrastructure/postgres/postgres-readiness-probe.js';
import type { AgendaActor, AssignmentCheck } from '../src/domain/agenda.js';
import { EmployeeError, type PageQuery } from '../src/domain/employee.js';

const id = '11111111-1111-4111-8111-111111111111',
  foreign = '22222222-2222-4222-8222-222222222222',
  missing = '33333333-3333-4333-8333-333333333333',
  legacy = '44444444-4444-4444-8444-444444444444';
const item: AssignmentCheck = {
  assignmentId: id,
  sagaId: id,
  orderId: id,
  employeeId: id,
  fullName: 'Ana Perez',
  employeeStatus: 'active',
  startsAt: '2026-10-28T12:00:00.000Z',
  endsAt: '2026-10-28T13:00:00.000Z',
  status: 'confirmed',
  version: 2,
  orderConfirmedObserved: false,
};
const expectedActor: AgendaActor = {
  employeeId: id,
  fullName: 'Ana Perez',
  status: 'active',
  scopes: ['self'],
};
describe('CU05 HTTP with signed RSA JWTs and explicit repository doubles (no real IdP/SQL)', () => {
  let app: NestExpressApplication,
    human: string,
    team: string,
    technical: string;
  let allowed = true,
    teamAllowed = true,
    fail = false;
  const general = vi.fn(async () => ({ permissions: [], recognized: [] }));
  const actor = vi.fn(
    async (
      subject: string,
      roles: readonly string[],
    ): Promise<AgendaActor | null> => {
      if (fail) throw new EmployeeError(503, 'PERSISTENCE_UNAVAILABLE');
      if (!allowed || subject !== 'current' || !roles.includes('custom'))
        return null;
      return {
        ...expectedActor,
        scopes:
          roles.includes('team') && teamAllowed ? ['self', 'team'] : ['self'],
      };
    },
  );
  const assignments = vi.fn(
    async (ids: readonly string[], employeeId: string | null) =>
      ids.flatMap((assignmentId) =>
        assignmentId === id
          ? [{ ...item }]
          : assignmentId === foreign && employeeId === null
            ? [
                {
                  ...item,
                  assignmentId: foreign,
                  employeeId: foreign,
                  employeeStatus: 'inactive' as const,
                },
              ]
            : [],
      ),
  );
  const employees = vi.fn(async (page: PageQuery) => ({
    items: [{ id: foreign, fullName: 'Bea Soto', status: 'inactive' }],
    total: 1,
    limit: page.limit,
    offset: page.offset,
  }));
  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    const config = authEnvironment({});
    const token = (roles: string[], azp = 'autonexus-bff', scope = 'openid') =>
      new SignJWT({
        iss: config.issuer,
        aud: config.audience,
        sub: 'current',
        typ: 'Bearer',
        exp: Math.floor(Date.now() / 1000) + 300,
        azp,
        scope,
        realm_access: { roles },
      })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(keys.privateKey);
    human = await token(['custom']);
    team = await token(['custom', 'team']);
    technical = await token(
      [],
      'autonexus-cu15-coordinator',
      'cu15.staffing.read',
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccessTokenVerifier)
      .useValue(
        new AccessTokenVerifier(
          config,
          createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }),
        ),
      )
      .overrideProvider(AuthorizeActor)
      .useValue({ resolve: general })
      .overrideProvider(PostgresAgendaRepository)
      .useValue({ actor, assignments, employees })
      .overrideProvider(PostgresReadinessProbe)
      .useValue({ check: async () => undefined })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    await app.init();
  }, 30000);
  beforeEach(() => {
    allowed = true;
    teamAllowed = true;
    fail = false;
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await app?.close();
  });
  const get = (path: string, token = human) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer ' + token);
  const check = (assignmentIds: string[], scope = 'self', token = human) =>
    request(app.getHttpServer())
      .post('/agenda/assignments/check')
      .set('Authorization', 'Bearer ' + token)
      .send({ scope, assignmentIds });
  it('requires a verified token', async () => {
    await request(app.getHttpServer())
      .get('/agenda/context?scope=self')
      .expect(401);
    await get('/agenda/context?scope=self', 'invalid').expect(401);
  });
  it('returns exact minimal actor from current subject, with no CU02 fallback', async () => {
    const response = await get('/agenda/context?scope=self').expect(200);
    expect(Object.keys(response.body).sort()).toEqual(['actor', 'observedAt']);
    expect(response.body.actor).toEqual(expectedActor);
    expect(actor).toHaveBeenCalledWith('current', ['custom']);
    expect(general).not.toHaveBeenCalled();
    expect(response.body.observedAt).toMatch(/^[0-9]{4}-.*Z$/);
  });
  it.each([
    'inactive',
    'unlinked',
    'old-subject-assignment',
    'revoked',
    'no-permission',
  ])('denies %s on next request with unchanged JWT', async () => {
    await get('/agenda/context?scope=self').expect(200);
    allowed = false;
    const response = await get('/agenda/context?scope=self').expect(403);
    expect(response.body.code).toBe('AGENDA_ACCESS_DENIED');
    expect(response.body.actor).toBeUndefined();
    expect(actor).toHaveBeenCalledTimes(2);
  });
  it('revokes team access next request despite JWT and general permissions', async () => {
    await get('/agenda/context?scope=team', team).expect(200);
    teamAllowed = false;
    expect(
      (await get('/agenda/context?scope=team', team).expect(403)).body.code,
    ).toBe('AGENDA_ACCESS_DENIED');
    expect(general).not.toHaveBeenCalled();
  });
  it.each([
    '/agenda/context',
    '/agenda/context?scope=own',
    '/agenda/context?scope=self&scope=team',
    '/agenda/context?scope=self&employeeId=' + foreign,
    '/agenda/team/employees?status=all',
    '/agenda/team/employees?status=active&status=inactive',
    '/agenda/team/employees?limit=101',
    '/agenda/team/employees?offset=2147483648',
    '/agenda/team/employees?search=a&search=b',
    '/agenda/team/employees?unknown=1',
  ])('rejects closed/duplicate/invalid query %s', async (path) => {
    expect((await get(path, team).expect(400)).body.code).toBe(
      'VALIDATION_ERROR',
    );
  });
  it('keeps selector team-only and minimum historical inactive DTO', async () => {
    expect((await get('/agenda/team/employees').expect(403)).body.code).toBe(
      'AGENDA_ACCESS_DENIED',
    );
    expect(employees).not.toHaveBeenCalled();
    const result = await get('/agenda/team/employees', team).expect(200);
    expect(Object.keys(result.body).sort()).toEqual([
      'items',
      'limit',
      'observedAt',
      'offset',
      'total',
    ]);
    expect(result.body.items).toEqual([
      { id: foreign, fullName: 'Bea Soto', status: 'inactive' },
    ]);
    expect(employees).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });
  it('returns exact AssignmentCheck DTO and uses server employee ID', async () => {
    const response = await check([id]).expect(200);
    expect(response.body.actor).toEqual(expectedActor);
    expect(response.body.items).toEqual([item]);
    expect(Object.keys(response.body).sort()).toEqual([
      'actor',
      'items',
      'observedAt',
    ]);
    expect(assignments).toHaveBeenCalledWith([id], id);
  });
  it.each([foreign, missing, legacy])(
    'foreign/missing/legacy %s share 404 and no partial data',
    async (other) => {
      const response = await check([id, other]).expect(404);
      expect(response.body).toEqual({
        statusCode: 404,
        code: 'AGENDA_WORK_NOT_FOUND',
        message: 'Agenda request failed',
      });
    },
  );
  it('team checks historical inactive assignee, self cannot escalate scope', async () => {
    expect((await check([foreign], 'team').expect(403)).body.code).toBe(
      'AGENDA_ACCESS_DENIED',
    );
    const result = await check([foreign], 'team', team).expect(200);
    expect(result.body.items[0].employeeStatus).toBe('inactive');
    expect(assignments).toHaveBeenCalledWith([foreign], null);
  });
  it.each([
    { scope: 'self', assignmentIds: [id, id] },
    { scope: 'self', assignmentIds: Array(101).fill(id) },
    { scope: 'self', assignmentIds: [id], employeeId: foreign },
    { scope: 'self', assignmentIds: ['bad'] },
    { scope: ['self'], assignmentIds: [] },
  ])('rejects invalid check body %j', async (body) => {
    const response = await request(app.getHttpServer())
      .post('/agenda/assignments/check')
      .set('Authorization', 'Bearer ' + human)
      .send(body)
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(assignments).not.toHaveBeenCalled();
  });
  it('empty check is read-only and still authorizes', async () => {
    expect((await check([]).expect(200)).body.items).toEqual([]);
    allowed = false;
    await check([]).expect(403);
  });
  it('rejects query identity on POST', async () => {
    const result = await request(app.getHttpServer())
      .post('/agenda/assignments/check?employeeId=' + foreign)
      .set('Authorization', 'Bearer ' + human)
      .send({ scope: 'self', assignmentIds: [] })
      .expect(400);
    expect(result.body.code).toBe('VALIDATION_ERROR');
  });
  it('technical coordinator does not access human agenda or gain CRUD', async () => {
    await get('/agenda/context?scope=self', technical).expect(403);
    expect(actor).not.toHaveBeenCalled();
    await get('/employees', human).expect(403);
  });
  it('persistence failure is explicit 503, never successful empty', async () => {
    fail = true;
    const result = await get('/agenda/context?scope=self').expect(503);
    expect(result.body).toEqual({
      statusCode: 503,
      code: 'PERSISTENCE_UNAVAILABLE',
      message: 'Service unavailable',
    });
  });
});
