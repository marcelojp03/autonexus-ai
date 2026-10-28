import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusinessGraphql, BadRequest } from './business-graphql.js';
import { BusinessError } from './business-error.js';

const schemaPath = resolve(process.cwd(), '../../contracts/graphql/employees.graphql');
const schedulePath = resolve(process.cwd(), '../../contracts/graphql/schedules.graphql');
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
];
const effectiveFor = (token: string): string[] =>
  token === 'head-token' ? ['schedules:read', 'schedules:write']
    : token === 'security-token' ? ['security:read']
      : token === 'no-role-token' ? []
        : ALL;

function build(rejected?: Error) {
  const operations = {
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
    list: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    get: vi.fn(async () => ({ id: EMPLOYEE_ID })),
    history: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
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
  return { gateway, operations, finance, graphql: new BusinessGraphql(gateway, operations, finance, [schemaPath, schedulePath, securityPath, operationsPath, financePath]) };
}

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
