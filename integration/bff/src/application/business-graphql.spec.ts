import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusinessGraphql, BadRequest } from './business-graphql.js';
import { BusinessError } from './business-error.js';
import { bffEnvironment } from '../infrastructure/config/environment.js';

const schemaPath = resolve(process.cwd(), '../../contracts/graphql/employees.graphql');
const securityPath = resolve(process.cwd(), '../../contracts/graphql/security.graphql');
const operationsPath = resolve(process.cwd(), '../../contracts/graphql/operations.graphql');
const financePath = resolve(process.cwd(), '../../contracts/graphql/finance.graphql');
const ADMIN = Object.freeze({ subject: 'synthetic-admin', roles: ['administrador'] as const });
const HEAD = Object.freeze({ subject: 'synthetic-head', roles: ['jefe_taller'] as const });
const LIMITED = Object.freeze({ subject: 'synthetic-limited', roles: ['recepcionista'] as const });
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';
const ALL = [
  'employees:read', 'employees:write', 'schedules:read', 'schedules:write', 'security:read', 'security:write',
  'customers:read', 'customers:write', 'vehicles:read', 'vehicles:write',
  'catalog:read', 'catalog:write', 'appointments:read', 'appointments:write',
  'receptions:read', 'receptions:write', 'orders:read', 'orders:write',
  'quotes:read', 'quotes:write', 'quotes:decide',
  'confirmations:read', 'confirmations:write',
];
const effectiveFor = (token: string): string[] =>
  token === 'head-token' ? ['schedules:read', 'schedules:write', 'confirmations:read', 'confirmations:write']
    : token === 'security-token' ? ['security:read']
      : token === 'no-role-token' ? []
        : ALL;

function build(rejected?: Error) {
  const operations = {
    confirmationSaga: vi.fn(),
    confirmationByOperation: vi.fn(),
    orderConfirmations: vi.fn(async () => []),
    startServiceConfirmation: vi.fn(),
    retryServiceConfirmation: vi.fn(),
    customers: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    customer: vi.fn(),
    createCustomer: vi.fn(async () => ({ customer: { id: EMPLOYEE_ID }, replayed: false })),
    updateCustomer: vi.fn(),
    deactivateCustomer: vi.fn(),
    vehicles: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    vehicle: vi.fn(),
    createVehicle: vi.fn(),
    updateVehicle: vi.fn(),
    deactivateVehicle: vi.fn(),
    services: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    service: vi.fn(),
    createService: vi.fn(),
    updateService: vi.fn(),
    deactivateService: vi.fn(),
    appointments: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    appointment: vi.fn(),
    createAppointment: vi.fn(async () => ({ appointment: { id: EMPLOYEE_ID }, replayed: false })),
    rescheduleAppointment: vi.fn(),
    cancelAppointment: vi.fn(),
    receptions: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    reception: vi.fn(),
    createReception: vi.fn(),
    orders: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    order: vi.fn(),
    createWorkOrder: vi.fn(),
  };
  const gateway = {
    confirmationMechanics: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    confirmationAvailability: vi.fn(),
    list: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    get: vi.fn(async () => ({ id: EMPLOYEE_ID })),
    history: vi.fn(async (): Promise<{ items: Array<{ snapshot: { id: string } }>; total: number; limit: number; offset: number }> => ({ items: [], total: 0, limit: 20, offset: 0 })),
    create: vi.fn(async () => ({ employee: { id: EMPLOYEE_ID }, replayed: false })),
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
    permissions: vi.fn(async (token: string) => ({ catalog: [], effective: effectiveFor(token), roles: [] })),
    securityRoles: vi.fn(async () => []),
    securityRole: vi.fn(),
    createRole: vi.fn(async () => ({ role: { name: 'supervisor' }, replayed: false })),
    updateRole: vi.fn(),
    retryRoleSync: vi.fn(),
    employeeRoles: vi.fn(),
    assignRole: vi.fn(async () => ({ assignment: { roleName: 'supervisor' }, replayed: false })),
    revokeRole: vi.fn(),
    securityHistory: vi.fn(),
  };
  if (rejected) gateway.list.mockRejectedValueOnce(rejected);
  const finance = {
    quotes: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    quote: vi.fn(),
    createQuote: vi.fn(async () => ({ quote: { id: EMPLOYEE_ID }, orderStatusHint: null, replayed: false })),
    reviseQuote: vi.fn(),
    decideQuote: vi.fn(async () => ({ quote: { id: EMPLOYEE_ID }, orderStatusHint: 'quote_approved', replayed: false })),
  };
  const agenda = { list: vi.fn(), work: vi.fn(), employees: vi.fn() };
  return { gateway, operations, finance, graphql: new BusinessGraphql(gateway, operations, finance, bffEnvironment({}).schemaPaths, agenda) };
}

describe('CU15 explicit fake upstream contract', () => {
  const selection = 'sagaId status phase version orderVersion operationId steps { command direction status attempts resourceVersion }';
  const input = { operationId: EMPLOYEE_ID, expectedVersion: 3, quoteId: EMPLOYEE_ID, quoteVersion: 2, employeeId: EMPLOYEE_ID, employeeVersion: 4, requiredSpecialty: 'frenos', startsAt: '2026-11-02T12:00:00Z', endsAt: '2026-11-02T13:00:00Z' };
  const saga = { sagaId: EMPLOYEE_ID, status: 'recovery_pending', phase: 'reserve_assignment', version: 2, orderVersion: 4, operationId: EMPLOYEE_ID, steps: [{ command: 'reserve_assignment', direction: 'forward', status: 'uncertain', attempts: 1, resourceVersion: null }] };
  it.each([[ADMIN, 'admin-token'], [HEAD, 'head-token'], [{ subject: 'custom', roles: ['supervisor'] }, 'custom-token']])('uses effective permissions for %j', async (identity, token) => {
    const { graphql, operations } = build();
    operations.startServiceConfirmation.mockResolvedValue(saga);
    const response = await graphql.run({ query: 'mutation($input:StartServiceConfirmationInput!){startServiceConfirmation(orderId:"' + EMPLOYEE_ID + '",input:$input){' + selection + '}}', variables: { input } }, identity, token);
    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ startServiceConfirmation: saga });
    expect(operations.startServiceConfirmation).toHaveBeenCalledWith(EMPLOYEE_ID, input, token);
  });
  it('forwards retry and lookup by operation without replacing identity or version', async () => {
    const { graphql, operations } = build();
    operations.retryServiceConfirmation.mockResolvedValue(saga);
    const retry = { operationId: EMPLOYEE_ID, expectedVersion: 2 };
    const result = await graphql.run({ query: 'mutation($input:ConfirmationRetryInput!){retryServiceConfirmation(id:"' + EMPLOYEE_ID + '",input:$input){status}}', variables: { input: retry } }, HEAD, 'head-token');
    expect(result.data).toEqual({ retryServiceConfirmation: { status: 'recovery_pending' } });
    expect(operations.retryServiceConfirmation).toHaveBeenCalledWith(EMPLOYEE_ID, retry, 'head-token');
    operations.confirmationByOperation.mockResolvedValue(saga);
    await graphql.run({ query: '{confirmationByOperation(operationId:"' + EMPLOYEE_ID + '"){status}}' }, HEAD, 'head-token');
    expect(operations.confirmationByOperation).toHaveBeenCalledWith(EMPLOYEE_ID, 'head-token');
  });
  it('denies CU15 without the permission even to a named admin role', async () => {
    const { graphql, gateway, operations } = build();
    gateway.permissions.mockResolvedValue({ catalog: [], effective: [], roles: [] });
    const result = await graphql.run({ query: '{orderConfirmations(orderId:"' + EMPLOYEE_ID + '"){status}}' }, ADMIN, 'no-role-token');
    expect(result.errors?.[0].extensions.code).toBe('FORBIDDEN');
    expect(operations.orderConfirmations).not.toHaveBeenCalled();
  });
  it('forwards mechanic flags only when explicitly provided to existing employee CRUD', async () => {
    const { graphql, gateway } = build();
    gateway.update.mockResolvedValue({ employee: { id: EMPLOYEE_ID, mechanicEnabled: true }, replayed: false });
    const fields = { operationId: EMPLOYEE_ID, expectedVersion: 1, firstName: 'Ana', lastName: 'Test', document: '12345', email: 'test@example.invalid', phone: '70000000', jobTitle: 'Técnica', startDate: '2026-01-01', specialties: ['frenos'] };
    const query = 'mutation($input:UpdateEmployeeInput!){updateEmployee(id:"' + EMPLOYEE_ID + '",input:$input){employee{id mechanicEnabled}}}';
    await graphql.run({ query, variables: { input: fields } }, ADMIN, 'admin-token');
    expect(gateway.update).toHaveBeenLastCalledWith(EMPLOYEE_ID, fields, 'admin-token');
    expect(gateway.update.mock.calls[0][1]).not.toHaveProperty('mechanicEnabled');
    await graphql.run({ query, variables: { input: { ...fields, mechanicEnabled: false } } }, ADMIN, 'admin-token');
    expect(gateway.update).toHaveBeenLastCalledWith(EMPLOYEE_ID, { ...fields, mechanicEnabled: false }, 'admin-token');
    const denied = await graphql.run({ query, variables: { input: { ...fields, mechanicEnabled: true } } }, HEAD, 'head-token');
    expect(denied.errors?.[0].extensions.code).toBe('FORBIDDEN');
    expect(gateway.update).toHaveBeenCalledTimes(2);
  });
  it('keeps provisional reservations distinct from legacy assignments', async () => {
    const { graphql, gateway } = build();
    gateway.confirmationAvailability.mockResolvedValue({ assignments: [], reservations: [{ id: EMPLOYEE_ID, status: 'reserved', orderConfirmedObserved: false }] });
    const result = await graphql.run({ query: '{confirmationAvailability(employeeId:"' + EMPLOYEE_ID + '",date:"2026-11-02"){assignments{id} reservations{id status orderConfirmedObserved}}}' }, HEAD, 'head-token');
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ confirmationAvailability: { assignments: [], reservations: [{ id: EMPLOYEE_ID, status: 'reserved', orderConfirmedObserved: false }] } });
    expect(gateway.confirmationAvailability).toHaveBeenCalledWith(EMPLOYEE_ID, '2026-11-02', 'head-token');
  });
  it('keeps legacy history nullable', async () => {
    const { graphql, gateway } = build();
    gateway.history.mockResolvedValue({ items: [{ snapshot: { id: EMPLOYEE_ID } }], total: 1, limit: 20, offset: 0 });
    const history = await graphql.run({ query: '{employeeHistory(id:"' + EMPLOYEE_ID + '"){items{snapshot{id mechanicEnabled}}}}' }, ADMIN, 'admin-token');
    expect(history.errors).toBeUndefined();
    expect(history.data).toEqual({ employeeHistory: { items: [{ snapshot: { id: EMPLOYEE_ID, mechanicEnabled: null } }] } });
  });
  it('propagates public saga errors without leaking upstream detail', async () => {
    const { graphql, operations } = build();
    operations.confirmationSaga.mockRejectedValue(new BusinessError(404, 'CONFIRMATION_NOT_FOUND'));
    const result = await graphql.run({ query: '{confirmationSaga(id:"' + EMPLOYEE_ID + '"){status}}' }, HEAD, 'head-token');
    expect(result.errors?.[0].extensions).toEqual({ code: 'CONFIRMATION_NOT_FOUND', statusCode: 404 });
  });
});

describe('EmployeesGraphql allowlist and error mapping', () => {
  it('publishes exactly the seven CU03 root operations', () => {
    const source = readFileSync(schemaPath, 'utf8');
    const roots = [...source.matchAll(/^ {2}([a-zA-Z]+)\(/gm)].map((match) => match[1]);
    expect(roots.sort()).toEqual(
      ['createEmployee', 'deactivateEmployee', 'employee', 'employeeHistory', 'employees', 'retryEmployeeAccess', 'updateEmployee'].sort(),
    );
  });

  it.each([
    '{ __type(name: "Employee") { name } }',
    '{ unknown { id } }',
    'fragment F on Employee { id } query Q { employee(id: "' + EMPLOYEE_ID + '") { ...F } }',
    '{ employees(@@) { total } }',
    '',
    'not graphql',
  ])('rejects %s before reaching the gateway', async (query) => {
    const { graphql, gateway } = build();
    await expect(graphql.run({ query }, ADMIN, 'token')).rejects.toBeInstanceOf(BadRequest);
    expect(gateway.list).not.toHaveBeenCalled();
  });

  it('rejects a root inline fragment that would hide the field policy', async () => {
    const { graphql, gateway } = build();
    await expect(graphql.run({ query: '{ ... { employees { total } } }' }, ADMIN, 'token')).rejects.toBeInstanceOf(BadRequest);
    expect(gateway.list).not.toHaveBeenCalled();
  });

  it('rejects too many root selections and oversized input', async () => {
    const { graphql } = build();
    const many = Array.from({ length: 130 }, (_, index) => `a${index}: employees { total }`).join(' ');
    await expect(graphql.run({ query: `{ ${many} }` }, ADMIN, 'token')).rejects.toBeInstanceOf(BadRequest);
    await expect(graphql.run({ query: '{ employees { total } }'.padEnd(4001, ' ') }, ADMIN, 'token')).rejects.toBeInstanceOf(BadRequest);
    await expect(
      graphql.run({ query: 'query ($s: String) { employees(search: $s) { total } }', variables: { s: 'x'.repeat(70000) } }, ADMIN, 'token'),
    ).rejects.toBeInstanceOf(BadRequest);
  });

  it('accepts the published history selection including the nested access snapshot', async () => {
    const { graphql, gateway } = build();
    const response = await graphql.run(
      {
        query:
          'query H($id: UUID!) { employeeHistory(id: $id) { total items { version action snapshot { id version access { requested status subject attempts errorCode } } } } }',
        variables: { id: EMPLOYEE_ID },
      },
      ADMIN,
      'token',
    );
    expect(response.errors).toBeUndefined();
    expect(gateway.history).toHaveBeenCalledWith(EMPLOYEE_ID, expect.objectContaining({}), 'token');
  });

  it('keeps CU03 employee operations administrator-only while CU04 allows the head', async () => {
    const { graphql } = build();
    const denied = await graphql.run({ query: '{ employees { total } }' }, HEAD, 'head-token');
    expect(denied.errors?.[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    const allowed = await graphql.run({ query: '{ staffingEmployees { id } }' }, HEAD, 'head-token');
    expect(allowed.errors).toBeUndefined();
  });

  it('forwards allowlisted arguments and maps business errors without leaking them', async () => {
    const ok = build();
    const response = await ok.graphql.run({ query: 'query ($search: String) { employees(search: $search) { total } }', variables: { search: 'ana' } }, ADMIN, 'token');
    expect(response).toEqual({ data: { employees: { total: 0 } } });
    expect(ok.gateway.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'ana' }), 'token');

    const failed = build(new BusinessError(409, 'DUPLICATE_EMAIL'));
    const body = await failed.graphql.run({ query: '{ employees { total } }' }, ADMIN, 'token');
    expect(body.errors?.[0].extensions).toEqual({ code: 'DUPLICATE_EMAIL', statusCode: 409 });
    expect(JSON.stringify(body)).not.toContain('internal-upstream-detail');
  });
});

describe('CU02 security policy', () => {
  it('publishes the security operations in the SDL', () => {
    const source = readFileSync(securityPath, 'utf8');
    const blocks = [...source.matchAll(/extend type (?:Query|Mutation) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n');
    const roots = [...blocks.matchAll(/^ {2}([A-Za-z]+)[(:]/gm)].map((match) => match[1]);
    expect(roots.sort()).toEqual(
      ['assignRole', 'createRole', 'employeeRoles', 'revokeRole', 'retryRoleSync', 'securityCatalog', 'securityHistory', 'securityRole', 'securityRoles', 'updateRole'].sort(),
    );
  });

  it('lets any authenticated caller read their own catalog without extra permissions', async () => {
    const { graphql, gateway } = build();
    const response = await graphql.run({ query: '{ securityCatalog { catalog { id } effective roles } }' }, HEAD, 'no-role-token');
    expect(response.errors).toBeUndefined();
    expect(gateway.permissions).toHaveBeenCalledWith('no-role-token');
    expect(gateway.securityRoles).not.toHaveBeenCalled();
  });

  it('enforces security:read for role queries and security:write for mutations', async () => {
    const { graphql, gateway } = build();
    const deniedRead = await graphql.run({ query: '{ securityRoles { name } }' }, HEAD, 'head-token');
    expect(deniedRead.errors?.[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(gateway.securityRoles).not.toHaveBeenCalled();

    const allowedRead = await graphql.run({ query: '{ securityRoles { name } }' }, ADMIN, 'security-token');
    expect(allowedRead.errors).toBeUndefined();
    expect(gateway.securityRoles).toHaveBeenCalledWith('security-token');

    const deniedWrite = await graphql.run(
      { query: 'mutation { createRole(input: { operationId: "' + EMPLOYEE_ID + '", name: "supervisor", permissions: ["security:read"] }) { role { name } } }' },
      ADMIN,
      'security-token',
    );
    expect(deniedWrite.errors?.[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(gateway.createRole).not.toHaveBeenCalled();
  });

  it('allows an administrator to manage roles and assignments', async () => {
    const { graphql, gateway } = build();
    const created = await graphql.run(
      { query: 'mutation ($input: RoleCreateInput!) { createRole(input: $input) { role { name } replayed } }', variables: { input: { operationId: EMPLOYEE_ID, name: 'supervisor', permissions: ['schedules:read'] } } },
      ADMIN,
      'token',
    );
    expect(created.errors).toBeUndefined();
    expect(gateway.createRole).toHaveBeenCalledWith(expect.objectContaining({ name: 'supervisor' }), 'token');

    const assigned = await graphql.run(
      { query: 'mutation ($id: UUID!, $input: RoleAssignmentInput!) { assignRole(employeeId: $id, input: $input) { assignment { roleName } replayed } }', variables: { id: EMPLOYEE_ID, input: { operationId: EMPLOYEE_ID, roleName: 'supervisor' } } },
      ADMIN,
      'token',
    );
    expect(assigned.errors).toBeUndefined();
    expect(gateway.assignRole).toHaveBeenCalledWith(EMPLOYEE_ID, expect.objectContaining({ roleName: 'supervisor' }), 'token');
  });

  it('keeps the employee CRUD behind employees:write', async () => {
    const { graphql, gateway } = build();
    const denied = await graphql.run(
      { query: 'mutation { deactivateEmployee(id: "' + EMPLOYEE_ID + '", input: { operationId: "' + EMPLOYEE_ID + '", expectedVersion: 1 }) { replayed } }' },
      ADMIN,
      'security-token',
    );
    expect(denied.errors?.[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(gateway.deactivate).not.toHaveBeenCalled();
  });
});

describe('operations policy (CU06, CU07, CU09, CU10)', () => {
  it('publishes the operations root fields in the SDL', () => {
    const source = readFileSync(operationsPath, 'utf8');
    const blocks = [...source.matchAll(/extend type (?:Query|Mutation) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n');
    const roots = [...blocks.matchAll(/^ {2}([A-Za-z]+)[(:]/gm)].map((match) => match[1]);
    expect(roots.sort()).toEqual([
      'appointments', 'appointment', 'cancelAppointment', 'createAppointment', 'createCustomer', 'createReception',
      'createService', 'createVehicle', 'createWorkOrder', 'customer', 'customers', 'deactivateCustomer',
      'deactivateService', 'deactivateVehicle', 'order', 'orders', 'reception', 'receptions',
      'rescheduleAppointment', 'service', 'services', 'updateCustomer', 'updateService', 'updateVehicle',
      'vehicle', 'vehicles',
    ].sort());
  });

  it('routes customers, services and appointments to the operations owner', async () => {
    const { graphql, operations } = build();
    const customers = await graphql.run({ query: '{ customers(search: "ana") { total items { id } } }' }, ADMIN, 'token');
    expect(customers.errors).toBeUndefined();
    expect(operations.customers).toHaveBeenCalledWith(expect.objectContaining({ search: 'ana' }), 'token');

    const scheduled = await graphql.run(
      {
        query: 'mutation ($input: CreateAppointmentInput!) { createAppointment(input: $input) { appointment { id } replayed } }',
        variables: { input: { operationId: EMPLOYEE_ID, customerId: EMPLOYEE_ID, vehicleId: EMPLOYEE_ID, serviceId: EMPLOYEE_ID, startsAt: '2026-12-01T09:00:00-04:00' } },
      },
      ADMIN,
      'token',
    );
    expect(scheduled.errors).toBeUndefined();
    expect(operations.createAppointment).toHaveBeenCalledWith(expect.objectContaining({ startsAt: '2026-12-01T09:00:00-04:00' }), 'token');
  });

  it('requires catalog and appointment permissions per field', async () => {
    const { graphql, operations } = build();
    const deniedCatalog = await graphql.run({ query: '{ services { total } }' }, HEAD, 'head-token');
    expect(deniedCatalog.errors?.[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(operations.services).not.toHaveBeenCalled();

    const deniedAppointment = await graphql.run(
      {
        query: 'mutation ($input: CreateAppointmentInput!) { createAppointment(input: $input) { appointment { id } } }',
        variables: { input: { operationId: EMPLOYEE_ID, customerId: EMPLOYEE_ID, vehicleId: EMPLOYEE_ID, serviceId: EMPLOYEE_ID, startsAt: '2026-12-01T09:00:00-04:00' } },
      },
      ADMIN,
      'security-token',
    );
    expect(deniedAppointment.errors?.[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(operations.createAppointment).not.toHaveBeenCalled();
  });
});
describe('finanzas policy (CU13, CU14)', () => {
  it('publishes the finance root fields in the SDL', () => {
    const source = readFileSync(financePath, 'utf8');
    const blocks = [...source.matchAll(/extend type (?:Query|Mutation) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n');
    const roots = [...blocks.matchAll(/^ {2}([A-Za-z]+)[(:]/gm)].map((match) => match[1]);
    expect(roots.sort()).toEqual(['quotes', 'quote', 'createQuote', 'reviseQuote', 'decideQuote'].sort());
  });

  it('routes quotes to the finance owner and enforces quotes:decide', async () => {
    const { graphql, finance } = build();
    const listed = await graphql.run({ query: '{ quotes(limit: 5) { total } }' }, ADMIN, 'token');
    expect(listed.errors).toBeUndefined();
    expect(finance.quotes).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }), 'token');

    const decided = await graphql.run(
      {
        query: 'mutation ($input: DecideQuoteInput!) { decideQuote(id: "' + EMPLOYEE_ID + '", input: $input) { quote { id } orderStatusHint } }',
        variables: { input: { operationId: EMPLOYEE_ID, decision: 'approved', evidence: 'Presencial' } },
      },
      LIMITED,
      'security-token',
    );
    expect(decided.errors?.[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(finance.decideQuote).not.toHaveBeenCalled();
  });
});
