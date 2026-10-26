import { fields, command, transition, query } from './employee.js';
const operationId = '11111111-1111-4111-8111-111111111111';
const input = {
  firstName: ' Ana  Maria ',
  lastName: 'Perez',
  document: 'CI 123',
  email: 'ANA@example.invalid',
  phone: '+591 70000000',
  jobTitle: 'Mecanica',
  startDate: '2020-01-01',
  specialties: ['Motor'],
};
describe('CU03 public business rules', () => {
  it('rejects text PostgreSQL cannot represent', () => {
    expect(() =>
      fields({ ...input, document: 'CI' + String.fromCharCode(0) }),
    ).toThrow();
    expect(() =>
      fields({ ...input, firstName: String.fromCharCode(0xd800) }),
    ).toThrow();
  });
  it('blocks deactivation of the linked administrator identity and access revocation', () => {
    const c = command('create', null, {
      ...input,
      operationId,
      access: { requested: true },
    });
    const first = transition(
      c,
      null,
      'actor',
      operationId,
      '2026-10-26T00:00:00.000Z',
    ).employee;
    first.access.subject = 'actor';
    first.access.status = 'synced';
    expect(() =>
      transition(
        command('deactivate', first.id, { operationId, expectedVersion: 1 }),
        first,
        'actor',
        operationId,
        '2026-10-26T00:01:00.000Z',
      ),
    ).toThrow('SELF_DEACTIVATION_FORBIDDEN');
    expect(() =>
      transition(
        command('update', first.id, {
          ...input,
          operationId,
          expectedVersion: 1,
          access: { requested: false },
        }),
        first,
        'actor',
        operationId,
        '2026-10-26T00:01:00.000Z',
      ),
    ).toThrow('ACCESS_REQUEST_CANNOT_BE_REVOKED');
  });
  it('normalizes personal data without turning occupation into security roles', () => {
    expect(fields(input).firstName).toBe('Ana Maria');
    expect(fields(input).email).toBe('ana@example.invalid');
    expect(() => fields({ ...input, roles: ['administrador'] })).toThrow();
  });
  it.each([
    { email: 'bad' },
    { startDate: '2025-02-30' },
    { startDate: '2999-01-01' },
    { specialties: 'Motor' },
    { specialties: ['Motor', ' Motor '] },
    { phone: 'abcdefg' },
    { firstName: null },
  ])('rejects invalid fields %j', (invalid) => {
    expect(() => fields({ ...input, ...invalid })).toThrow();
  });
  it('creates, updates with a version and deactivates without deleting history', () => {
    const create = command('create', null, { operationId, ...input });
    const first = transition(
      create,
      null,
      'actor',
      operationId,
      '2026-10-26T00:00:00.000Z',
    ).employee;
    expect(first.status).toBe('active');
    expect(first.version).toBe(1);
    expect(first.access.requested).toBe(false);
    const edit = command('update', first.id, {
      ...input,
      operationId,
      expectedVersion: 1,
    });
    const second = transition(
      edit,
      first,
      'actor',
      operationId,
      '2026-10-26T00:01:00.000Z',
    ).employee;
    expect(second.version).toBe(2);
    expect(() =>
      transition(
        edit,
        second,
        'actor',
        operationId,
        '2026-10-26T00:02:00.000Z',
      ),
    ).toThrow('VERSION_CONFLICT');
    const deactivate = command('deactivate', first.id, {
      operationId,
      expectedVersion: 2,
    });
    const third = transition(
      deactivate,
      second,
      'actor',
      operationId,
      '2026-10-26T00:02:00.000Z',
    ).employee;
    expect(third.status).toBe('inactive');
    expect(third.version).toBe(3);
  });
  it('rejects unknown/repeated query fields and coercion', () => {
    expect(query({ limit: '10', offset: '0' })).toEqual({
      limit: 10,
      offset: 0,
    });
    for (const value of [
      { limit: ['1', '2'] },
      { limit: '1.5' },
      { other: '1' },
    ])
      expect(() => query(value)).toThrow();
  });
});
