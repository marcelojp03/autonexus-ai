import {
  assignmentBody,
  canonical,
  digest,
  eligibility,
  requireMechanic,
} from './assignment.js';
import { command, transition, type Employee } from './employee.js';
const id = '11111111-1111-4111-8111-111111111111';
const fields = {
  firstName: 'Ana',
  lastName: 'Perez',
  document: 'test',
  email: 'ana@example.invalid',
  phone: '70000000',
  jobTitle: 'Jefa',
  startDate: '2020-01-01',
  specialties: ['Motor'],
};
const create = (extra = {}) =>
  transition(
    command('create', null, { ...fields, operationId: id, ...extra }),
    null,
    'human',
    id,
    '2026-10-28T10:00:00.000Z',
  ).employee;
const common = {
  operationId: id,
  expectedVersion: 0,
  initiatedBy: 'human',
  authorizedAt: '2026-10-28T08:00:00-04:00',
};
const reserve = {
  ...common,
  orderId: id,
  employeeId: id,
  employeeVersion: 1,
  requiredSpecialty: 'Motor',
  startsAt: '2099-10-28T09:00:00-04:00',
  endsAt: '2099-10-28T10:00:00-04:00',
};
describe('CU15 labor eligibility and immutable normalized commands', () => {
  it('defaults to disabled independently of job title and specialties', () => {
    expect(create().mechanicEnabled).toBe(false);
    expect(eligibility(create())).toEqual(['MECHANIC_NOT_ENABLED']);
  });
  it('does not request identity synchronization just for the labor flag', () => {
    const current = create();
    const change = transition(
      command('update', id, {
        ...fields,
        operationId: id,
        expectedVersion: 1,
        mechanicEnabled: true,
      }),
      current,
      'human',
      id,
      '2026-10-28T11:00:00.000Z',
    );
    expect(change.employee.mechanicEnabled).toBe(true);
    expect(change.synchronize).toBe(false);
    expect(change.employee.access).toEqual(current.access);
  });
  it('preserves the flag on omitted update and rejects removal of the last specialty', () => {
    const current = create({ mechanicEnabled: true });
    const update = command('update', id, {
      ...fields,
      operationId: id,
      expectedVersion: 1,
    });
    expect(
      transition(update, current, 'human', id, '2026-10-28T11:00:00.000Z')
        .employee.mechanicEnabled,
    ).toBe(true);
    expect(() =>
      transition(
        { ...update, fields: { ...fields, specialties: [] } },
        current,
        'human',
        id,
        '2026-10-28T11:00:00.000Z',
      ),
    ).toThrow('VALIDATION_ERROR');
  });
  it.each([null, 1, 'true'])(
    'rejects nonboolean enabled %s',
    (mechanicEnabled) =>
      expect(() => create({ mechanicEnabled })).toThrow('VALIDATION_ERROR'),
  );
  it('requires a specialty when enabling', () =>
    expect(() => create({ mechanicEnabled: true, specialties: [] })).toThrow(
      'VALIDATION_ERROR',
    ));
  it('explains all independent reasons without inferring roles', () =>
    expect(
      eligibility({ ...create(), status: 'inactive', specialties: [] }),
    ).toEqual([
      'EMPLOYEE_INACTIVE',
      'MECHANIC_NOT_ENABLED',
      'SPECIALTY_REQUIRED',
    ]));
  it('checks employee version only when requested and exact declared specialty', () => {
    const employee = create({ mechanicEnabled: true });
    expect(() => requireMechanic(employee, 'Motor', 2)).toThrow(
      'EMPLOYEE_VERSION_CONFLICT',
    );
    expect(() => requireMechanic(employee, 'motor')).toThrow(
      'SPECIALTY_MISMATCH',
    );
    expect(() =>
      requireMechanic({ ...employee, version: 22 }, 'Motor'),
    ).not.toThrow();
    expect(() =>
      requireMechanic(
        { ...employee, mechanicEnabled: undefined } as Employee,
        'Motor',
      ),
    ).toThrow('MECHANIC_NOT_ENABLED');
  });
  it('normalizes UUIDs and offset timestamps before canonical fingerprinting', () => {
    const a = assignmentBody('reserve_assignment', reserve);
    const b = assignmentBody('reserve_assignment', {
      ...reserve,
      startsAt: '2099-10-28T13:00:00.000Z',
      endsAt: '2099-10-28T14:00:00.000Z',
    });
    expect(a).toEqual(b);
    expect(a.authorizedAt).toBe('2026-10-28T12:00:00.000Z');
    expect(
      digest({
        body: a,
        command: 'reserve_assignment',
        sagaId: id,
        clientId: 'technical',
      }),
    ).toBe(
      digest({
        clientId: 'technical',
        sagaId: id,
        command: 'reserve_assignment',
        body: b,
      }),
    );
  });
  it('sorts recursive object keys, preserves array order and binds every command field', () => {
    expect(canonical({ z: { b: 2, a: 1 }, a: [2, 1] })).toBe(
      '{"a":[2,1],"z":{"a":1,"b":2}}',
    );
    const original = digest({
      clientId: 'technical',
      command: 'release_assignment',
      sagaId: id,
      body: { ...common, reasonCode: 'COMPENSATION' },
    });
    expect(original).not.toBe(
      digest({
        clientId: 'technical',
        command: 'release_assignment',
        sagaId: id,
        body: { ...common, reasonCode: 'OTHER_REASON' },
      }),
    );
  });
  it.each([
    { ...reserve, expectedVersion: 1 },
    { ...reserve, employeeVersion: 0 },
    { ...reserve, token: 'not allowed' },
    { ...reserve, endsAt: reserve.startsAt },
    { ...reserve, startsAt: '2099-10-28T09:00:00' },
    { ...reserve, initiatedBy: '' },
  ])('rejects malformed or nonclosed command %#', (body) =>
    expect(() => assignmentBody('reserve_assignment', body)).toThrow(
      'VALIDATION_ERROR',
    ),
  );
  it('accepts a zero-version terminal release but not a zero-version confirm', () => {
    expect(() =>
      assignmentBody('reserve_assignment', {
        ...reserve,
        startsAt: '2099-02-31T09:00:00-04:00',
      }),
    ).toThrow('VALIDATION_ERROR');
    expect(() =>
      assignmentBody('reserve_assignment', {
        ...reserve,
        startsAt: '2099-10-28T24:00:00Z',
      }),
    ).toThrow('VALIDATION_ERROR');
    expect(
      assignmentBody('release_assignment', {
        ...common,
        reasonCode: 'COMPENSATION',
      }).expectedVersion,
    ).toBe(0);
    expect(() => assignmentBody('confirm_assignment', common)).toThrow(
      'VALIDATION_ERROR',
    );
    expect(() =>
      assignmentBody('release_assignment', {
        ...common,
        reasonCode: 'free text',
      }),
    ).toThrow('VALIDATION_ERROR');
  });
});
