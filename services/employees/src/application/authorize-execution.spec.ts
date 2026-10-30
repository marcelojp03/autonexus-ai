import { describe, expect, it } from 'vitest';
import { AuthorizeExecution } from './authorize-execution.js';
import type { ExecutionsRepository } from './executions-repository.js';
import type { ExecutionScope } from '../domain/executions.js';
import type { AssignmentCheck } from '../domain/agenda.js';

const assignment = (overrides: Partial<AssignmentCheck> = {}): AssignmentCheck => ({
  assignmentId: '11111111-1111-4111-8111-111111111111',
  sagaId: '22222222-2222-4222-8222-222222222222',
  orderId: '33333333-3333-4333-8333-333333333333',
  employeeId: '44444444-4444-4444-8444-444444444444',
  fullName: 'Ana Mecánica',
  employeeStatus: 'active',
  startsAt: '2026-11-02T12:00:00.000Z',
  endsAt: '2026-11-02T14:00:00.000Z',
  status: 'confirmed',
  version: 3,
  orderConfirmedObserved: true,
  ...overrides,
});

const repository = (
  granted: readonly ExecutionScope[],
  rows: readonly AssignmentCheck[] = [assignment()],
) => {
  const calls: Array<{ ids: readonly string[]; employeeId: string | null; scope: ExecutionScope }> = [];
  const port: ExecutionsRepository = {
    async actor(subject, roles, scope) {
      expect(subject).toBe('subject-1');
      expect(roles).toEqual(['mecanico']);
      return granted.includes(scope)
        ? { employeeId: '44444444-4444-4444-8444-444444444444', fullName: 'Ana Mecánica', status: 'active' }
        : null;
    },
    async assignments(ids, employeeId) {
      calls.push({ ids, employeeId, scope: granted[0] });
      return rows.filter((row) => employeeId === null || row.employeeId === employeeId);
    },
  };
  return { port, calls };
};

const identity = (permissions: readonly string[]) => ({
  subject: 'subject-1',
  roles: ['mecanico'],
  permissions,
});

describe('CU16 escucha de autorización por registro', () => {
  it('resuelve el actor propio y limita las asignaciones al empleado vigente', async () => {
    const { port, calls } = repository(['write']);
    const result = await new AuthorizeExecution(port).authorize(identity(['executions:write']), {
      scope: 'write',
      assignmentIds: [assignment().assignmentId],
    });
    expect(result.actor).toEqual({
      employeeId: '44444444-4444-4444-8444-444444444444',
      fullName: 'Ana Mecánica',
      status: 'active',
    });
    expect(result.items).toHaveLength(1);
    expect(typeof result.observedAt).toBe('string');
    expect(calls[0].employeeId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it('no filtra por empleado cuando el alcance es de equipo', async () => {
    const { port, calls } = repository(['read-team']);
    await new AuthorizeExecution(port).authorize(identity(['executions:read:team']), {
      scope: 'read-team',
      assignmentIds: [assignment().assignmentId],
    });
    expect(calls[0].employeeId).toBeNull();
  });

  it('niega sin el permiso exacto del alcance aunque tenga otro permiso de ejecución', async () => {
    const { port } = repository(['write']);
    await expect(
      new AuthorizeExecution(port).authorize(identity(['executions:read:self']), {
        scope: 'write',
        assignmentIds: [assignment().assignmentId],
      }),
    ).rejects.toMatchObject({ status: 403, code: 'EXECUTION_ACCESS_DENIED' });
  });

  it('niega a un subject sin vínculo laboral aunque su token traiga el permiso', async () => {
    const { port } = repository([]);
    await expect(
      new AuthorizeExecution(port).authorize(identity(['executions:write']), {
        scope: 'write',
        assignmentIds: [assignment().assignmentId],
      }),
    ).rejects.toMatchObject({ status: 403, code: 'EXECUTION_ACCESS_DENIED' });
  });

  it('oculta una asignación ajena con el mismo 404 que una inexistente', async () => {
    const { port } = repository(['read-self'], [assignment({ employeeId: '55555555-5555-4555-8555-555555555555' })]);
    await expect(
      new AuthorizeExecution(port).authorize(identity(['executions:read:self']), {
        scope: 'read-self',
        assignmentIds: [assignment().assignmentId],
      }),
    ).rejects.toMatchObject({ status: 404, code: 'EXECUTION_WORK_NOT_FOUND' });
  });

  it('rechaza cuerpos con claves ajenas, alcances desconocidos y duplicados', async () => {
    const { port } = repository(['write']);
    const useCase = new AuthorizeExecution(port);
    const valid = {
      scope: 'write',
      assignmentIds: [assignment().assignmentId],
    };
    for (const input of [
      { ...valid, extra: true },
      { ...valid, scope: 'admin' },
      { ...valid, assignmentIds: [] },
      { ...valid, assignmentIds: [valid.assignmentIds[0], valid.assignmentIds[0]] },
      { ...valid, assignmentIds: Array.from({ length: 51 }, () => assignment().assignmentId) },
    ]) {
      await expect(useCase.authorize(identity(['executions:write']), input)).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
  });
});
