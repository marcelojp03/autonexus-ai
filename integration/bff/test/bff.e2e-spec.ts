import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AccessTokenVerifier } from '../src/infrastructure/auth/token-verifier.js';
import { BusinessError } from '../src/application/business-error.js';
import { HttpEmployeesGateway } from '../src/application/employees-gateway.js';
import { HttpOperationsGateway } from '../src/application/operations-gateway.js';
import { configureHttp } from '../src/infrastructure/http/configure-http.js';
import { bffEnvironment } from '../src/infrastructure/config/environment.js';
import { HttpAgendaGateway } from '../src/application/agenda-gateway.js';
import { PAGE as AGENDA_PAGE, WORK as AGENDA_WORK, EMPLOYEES_PAGE as AGENDA_EMPLOYEES, ID as ASSIGNMENT_ID, WORK_FIELDS } from './agenda-fixtures.js';

const PAGE = { items: [], total: 0, limit: 20, offset: 0 };
const ALL = [
  'employees:read', 'employees:write', 'schedules:read', 'schedules:write', 'security:read', 'security:write',
  'customers:read', 'customers:write', 'vehicles:read', 'vehicles:write',
  'catalog:read', 'catalog:write', 'appointments:read', 'appointments:write',
  'receptions:read', 'receptions:write', 'orders:read', 'orders:write',
  'quotes:read', 'quotes:write', 'quotes:decide',
  'confirmations:read', 'confirmations:write',
  'agenda:read:self', 'agenda:read:team',
  'executions:read:self', 'executions:read:team', 'executions:write',
];
/** Mirrors the owner resolution: realm roles plus persisted assignments. */
const effectiveFor = (bearer: string): string[] => {
  try {
    const payload = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()) as { realm_access?: { roles?: string[] } };
    const roles = payload.realm_access?.roles ?? [];
    if (roles.includes('administrador')) return ALL;
    if (roles.includes('jefe_taller')) return ['schedules:read', 'schedules:write', 'confirmations:read', 'confirmations:write', 'executions:read:self', 'executions:read:team'];
    if (roles.includes('mecanico')) return ['executions:read:self', 'executions:write'];
    return [];
  } catch {
    return [];
  }
};
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';

describe('BFF CU03 GraphQL (synthetic RSA and explicit fake upstream)', () => {
  let app: NestExpressApplication;
  let admin: string;
  let mechanic: string;
  let head: string;
  let uncachedAdmin: string;
  const gateway = {
    confirmationMechanics: vi.fn(async () => PAGE),
    confirmationAvailability: vi.fn(),
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
    permissions: vi.fn(async (bearer: string) => ({ catalog: [], effective: effectiveFor(bearer), roles: [] })),
    securityRoles: vi.fn(async (): Promise<unknown[]> => []),
    securityRole: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    retryRoleSync: vi.fn(),
    employeeRoles: vi.fn(),
    assignRole: vi.fn(),
    revokeRole: vi.fn(),
    securityHistory: vi.fn(),
  };
  const operations = {
    confirmationSaga: vi.fn(),
    confirmationByOperation: vi.fn(),
    orderConfirmations: vi.fn(async () => []),
    startServiceConfirmation: vi.fn(),
    retryServiceConfirmation: vi.fn(),
    customers: vi.fn(async () => PAGE),
    customer: vi.fn(),
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    deactivateCustomer: vi.fn(),
    vehicles: vi.fn(async () => PAGE),
    vehicle: vi.fn(),
    createVehicle: vi.fn(),
    updateVehicle: vi.fn(),
    deactivateVehicle: vi.fn(),
    services: vi.fn(async () => PAGE),
    service: vi.fn(),
    createService: vi.fn(),
    updateService: vi.fn(),
    deactivateService: vi.fn(),
    appointments: vi.fn(async () => PAGE),
    appointment: vi.fn(),
    createAppointment: vi.fn(),
    rescheduleAppointment: vi.fn(),
    cancelAppointment: vi.fn(),
    execution: vi.fn(async () => ({ orderId: EMPLOYEE_ID, orderNumber: 'OT-HTTP', assignmentId: ASSIGNMENT_ID,
      employeeId: EMPLOYEE_ID, status: 'in_progress', startedAt: '2026-10-30T12:00:00Z', version: 1,
      advances: [], evidenceSummary: { pending: 0, available: 0, failed: 0 } })),
    startExecution: vi.fn(async () => ({ execution: { orderId: EMPLOYEE_ID, assignmentId: ASSIGNMENT_ID, status: 'in_progress', version: 1, advances: [], evidenceSummary: { pending: 0, available: 0, failed: 0 } }, replayed: false })),
    recordAdvance: vi.fn(async () => ({ execution: { orderId: EMPLOYEE_ID, assignmentId: ASSIGNMENT_ID, status: 'in_progress', version: 2, advances: [], evidenceSummary: { pending: 0, available: 0, failed: 0 } }, advance: { id: ASSIGNMENT_ID, sequence: 1 }, replayed: false })),
    requestEvidence: vi.fn(), confirmEvidence: vi.fn(), retryEvidence: vi.fn(),
    evidenceDownload: vi.fn(async () => ({ url: 'https://storage.invalid/signed', expiresAt: '2026-10-30T12:02:00Z' })),
  };
  const config = bffEnvironment({}, process.cwd());
  const agendaTransport = vi.fn<typeof fetch>().mockImplementation(async url => {
    const path = new URL(url instanceof Request ? url.url : url).pathname;
    return Response.json(path === '/agenda/team/employees' ? AGENDA_EMPLOYEES : path.endsWith(ASSIGNMENT_ID) ? AGENDA_WORK : AGENDA_PAGE);
  });

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    const token = (roles: string[], subject = 'synthetic-admin') =>
      new SignJWT({ iss: config.issuer, aud: config.audience, sub: subject, typ: 'Bearer', exp: Math.floor(Date.now() / 1000) + 300, realm_access: { roles } })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(keys.privateKey);
    admin = await token(['administrador']);
    mechanic = await token(['mecanico']);
    head = await token(['jefe_taller']);
    uncachedAdmin = await token(['administrador'], 'synthetic-admin-uncached');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AccessTokenVerifier)
      .useValue(new AccessTokenVerifier(config, createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] })))
      .overrideProvider(HttpEmployeesGateway)
      .useValue(gateway)
      .overrideProvider(HttpOperationsGateway)
      .useValue(operations)
      .overrideProvider(HttpAgendaGateway)
      .useValue(new HttpAgendaGateway(config.operationsUrl, config.employeesUrl, agendaTransport))
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureHttp(app, config);
    await app.init();
  });

  it('CU15 authorizes admin and head over HTTP without granting employee writes', async () => {
    for (const bearer of [admin, head]) {
      const response = await post({ query: '{confirmationMechanics{total} orderConfirmations(orderId:"' + EMPLOYEE_ID + '"){status}}' }, bearer).expect(200);
      expect(response.body.errors).toBeUndefined();
      expect(response.body.data).toEqual({ confirmationMechanics: { total: 0 }, orderConfirmations: [] });
    }
    const denied = await post({ query: '{confirmationMechanics{total}}' }, mechanic).expect(200);
    expect(denied.body.errors[0].extensions.code).toBe('FORBIDDEN');
    const cu03 = await post({ query: 'mutation{deactivateEmployee(id:"' + EMPLOYEE_ID + '",input:{operationId:"' + EMPLOYEE_ID + '",expectedVersion:1}){replayed}}' }, head).expect(200);
    expect(cu03.body.errors[0].extensions.code).toBe('FORBIDDEN');
  });
  it('CU15 returns pending saga directly and forwards retry body and human bearer', async () => {
    operations.retryServiceConfirmation.mockResolvedValue({ sagaId: EMPLOYEE_ID, status: 'compensation_pending', version: 6 });
    const input = { operationId: EMPLOYEE_ID, expectedVersion: 5 };
    const response = await post({ query: 'mutation($input:ConfirmationRetryInput!){retryServiceConfirmation(id:"' + EMPLOYEE_ID + '",input:$input){sagaId status version}}', variables: { input } }, head).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.retryServiceConfirmation.status).toBe('compensation_pending');
    expect(operations.retryServiceConfirmation).toHaveBeenCalledWith(EMPLOYEE_ID, input, head);
  });

  it('CU16 exposes scoped reads and versioned writes through HTTP with field permissions', async () => {
    const own = await post({ query: '{myExecution(assignmentId:"' + ASSIGNMENT_ID + '"){assignmentId status version evidenceSummary{pending available failed}}}' }, mechanic).expect(200);
    expect(own.body.errors).toBeUndefined();
    expect(operations.execution).toHaveBeenCalledWith('me', ASSIGNMENT_ID, mechanic);
    const team = await post({ query: '{teamExecution(assignmentId:"' + ASSIGNMENT_ID + '"){assignmentId status}}' }, head).expect(200);
    expect(team.body.errors).toBeUndefined();
    expect(operations.execution).toHaveBeenCalledWith('team', ASSIGNMENT_ID, head);
    const started = await post({ query: 'mutation($input:StartExecutionInput!){startExecution(assignmentId:"' + ASSIGNMENT_ID + '",input:$input){execution{assignmentId status version} replayed}}', variables: { input: { operationId: EMPLOYEE_ID } } }, mechanic).expect(200);
    expect(started.body.errors).toBeUndefined();
    expect(operations.startExecution).toHaveBeenCalledWith(ASSIGNMENT_ID, { operationId: EMPLOYEE_ID }, mechanic);
    const denied = await post({ query: 'mutation($input:RecordAdvanceInput!){recordAdvance(assignmentId:"' + ASSIGNMENT_ID + '",input:$input){advance{id}}}', variables: { input: { operationId: EMPLOYEE_ID, expectedVersion: 1, description: 'No', minutesWorked: 1 } } }, head).expect(200);
    expect(denied.body.errors[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(operations.recordAdvance).not.toHaveBeenCalled();
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

  it('serves the CU02 catalog and enforces the security policy over HTTP', async () => {
    const own = await post({ query: '{ securityCatalog { catalog { id } effective } }' }, mechanic).expect(200);
    expect(own.body.errors).toBeUndefined();
    expect(own.body.data.securityCatalog.effective).toEqual(['executions:read:self', 'executions:write']);

    const denied = await post({ query: '{ securityRoles { name } }' }, head).expect(200);
    expect(denied.body.errors[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });

    gateway.securityRoles.mockResolvedValueOnce([{ name: 'administrador', permissions: ALL, system: true, version: 1, syncStatus: 'synced', assignedCount: 0 }]);
    const allowed = await post({ query: '{ securityRoles { name permissions syncStatus } }' }, admin).expect(200);
    expect(allowed.body.data.securityRoles[0].name).toBe('administrador');
    expect(gateway.securityRoles).toHaveBeenCalledWith(admin);

    gateway.createRole.mockResolvedValueOnce({ role: { name: 'supervisor', version: 1, syncStatus: 'synced', permissions: ['schedules:read'] }, replayed: false });
    const created = await post(
      {
        query: 'mutation ($input: RoleCreateInput!) { createRole(input: $input) { role { name syncStatus } replayed } }',
        variables: { input: { operationId: EMPLOYEE_ID, name: 'supervisor', permissions: ['schedules:read'] } },
      },
      admin,
    ).expect(200);
    expect(created.body.data.createRole.role.syncStatus).toBe('synced');
    expect(gateway.createRole).toHaveBeenCalledWith(expect.objectContaining({ name: 'supervisor' }), admin);

    const forbidden = await post(
      {
        query: 'mutation ($input: RoleCreateInput!) { createRole(input: $input) { role { name } } }',
        variables: { input: { operationId: EMPLOYEE_ID, name: 'supervisor', permissions: ['security:read'] } },
      },
      head,
    ).expect(200);
    expect(forbidden.body.errors[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
  });

  it('fails closed when the permission catalog cannot be resolved', async () => {
    gateway.permissions.mockRejectedValueOnce(new BusinessError(503, 'SERVICE_UNAVAILABLE'));
    const response = await post({ query: '{ employees { total } }' }, uncachedAdmin).expect(200);
    expect(response.body.errors[0].extensions).toEqual({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
  });

  it.each([
    [403, 'FORBIDDEN', 'FORBIDDEN'],
    [403, 'AGENDA_ACCESS_DENIED', 'FORBIDDEN'],
    [401, 'UNAUTHENTICATED', 'UNAUTHENTICATED'],
    [503, 'PERSISTENCE_UNAVAILABLE', 'PERSISTENCE_UNAVAILABLE'],
    [503, 'AGENDA_DEPENDENCY_UNAVAILABLE', 'AGENDA_DEPENDENCY_UNAVAILABLE'],
    [400, 'VALIDATION_ERROR', 'VALIDATION_ERROR'],
  ] as const)('preexecute permission owner %s/%s retains the safe GraphQL envelope', async (status, code, expected) => {
    agendaTransport.mockClear();
    const ownerError = new BusinessError(status, code);
    ownerError.message = 'private owner body SQL token details';
    gateway.permissions.mockRejectedValueOnce(ownerError);
    const response = await post({ query: '{myAgenda{total}}' }, uncachedAdmin).expect(200);
    expect(response.body.errors[0].extensions).toEqual({ code: expected, statusCode: status });
    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('private');
    expect(JSON.stringify(response.body)).not.toContain('SQL');
    expect(agendaTransport).not.toHaveBeenCalled();
  });

  it.each([new Error('private SQL token'), new BusinessError(503, 'PRIVATE_SQL_EXCEPTION'), new BusinessError(503, 'constructor')])(
    'preexecute unknown owner failures remain sanitized SERVICE_UNAVAILABLE', async error => {
      gateway.permissions.mockRejectedValueOnce(error);
      const response = await post({ query: '{myAgenda{total}}' }, uncachedAdmin).expect(200);
      expect(response.body.errors[0].extensions).toEqual({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
      expect(response.body.data).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(/private|SQL|constructor/);
    },
  );

  it('CU05 exposes all five roots through the exact SDL with synthetic owners and human forwarding', async () => {
    agendaTransport.mockClear();
    const fields = 'assignmentId executionStatus executionProgress { advances lastAdvanceAt availableEvidence }';
    const result = await post({ query: '{ mine: myAgenda { actor {employeeId fullName status scopes} items {' + fields + '} total limit offset from to timeZone observedAt } myAgendaWork(assignmentId:"' + ASSIGNMENT_ID + '"){' + fields + '} teamAgenda(employeeId:"' + AGENDA_WORK.employee.id + '",limit:1,offset:2){total items{assignmentId}} teamAgendaWork(assignmentId:"' + ASSIGNMENT_ID + '"){' + fields + '} agendaTeamEmployees { items { id fullName status } total limit offset observedAt } }' }, admin).expect(200);
    expect(result.body.errors).toBeUndefined();
    const summary = { assignmentId: ASSIGNMENT_ID, executionStatus: 'not_started', executionProgress: { advances: 0, lastAdvanceAt: null, availableEvidence: 0 } };
    expect(result.body.data.mine.items).toEqual([summary]);
    expect(result.body.data.myAgendaWork).toEqual(summary);
    expect(result.body.data.teamAgenda.total).toBe(1);
    expect(result.body.data.teamAgendaWork).toEqual(summary);
    expect(result.body.data.agendaTeamEmployees.items).toEqual(AGENDA_EMPLOYEES.items);
    expect(agendaTransport).toHaveBeenCalledTimes(5);
    for (const call of agendaTransport.mock.calls) expect(call[1]?.headers).toEqual({ Authorization: 'Bearer ' + admin });
  });

  it('CU05 does not treat a mechanic role as an effective agenda permission or employee id', async () => {
    agendaTransport.mockClear();
    const denied = await post({ query: '{alias:myAgenda{total} second:teamAgenda{total}}' }, mechanic).expect(200);
    expect(denied.body.errors[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(denied.body.data).toBeUndefined();
    expect(agendaTransport).not.toHaveBeenCalled();
  });

  it.each([
    '{myAgenda(employeeId:"' + ASSIGNMENT_ID + '"){total}}',
    '{myAgenda{items{employee{email}}}}', '{myAgenda{items{customerId}}}',
  ])('CU05 rejects unapproved inputs/PII through HTTP: %s', async query => {
    agendaTransport.mockClear();
    const result = await post({ query }, admin).expect(200);
    expect(result.body.errors[0].extensions).toEqual({ code: 'BAD_REQUEST', statusCode: 400 });
    expect(agendaTransport).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'AGENDA_ACCESS_DENIED', 'FORBIDDEN'], [404, 'AGENDA_WORK_NOT_FOUND', 'AGENDA_WORK_NOT_FOUND'],
    [503, 'AGENDA_STATE_UNAVAILABLE', 'AGENDA_STATE_UNAVAILABLE'],
    [503, 'AGENDA_DEPENDENCY_UNAVAILABLE', 'AGENDA_DEPENDENCY_UNAVAILABLE'],
    [503, 'PERSISTENCE_UNAVAILABLE', 'PERSISTENCE_UNAVAILABLE'],
  ] as const)('CU05 maps owner %s/%s despite cached general permissions', async (status, code, expected) => {
    agendaTransport.mockResolvedValueOnce(Response.json({ code, message: 'private owner SQL detail' }, { status }));
    const result = await post({ query: '{myAgendaWork(assignmentId:"' + ASSIGNMENT_ID + '"){assignmentId}}' }, admin).expect(200);
    expect(result.body.errors[0].extensions).toEqual({ code: expected, statusCode: status });
    expect(result.body.data).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain('private');
  });
});
