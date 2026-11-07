import { describe, expect, it, vi } from 'vitest';
import { PostgresSecurityRepository } from './postgres-security-repository.js';

const employeeId = '11111111-1111-4111-8111-111111111111';

function fixture(binding: { id: string; status: 'active' | 'inactive' } | null, roleRows: unknown[] = []) {
  const query = vi.fn().mockResolvedValueOnce(roleRows).mockResolvedValueOnce(binding ? [binding] : []);
  const runner = { query, connect: vi.fn(), release: vi.fn() };
  const repository = new PostgresSecurityRepository();
  Reflect.set(repository, 'source', { isInitialized: true, createQueryRunner: () => runner });
  return { repository, query, runner };
}

describe('security permissions binding with explicit SQL runner double', () => {
  it.each(['active', 'inactive'] as const)('returns the current %s employee, not the token subject', async status => {
    const { repository, query, runner } = fixture({ id: employeeId, status });
    expect(await repository.permissions('current-subject', ['custom'])).toEqual({
      roles: ['custom'], recognized: [], permissions: [], employeeId, employeeStatus: status,
    });
    const [sql, parameters] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('e.subject=$1');
    expect(sql).toContain("e.record->'access'->>'subject'=$1");
    expect(parameters).toEqual(['current-subject']);
    expect(runner.release).toHaveBeenCalledOnce();
  });

  it('keeps system-role bootstrap permissions but returns null when there is no binding', async () => {
    const { repository, query } = fixture(null, [{ name: 'administrador', permissions: ['security:read'] }]);
    expect(await repository.permissions('bootstrap-subject', ['administrador'])).toEqual({
      roles: ['administrador'], recognized: ['administrador'], permissions: ['security:read'],
      employeeId: null, employeeStatus: null,
    });
    expect(query.mock.calls[0][0]).toContain('r.system');
    expect(query.mock.calls[0][0]).toContain('AND NOT EXISTS (SELECT 1 FROM employees.employee_records e WHERE e.subject = $2)');
    expect(query.mock.calls[0][1]).toEqual([['administrador'], 'bootstrap-subject']);
  });

  it('does not expose an active binding for a stale subject', async () => {
    const { repository, query } = fixture(null);
    expect(await repository.permissions('stale-subject', ['custom'])).toMatchObject({
      employeeId: null, employeeStatus: null,
    });
    expect(query.mock.calls[1][0]).toContain('WHERE e.subject=$1');
    expect(query.mock.calls[1][0]).not.toContain('security_role_assignments');
    expect(query.mock.calls[1][1]).toEqual(['stale-subject']);
  });

  it('resolves a binding even when the JWT has no roles', async () => {
    const { repository } = fixture({ id: employeeId, status: 'active' });
    expect(await repository.permissions('current-subject', [])).toEqual({
      roles: [], recognized: [], permissions: [], employeeId, employeeStatus: 'active',
    });
  });
});
