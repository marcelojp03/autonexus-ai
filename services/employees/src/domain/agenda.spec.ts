import { describe, expect, it } from 'vitest';
import { agendaScope, assignmentCheckInput } from './agenda.js';
import { INITIAL_ROLES, PERMISSIONS } from './permissions.js';
const id = 'abcdefab-1111-4111-8111-111111111111';
describe('CU05 closed inputs and permissions', () => {
  it.each([undefined, null, [], ['self', 'team'], 'own', 'SELF'])(
    'rejects invalid scope %j',
    (value) => {
      expect(() => agendaScope(value)).toThrow('VALIDATION_ERROR');
    },
  );
  it.each([
    {},
    { scope: 'self' },
    { scope: 'self', assignmentIds: 'x' },
    { scope: 'self', assignmentIds: ['bad'] },
    { scope: 'self', assignmentIds: [id, id.toUpperCase()] },
    { scope: 'self', assignmentIds: Array(101).fill(id) },
    { scope: 'self', assignmentIds: [], employeeId: id },
  ])('rejects invalid check %j', (value) => {
    expect(() => assignmentCheckInput(value)).toThrow('VALIDATION_ERROR');
  });
  it('normalizes UUIDs and accepts empty bounded reads', () => {
    expect(
      assignmentCheckInput({
        scope: 'team',
        assignmentIds: [id.toUpperCase()],
      }),
    ).toEqual({ scope: 'team', assignmentIds: [id] });
    expect(
      assignmentCheckInput({ scope: 'self', assignmentIds: [] }).assignmentIds,
    ).toEqual([]);
  });
  it('seeds 25 permissions without granting mechanic general CRUD', () => {
    expect(PERMISSIONS).toHaveLength(25);
    for (const name of ['administrador', 'jefe_taller']) {
      expect(INITIAL_ROLES.find((r) => r.name === name)?.permissions).toEqual(
        expect.arrayContaining(['agenda:read:self', 'agenda:read:team']),
      );
    }
    expect(
      INITIAL_ROLES.find((r) => r.name === 'mecanico')?.permissions,
    ).toEqual(['receptions:read', 'receptions:write', 'agenda:read:self']);
  });
});
