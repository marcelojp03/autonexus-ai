import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmployeesGraphql, BadRequest } from './employees-graphql.js';
import { BusinessError } from './business-error.js';

const schemaPath = resolve(process.cwd(), '../../contracts/graphql/employees.graphql');
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';

function build(rejected?: Error) {
  const gateway = {
    list: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    get: vi.fn(async () => ({ id: EMPLOYEE_ID })),
    history: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    create: vi.fn(async () => ({ employee: { id: EMPLOYEE_ID }, replayed: false })),
    update: vi.fn(),
    deactivate: vi.fn(),
    retryAccess: vi.fn(),
    reachable: vi.fn(async () => true),
  };
  if (rejected) gateway.list.mockRejectedValueOnce(rejected);
  return { gateway, graphql: new EmployeesGraphql(gateway, schemaPath) };
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
    await expect(graphql.run({ query }, 'token')).rejects.toBeInstanceOf(BadRequest);
    expect(gateway.list).not.toHaveBeenCalled();
  });

  it('rejects too many root selections and oversized input', async () => {
    const { graphql } = build();
    const many = Array.from({ length: 130 }, (_, index) => `a${index}: employees { total }`).join(' ');
    await expect(graphql.run({ query: `{ ${many} }` }, 'token')).rejects.toBeInstanceOf(BadRequest);
    await expect(graphql.run({ query: '{ employees { total } }'.padEnd(4001, ' ') }, 'token')).rejects.toBeInstanceOf(BadRequest);
    await expect(
      graphql.run({ query: 'query ($s: String) { employees(search: $s) { total } }', variables: { s: 'x'.repeat(70000) } }, 'token'),
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
      'token',
    );
    expect(response.errors).toBeUndefined();
    expect(gateway.history).toHaveBeenCalledWith(EMPLOYEE_ID, expect.objectContaining({}), 'token');
  });

  it('forwards allowlisted arguments and maps business errors without leaking them', async () => {
    const ok = build();
    const response = await ok.graphql.run({ query: 'query ($search: String) { employees(search: $search) { total } }', variables: { search: 'ana' } }, 'token');
    expect(response).toEqual({ data: { employees: { total: 0 } } });
    expect(ok.gateway.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'ana' }), 'token');

    const failed = build(new BusinessError(409, 'DUPLICATE_EMAIL'));
    const body = await failed.graphql.run({ query: '{ employees { total } }' }, 'token');
    expect(body.errors?.[0].extensions).toEqual({ code: 'DUPLICATE_EMAIL', statusCode: 409 });
    expect(JSON.stringify(body)).not.toContain('internal-upstream-detail');
  });
});
