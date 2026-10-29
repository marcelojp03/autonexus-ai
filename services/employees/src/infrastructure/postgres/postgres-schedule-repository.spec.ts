import { randomUUID } from 'node:crypto';
import { PostgresScheduleRepository } from './postgres-schedule-repository.js';
const employeeId = '11111111-1111-4111-8111-111111111111';
const shiftId = '22222222-2222-4222-8222-222222222222';
function fixture(invalidPending = false) {
  const query = vi.fn(async (sql: string, _parameters: unknown[] = []) => {
    if (sql.startsWith('SELECT pg_try')) return [{ acquired: true }];
    if (sql.startsWith('SELECT employee_id'))
      return [{ employee_id: employeeId }];
    if (sql.includes('record->>'))
      return [{ id: employeeId, status: 'active' }];
    if (sql.includes('FROM employees.staffing_operations')) return [];
    if (sql.includes('FROM employees.employee_shifts WHERE id='))
      return [
        {
          id: shiftId,
          employee_id: employeeId,
          weekday: 3,
          starts_at: '09:00:00',
          ends_at: '17:00:00',
          break_start: null,
          break_end: null,
          active: true,
          version: 1,
        },
      ];
    if (sql.includes('SELECT a.id'))
      return invalidPending ? [{ id: shiftId }] : [];
    return [];
  });
  const runner = {
    query,
    connect: vi.fn(),
    release: vi.fn(),
    startTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn(),
  };
  const repository = new PostgresScheduleRepository();
  Object.assign(repository, {
    database: async () => ({ createQueryRunner: () => runner }),
  });
  return { repository, runner, query };
}
describe('CU04 shared lock and atomicity regressions (runner fake)', () => {
  it.each(['shift', 'absence'] as const)(
    'serializes creation by employee for %s',
    async (entity) => {
      const { repository: r, runner, query } = fixture();
      if (entity === 'shift')
        await r.createShift(
          employeeId,
          {
            weekday: 3,
            startsAt: '09:00',
            endsAt: '17:00',
            breakStart: null,
            breakEnd: null,
          },
          'human',
          randomUUID(),
          false,
        );
      else
        await r.createAbsence(
          employeeId,
          { startsOn: '2099-10-28', endsOn: '2099-10-28', reason: null },
          'human',
          randomUUID(),
          false,
        );
      expect(
        query.mock.calls.some(
          ([sql, p]: unknown[]) =>
            String(sql).startsWith('SELECT pg_try') &&
            (p as unknown[])?.[0] === 'employee:' + employeeId,
        ),
      ).toBe(true);
      expect(runner.startTransaction).toHaveBeenCalledOnce();
      expect(runner.commitTransaction).toHaveBeenCalledOnce();
      expect(runner.rollbackTransaction).not.toHaveBeenCalled();
      const statements = query.mock.calls.map(([sql]) => sql);
      expect(
        statements.some((sql) =>
          sql.includes('INSERT INTO employees.staffing_audit'),
        ),
      ).toBe(true);
      expect(
        statements.some((sql) =>
          sql.includes('INSERT INTO employees.staffing_operations'),
        ),
      ).toBe(true);
    },
  );
  it('resolves shift owner and shares employee lock before mutation', async () => {
    const { repository: r, query } = fixture();
    await r.deactivateShift(shiftId, 1, 'human', randomUUID(), true);
    expect(
      query.mock.calls.some(
        ([sql, p]: unknown[]) =>
          String(sql).startsWith('SELECT pg_try') &&
          (p as unknown[])?.[0] === 'employee:' + employeeId,
      ),
    ).toBe(true);
  });
  it('rolls back an invalidating change even with CU04 acknowledgment', async () => {
    const { repository: r, runner } = fixture(true);
    await expect(
      r.createAbsence(
        employeeId,
        { startsOn: '2099-10-28', endsOn: '2099-10-28', reason: null },
        'human',
        randomUUID(),
        true,
      ),
    ).rejects.toMatchObject({ code: 'AFFECTS_PENDING_CONFIRMATION' });
    expect(runner.rollbackTransaction).toHaveBeenCalledOnce();
    expect(runner.commitTransaction).not.toHaveBeenCalled();
  });
});
