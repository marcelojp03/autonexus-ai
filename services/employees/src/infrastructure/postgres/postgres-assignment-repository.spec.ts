import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { PostgresAssignmentRepository } from './postgres-assignment-repository.js';
import {
  CU15_CLIENT,
  type CommandResult,
  type CommandBody,
} from '../../domain/assignment.js';

const sagaId = '11111111-1111-4111-8111-111111111111';
const employeeId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const reserve = (): CommandBody => ({
  operationId: randomUUID(),
  expectedVersion: 0,
  initiatedBy: 'human',
  authorizedAt: '2026-10-28T12:00:00.000Z',
  orderId,
  employeeId,
  employeeVersion: 1,
  requiredSpecialty: 'Motor',
  startsAt: '2099-10-28T13:00:00.000Z',
  endsAt: '2099-10-28T14:00:00.000Z',
});
const next = (version: number): CommandBody => ({
  operationId: randomUUID(),
  expectedVersion: version,
  initiatedBy: 'human',
  authorizedAt: '2026-10-28T12:00:00.000Z',
});
function fixture() {
  const state = {
    row: null as Record<string, unknown> | null,
    tombstone: 0,
    ledger: new Map<string, CommandResult>(),
    outbox: [] as unknown[],
    audit: [] as unknown[],
    shifts: true,
    absent: false,
    overlap: false,
    sameDay: true,
    active: true,
    enabled: true,
    version: 1,
    fail: false,
  };
  const query = vi.fn(async (sql: string, p: unknown[] = []) => {
    if (sql.startsWith('SELECT pg_')) return [];
    if (sql.startsWith('SELECT result FROM employees.cu15_operations'))
      return state.ledger.has(p[0] as string)
        ? [{ result: structuredClone(state.ledger.get(p[0] as string)) }]
        : [];
    if (sql === 'SELECT * FROM employees.employee_assignments WHERE saga_id=$1')
      return state.row ? [state.row] : [];
    if (sql.startsWith('SELECT version FROM employees.cu15_tombstones'))
      return state.tombstone ? [{ version: state.tombstone }] : [];
    if (sql.startsWith('SELECT record'))
      return [
        {
          record: {
            status: state.active ? 'active' : 'inactive',
            mechanicEnabled: state.enabled,
            specialties: ['Motor'],
            version: state.version,
          },
        },
      ];
    if (sql.includes(' AS same_day')) return [{ same_day: state.sameDay }];
    if (sql.startsWith('SELECT id FROM employees.employee_shifts'))
      return state.shifts ? [{ id: employeeId }] : [];
    if (sql.startsWith('SELECT id FROM employees.employee_absences'))
      return state.absent ? [{ id: employeeId }] : [];
    if (sql.includes('AND id<>$4'))
      return state.overlap ? [{ id: employeeId }] : [];
    if (sql.includes('WHERE order_id=$1')) return [];
    if (sql.startsWith('INSERT INTO employees.employee_assignments')) {
      state.row = {
        id: p[0],
        employee_id: p[1],
        starts_at: new Date(p[2] as string),
        ends_at: new Date(p[3] as string),
        status: 'reserved',
        saga_id: p[5],
        order_id: p[4],
        required_specialty: p[6],
        version: 1,
        order_confirmed_observed: false,
      };
      return [];
    }
    if (sql.startsWith('UPDATE employees.employee_assignments')) {
      state.row!.status = sql.includes("status='confirmed'")
        ? 'confirmed'
        : 'released';
      state.row!.version = Number(state.row!.version) + 1;
      return [[], 1];
    }
    if (sql.startsWith('INSERT INTO employees.cu15_tombstones')) {
      state.tombstone = 1;
      return [];
    }
    if (sql.startsWith('INSERT INTO employees.cu15_operations')) {
      if (state.fail) throw new Error('simulated SQL outage');
      state.ledger.set(
        p[0] as string,
        JSON.parse(p[5] as string) as CommandResult,
      );
      return [];
    }
    if (sql.startsWith('INSERT INTO employees.cu15_audit')) {
      state.audit.push(p);
      return [];
    }
    if (sql.startsWith('INSERT INTO employees.cu15_outbox')) {
      state.outbox.push(JSON.parse(p[7] as string));
      return [];
    }
    throw new Error('Unimplemented test SQL ' + sql);
  });
  const repository = new PostgresAssignmentRepository();
  const transaction = vi
    .spyOn(repository, 'transaction')
    .mockImplementation(async (work) =>
      work({ query } as unknown as QueryRunner),
    );
  return { state, query, repository, transaction };
}
describe('CU15 participant command semantics (SQL runner fake; not PostgreSQL acceptance)', () => {
  it('stores effect, ledger, audit and Outbox in one transaction callback; replay is historical', async () => {
    const { repository: r, state, query, transaction } = fixture();
    const body = reserve();
    const first = await r.execute(
      sagaId,
      'reserve_assignment',
      body,
      CU15_CLIENT,
    );
    expect(first.outcome).toBe('applied');
    expect(first.resource).toMatchObject({
      status: 'reserved',
      version: 1,
      orderConfirmedObserved: false,
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(state.ledger.size).toBe(1);
    expect(state.audit).toHaveLength(1);
    expect(state.outbox).toHaveLength(1);
    expect(
      query.mock.calls.some(
        ([sql, p]) =>
          sql.startsWith('SELECT pg_') && p?.[0] === 'employee:' + employeeId,
      ),
    ).toBe(true);
    const confirmed = await r.execute(
      sagaId,
      'confirm_assignment',
      next(1),
      CU15_CLIENT,
    );
    expect(confirmed.resource).toMatchObject({
      status: 'confirmed',
      version: 2,
    });
    await r.execute(
      sagaId,
      'release_assignment',
      { ...next(2), reasonCode: 'COMPENSATION' },
      CU15_CLIENT,
    );
    const replay = await r.execute(
      sagaId,
      'reserve_assignment',
      body,
      CU15_CLIENT,
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await r.get(sagaId)).toMatchObject({
      status: 'released',
      version: 3,
    });
    expect(state.outbox).toHaveLength(3);
    expect(await r.operation(body.operationId)).toEqual(first);
  });
  it.each([
    'active',
    'enabled',
    'shifts',
    'sameDay',
    'version',
    'absent',
    'overlap',
  ] as const)('records a durable business rejection for %s', async (key) => {
    const { repository: r, state } = fixture();
    if (key === 'version') state.version = 2;
    else state[key] = key === 'absent' || key === 'overlap';
    const body = reserve();
    const rejected = await r.execute(
      sagaId,
      'reserve_assignment',
      body,
      CU15_CLIENT,
    );
    expect(rejected.outcome).toBe('rejected');
    expect(rejected.resource).toBeNull();
    expect(rejected.errorCode).toBeTruthy();
    expect(state.row).toBeNull();
    expect(state.outbox).toHaveLength(1);
    expect(state.audit).toHaveLength(1);
    expect(await r.operation(body.operationId)).toEqual(rejected);
    expect(
      await r.execute(sagaId, 'reserve_assignment', body, CU15_CLIENT),
    ).toEqual({ ...rejected, replayed: true });
  });
  it('does not bind confirm to a later unrelated employee version', async () => {
    const { repository: r, state } = fixture();
    await r.execute(sagaId, 'reserve_assignment', reserve(), CU15_CLIENT);
    state.version = 10;
    expect(
      (await r.execute(sagaId, 'confirm_assignment', next(1), CU15_CLIENT))
        .outcome,
    ).toBe('applied');
  });
  it('revalidates absences at confirmation and preserves the reservation on rejection', async () => {
    const { repository: r, state } = fixture();
    await r.execute(sagaId, 'reserve_assignment', reserve(), CU15_CLIENT);
    state.absent = true;
    const rejected = await r.execute(
      sagaId,
      'confirm_assignment',
      next(1),
      CU15_CLIENT,
    );
    expect(rejected.errorCode).toBe('EMPLOYEE_ABSENT');
    expect(state.row!.status).toBe('reserved');
  });
  it('makes terminal absence releases immune to late reserve/confirm', async () => {
    const { repository: r, state } = fixture();
    expect(
      (
        await r.execute(
          sagaId,
          'release_assignment',
          { ...next(0), reasonCode: 'COMPENSATION' },
          CU15_CLIENT,
        )
      ).resource,
    ).toEqual({ sagaId, status: 'released', version: 1, tombstone: true });
    expect(
      (await r.execute(sagaId, 'reserve_assignment', reserve(), CU15_CLIENT))
        .errorCode,
    ).toBe('ASSIGNMENT_RELEASED');
    expect(
      (await r.execute(sagaId, 'confirm_assignment', next(1), CU15_CLIENT))
        .errorCode,
    ).toBe('ASSIGNMENT_RELEASED');
    expect(state.row).toBeNull();
  });
  it('rejects stale versions without changing current assignment', async () => {
    const { repository: r, state } = fixture();
    await r.execute(sagaId, 'reserve_assignment', reserve(), CU15_CLIENT);
    expect(
      (
        await r.execute(
          sagaId,
          'release_assignment',
          { ...next(9), reasonCode: 'COMPENSATION' },
          CU15_CLIENT,
        )
      ).errorCode,
    ).toBe('VERSION_CONFLICT');
    expect(state.row!.status).toBe('reserved');
  });
  it('reports idempotency conflict outside the durable rejected envelope', async () => {
    const { repository: r, state } = fixture();
    const body = reserve();
    await r.execute(sagaId, 'reserve_assignment', body, CU15_CLIENT);
    await expect(
      r.execute(
        sagaId,
        'reserve_assignment',
        { ...body, employeeVersion: 2 },
        CU15_CLIENT,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    expect(state.outbox).toHaveLength(1);
  });
  it('never converts a SQL/transient failure into rejected or an event', async () => {
    const { repository: r, state } = fixture();
    state.fail = true;
    await expect(
      r.execute(sagaId, 'reserve_assignment', reserve(), CU15_CLIENT),
    ).rejects.toThrow('simulated SQL outage');
    expect(state.outbox).toHaveLength(0);
    expect(state.ledger.size).toBe(0);
  });
  it('treats ledger404 as unknown, not rejected', async () => {
    const { repository: r } = fixture();
    await expect(r.operation(randomUUID())).rejects.toMatchObject({
      status: 404,
      code: 'OPERATION_NOT_FOUND',
    });
  });
});
