import { describe, expect, it, vi } from 'vitest';
import type { DataSource, QueryRunner } from 'typeorm';
import { PostgresAgendaRepository } from './postgres-agenda-repository.js';
import { AddAgendaPermissions1793541600000 } from './migrations/1793541600000-add-agenda-permissions.js';
const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const query = vi
    .fn<(...args: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValue([]);
  const runner = {
    query,
    connect: vi.fn(),
    startTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn(),
    release: vi.fn(),
    isTransactionActive: true,
  };
  const repository = new PostgresAgendaRepository();
  vi.spyOn(repository, 'database').mockResolvedValue({
    createQueryRunner: () => runner,
  } as unknown as DataSource);
  return { repository, query, runner };
}
describe('CU05 SQL adapter with explicit runner double, not SQL integration', () => {
  it('requires active current column, JSON link and assignment subject plus current JWT roles', async () => {
    const { repository, query } = fixture();
    query.mockResolvedValue([
      {
        id,
        full_name: 'Ana Perez',
        permissions: ['agenda:read:team', 'agenda:read:self'],
      },
    ]);
    expect(await repository.actor('current', ['custom'])).toEqual({
      employeeId: id,
      fullName: 'Ana Perez',
      status: 'active',
      scopes: ['self', 'team'],
    });
    const [sql, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('a.subject=$1');
    expect(sql).toContain('a.revoked_at IS NULL');
    expect(sql).toContain('e.subject=$1');
    expect(sql).toContain("e.record->'access'->>'subject'=$1");
    expect(sql).toContain("e.record->>'status'='active'");
    expect(sql).toContain('s.name=ANY($2::text[])');
    expect(sql).not.toContain('s.system');
    expect(sql).not.toContain('mechanicEnabled');
    expect(parameters).toEqual(['current', ['custom']]);
    query.mockResolvedValueOnce([]);
    expect(await repository.actor('current', ['custom'])).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('reads minimal selector, status omitted includes both and search stays parameterized', async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
        { id, fullName: 'Ana Perez', status: 'inactive' },
      ]);
    const search = "%' OR 1=1 --";
    expect(
      await repository.employees({ search, limit: 10, offset: 2 }),
    ).toEqual({
      items: [{ id, fullName: 'Ana Perez', status: 'inactive' }],
      total: 1,
      limit: 10,
      offset: 2,
    });
    expect(query.mock.calls[0][1]).toEqual([null, search]);
    expect(query.mock.calls[1][1]).toEqual([null, search, 10, 2]);
    for (const [sql] of query.mock.calls) {
      expect(sql).not.toContain(search);
      expect(sql).not.toContain('document');
      expect(sql).not.toContain('email');
    }
  });
  it.each(['active', 'inactive'] as const)(
    'applies explicit selector status %s',
    async (status) => {
      const { repository, query } = fixture();
      query.mockResolvedValueOnce([{ total: 0 }]);
      await repository.employees({ status, limit: 20, offset: 0 });
      expect(query.mock.calls[0][1]).toEqual([status, null]);
    },
  );
  it('enforces self ownership, excludes legacy and projects local status without global claims', async () => {
    const { repository, query } = fixture();
    const projected = {
      assignmentId: id,
      sagaId: id,
      orderId: id,
      employeeId: id,
      fullName: 'Ana Perez',
      employeeStatus: 'inactive',
      status: 'released',
      version: 3,
      orderConfirmedObserved: false,
    };
    query.mockResolvedValueOnce([
      {
        ...projected,
        starts_at: new Date('2026-10-28T12:00:00.000Z'),
        ends_at: new Date('2026-10-28T13:00:00.000Z'),
      },
    ]);
    expect(await repository.assignments([id], id)).toEqual([
      {
        ...projected,
        startsAt: '2026-10-28T12:00:00.000Z',
        endsAt: '2026-10-28T13:00:00.000Z',
      },
    ]);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([[id], id]);
    expect(sql).toContain('a.saga_id IS NOT NULL');
    expect(sql).toContain('a.order_id IS NOT NULL');
    expect(sql).toContain('a.employee_id=$2');
    expect(sql).not.toContain('SELECT *');
  });
  it('sanitizes persistence failure without returning an empty success', async () => {
    const { repository, query, runner } = fixture();
    query.mockRejectedValueOnce(new Error('private SQL'));
    await expect(repository.actor('current', [])).rejects.toMatchObject({
      status: 503,
      code: 'PERSISTENCE_UNAVAILABLE',
      message: 'PERSISTENCE_UNAVAILABLE',
    });
    expect(runner.rollbackTransaction).toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalled();
  });
  it('migration unions only agenda grants, preserves custom permissions and writes history/sync pending', async () => {
    const query = vi.fn();
    await new AddAgendaPermissions1793541600000().up({
      query,
    } as unknown as QueryRunner);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.map((call) => call[1])).toEqual([
      ['administrador', ['agenda:read:self', 'agenda:read:team']],
      ['jefe_taller', ['agenda:read:self', 'agenda:read:team']],
      ['mecanico', ['agenda:read:self']],
    ]);
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain('UNION');
      expect(sql).toContain("sync_status='pending'");
      expect(sql).toContain('security_history');
      expect(sql).toContain('NOT permissions @>');
      expect(sql).not.toContain('DELETE');
    }
  });
});
