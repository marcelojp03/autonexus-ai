import { randomUUID } from 'node:crypto';
import { ManageEmployees } from './manage-employees.js';
import type {
  EmployeeRepository,
  IdentityOutcome,
} from './employee-repository.js';
import type { IdentityDesired } from './identity-gateway.js';
import { IdentitySyncError } from './identity-gateway.js';
const input = {
  operationId: randomUUID(),
  firstName: 'Ana',
  lastName: 'Perez',
  document: '123',
  email: 'ana@example.invalid',
  phone: '70000000',
  jobTitle: 'Mecanica',
  startDate: '2020-01-01',
  specialties: [],
};
describe('CU03 identity use case with explicit in-memory port stubs', () => {
  function setup() {
    let outcome: IdentityOutcome | undefined;
    const sync = vi.fn(async () => 'stable-subject');
    const repository: EmployeeRepository = {
      get: vi.fn(),
      list: vi.fn(),
      history: vi.fn(),
      execute: async (_c, _a, apply) => ({
        employee: apply(null).employee,
        replayed: false,
      }),
      synchronize: vi.fn(async (_id, attempt) => {
        outcome = await attempt({
          employeeId: 'test',
          subject: null,
          firstName: 'Ana',
          lastName: 'Perez',
          email: 'ana@example.invalid',
          enabled: true,
        } satisfies IdentityDesired);
      }),
    };
    return {
      repository,
      sync,
      service: new ManageEmployees(repository, { sync }),
      outcome: () => outcome,
    };
  }
  it('does not contact identity provider without explicit access request', async () => {
    const s = setup();
    const result = await s.service.mutate('create', null, input, 'actor');
    expect(result.employee.access.status).toBe('not_requested');
    expect(s.sync).not.toHaveBeenCalled();
  });
  it('keeps committed employee and maps remote timeout to a safe outcome', async () => {
    const s = setup();
    s.sync.mockRejectedValueOnce(new IdentitySyncError('IDP_TIMEOUT'));
    const result = await s.service.mutate(
      'create',
      null,
      { ...input, access: { requested: true } },
      'actor',
    );
    expect(result.employee.access.status).toBe('pending');
    expect(s.outcome()).toEqual({ code: 'IDP_TIMEOUT', conflict: false });
  });
  it('does not resubmit side effects on a replay', async () => {
    const s = setup();
    const execute = s.repository.execute.bind(s.repository);
    s.repository.execute = async (c, a, apply) => ({
      ...(await execute(c, a, apply)),
      replayed: true,
    });
    const result = await s.service.mutate(
      'create',
      null,
      { ...input, access: { requested: true } },
      'actor',
    );
    expect(result.replayed).toBe(true);
    expect(s.sync).not.toHaveBeenCalled();
  });
});
