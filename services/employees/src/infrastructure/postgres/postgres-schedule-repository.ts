import { createHash, randomUUID } from 'node:crypto';
import type { OnApplicationShutdown } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import { ScheduleError, weekdayOf, type AbsenceView, type ShiftInput, type ShiftView } from '../../domain/schedule.js';
import type {
  AbsenceMutation,
  AvailabilityView,
  ScheduleRepository,
  ScheduleView,
  ShiftMutation,
  StaffingEmployee,
} from '../../application/schedule-repository.js';
import { dataSourceOptions } from './data-source-options.js';

type ShiftRow = { id: string; weekday: number; starts_at: string; ends_at: string; break_start: string | null; break_end: string | null; active: boolean; version: number };
type AbsenceRow = { id: string; starts_on: string | Date; ends_on: string | Date; reason: string | null; active: boolean; version: number };
const hhmm = (value: string) => value.slice(0, 5);
const isoDate = (value: string | Date) => (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10));
const view = (row: ShiftRow): ShiftView => ({
  id: row.id,
  weekday: Number(row.weekday),
  startsAt: hhmm(row.starts_at),
  endsAt: hhmm(row.ends_at),
  breakStart: row.break_start ? hhmm(row.break_start) : null,
  breakEnd: row.break_end ? hhmm(row.break_end) : null,
  active: row.active,
  version: row.version,
});
const absenceView = (row: AbsenceRow): AbsenceView => ({
  id: row.id,
  startsOn: isoDate(row.starts_on),
  endsOn: isoDate(row.ends_on),
  reason: row.reason,
  active: row.active,
  version: row.version,
});

export class PostgresScheduleRepository implements ScheduleRepository, OnApplicationShutdown {
  private source?: DataSource;
  private initializing?: Promise<DataSource>;

  private async database(): Promise<DataSource> {
    this.source ??= new DataSource(dataSourceOptions());
    if (!this.source.isInitialized) {
      this.initializing ??= this.source.initialize();
      try { await this.initializing; } finally { this.initializing = undefined; }
    }
    return this.source;
  }

  async onApplicationShutdown(): Promise<void> {
    try { await this.initializing; } catch { /* no pool */ }
    if (this.source?.isInitialized) await this.source.destroy();
  }

  private failure(error: unknown): never {
    if (error instanceof ScheduleError) throw error;
    const sql = error as { code?: string };
    if (sql.code === '23514' || sql.code === '22P02' || sql.code === '22007') throw new ScheduleError(400, 'VALIDATION_ERROR');
    throw new ScheduleError(503, 'PERSISTENCE_UNAVAILABLE');
  }

  private async locked<T>(
    keys: string[],
    work: (runner: QueryRunner) => Promise<T>,
  ): Promise<T> {
    let runner: QueryRunner | undefined;
    const acquired: string[] = [];
    try {
      runner = (await this.database()).createQueryRunner();
      await runner.connect();
      for (const key of keys) {
        const rows = (await runner.query(
          'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
          [key],
        )) as Array<{ acquired: boolean }>;
        if (!rows[0]?.acquired)
          throw new ScheduleError(503, 'PERSISTENCE_UNAVAILABLE');
        acquired.push(key);
      }
      const employeeIds = new Set<string>();
      for (const key of keys) {
        let employeeId: string | undefined;
        if (key.startsWith('staffing:')) employeeId = key.slice(9);
        if (key.startsWith('shift:') || key.startsWith('absence:')) {
          const table = key.startsWith('shift:')
            ? 'employee_shifts'
            : 'employee_absences';
          const rows = (await runner.query(
            'SELECT employee_id FROM employees.' + table + ' WHERE id=$1',
            [key.slice(key.indexOf(':') + 1)],
          )) as Array<{ employee_id: string }>;
          employeeId = rows[0]?.employee_id;
        }
        if (employeeId) employeeIds.add(employeeId);
      }
      for (const id of employeeIds) {
        const key = 'employee:' + id;
        const rows = (await runner.query(
          'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
          [key],
        )) as Array<{ acquired: boolean }>;
        if (!rows[0]?.acquired)
          throw new ScheduleError(503, 'PERSISTENCE_UNAVAILABLE');
        acquired.push(key);
      }
      await runner.startTransaction();
      try {
        const result = await work(runner);
        for (const id of employeeIds) await this.protectPending(runner, id);
        await runner.commitTransaction();
        return result;
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      }
    } catch (error) {
      return this.failure(error);
    } finally {
      if (runner) {
        for (const key of acquired.reverse()) {
          try {
            await runner.query(
              'SELECT pg_advisory_unlock(hashtextextended($1,0))',
              [key],
            );
          } catch {
            /* broken connections are discarded */
          }
        }
        await runner.release();
      }
    }
  }

  private async protectPending(
    runner: QueryRunner,
    employeeId: string,
  ): Promise<void> {
    const invalid = (await runner.query(
      `SELECT a.id FROM employees.employee_assignments a WHERE a.employee_id=$1 AND a.saga_id IS NOT NULL AND a.status IN ('reserved','confirmed') AND NOT a.order_confirmed_observed AND (
        EXISTS (SELECT 1 FROM employees.employee_absences x WHERE x.employee_id=a.employee_id AND x.active AND x.starts_on <= (a.starts_at AT TIME ZONE 'America/La_Paz')::date AND x.ends_on >= (a.starts_at AT TIME ZONE 'America/La_Paz')::date)
        OR NOT EXISTS (SELECT 1 FROM employees.employee_shifts s WHERE s.employee_id=a.employee_id AND s.active AND s.weekday=EXTRACT(ISODOW FROM (a.starts_at AT TIME ZONE 'America/La_Paz')) AND s.starts_at <= (a.starts_at AT TIME ZONE 'America/La_Paz')::time AND s.ends_at >= (a.ends_at AT TIME ZONE 'America/La_Paz')::time AND (s.break_start IS NULL OR s.break_start >= (a.ends_at AT TIME ZONE 'America/La_Paz')::time OR s.break_end <= (a.starts_at AT TIME ZONE 'America/La_Paz')::time)))`,
      [employeeId],
    )) as Array<{ id: string }>;
    if (invalid.length)
      throw new ScheduleError(409, 'AFFECTS_PENDING_CONFIRMATION');
  }

  private async employee(runner: QueryRunner, employeeId: string): Promise<{ id: string; firstName: string; lastName: string; jobTitle: string; status: string }> {
    const rows = await runner.query("SELECT id, record->>'firstName' AS \"firstName\", record->>'lastName' AS \"lastName\", record->>'jobTitle' AS \"jobTitle\", record->>'status' AS status FROM employees.employee_records WHERE id=$1", [employeeId]) as Array<{ id: string; firstName: string; lastName: string; jobTitle: string; status: string }>;
    if (!rows[0]) throw new ScheduleError(404, 'EMPLOYEE_NOT_FOUND');
    return rows[0];
  }

  private async requireActive(runner: QueryRunner, employeeId: string): Promise<void> {
    const employee = await this.employee(runner, employeeId);
    if (employee.status !== 'active') throw new ScheduleError(409, 'EMPLOYEE_INACTIVE');
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async replay<T>(runner: QueryRunner, operationId: string, fingerprint: string): Promise<T | null> {
    const rows = await runner.query('SELECT fingerprint, result FROM employees.staffing_operations WHERE operation_id=$1', [operationId]) as Array<{ fingerprint: string; result: T }>;
    if (!rows[0]) return null;
    if (rows[0].fingerprint !== fingerprint) throw new ScheduleError(409, 'IDEMPOTENCY_CONFLICT');
    return rows[0].result;
  }

  private async remember(runner: QueryRunner, operationId: string, fingerprint: string, result: unknown): Promise<void> {
    await runner.query('INSERT INTO employees.staffing_operations(operation_id, fingerprint, result) VALUES($1,$2,$3::jsonb)', [operationId, fingerprint, JSON.stringify(result)]);
  }

  private async audit(runner: QueryRunner, entity: 'shift' | 'absence', entityId: string, employeeId: string, action: string, actor: string, version: number, snapshot: unknown): Promise<void> {
    await runner.query(
      'INSERT INTO employees.staffing_audit(id, entity, entity_id, employee_id, action, actor_subject, occurred_at, version, snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
      [randomUUID(), entity, entityId, employeeId, action, actor, new Date().toISOString(), version, JSON.stringify(snapshot)],
    );
  }

  async employees(search?: string): Promise<StaffingEmployee[]> {
    return this.locked([], async runner => {
      const rows = await runner.query(
        `SELECT id, (record->>'firstName') || ' ' || (record->>'lastName') AS "fullName", record->>'jobTitle' AS "jobTitle", record->>'status' AS status
         FROM employees.employee_records
         WHERE record->>'status'='active' AND ($1::text IS NULL OR strpos(lower((record->>'firstName') || ' ' || (record->>'lastName')), lower($1)) > 0 OR strpos(lower(record->>'document'), lower($1)) > 0)
         ORDER BY lower(record->>'lastName'), lower(record->>'firstName') LIMIT 100`,
        [search ?? null],
      ) as StaffingEmployee[];
      return rows;
    });
  }

  async schedule(employeeId: string): Promise<ScheduleView> {
    return this.locked([], async runner => {
      await this.employee(runner, employeeId);
      const shifts = await runner.query('SELECT id, weekday, starts_at, ends_at, break_start, break_end, active, version FROM employees.employee_shifts WHERE employee_id=$1 ORDER BY weekday, starts_at', [employeeId]) as ShiftRow[];
      const absences = await runner.query('SELECT id, starts_on, ends_on, reason, active, version FROM employees.employee_absences WHERE employee_id=$1 ORDER BY starts_on', [employeeId]) as AbsenceRow[];
      return { employeeId, timezone: 'America/La_Paz', shifts: shifts.map(view), absences: absences.map(absenceView) };
    });
  }

  async availability(employeeId: string, date: string): Promise<AvailabilityView> {
    return this.locked([], async runner => {
      await this.employee(runner, employeeId);
      const weekday = weekdayOf(date);
      const shifts = await runner.query('SELECT id, weekday, starts_at, ends_at, break_start, break_end, active, version FROM employees.employee_shifts WHERE employee_id=$1 AND weekday=$2 AND active', [employeeId, weekday]) as ShiftRow[];
      const absences = await runner.query('SELECT id FROM employees.employee_absences WHERE employee_id=$1 AND active AND starts_on <= $2::date AND ends_on >= $2::date', [employeeId, date]) as Array<{ id: string }>;
      const assignments = await runner.query(
        `SELECT id, starts_at, ends_at, reference FROM employees.employee_assignments
         WHERE employee_id=$1 AND status='confirmed' AND (saga_id IS NULL OR order_confirmed_observed) AND (starts_at AT TIME ZONE 'America/La_Paz')::date <= $2::date AND (ends_at AT TIME ZONE 'America/La_Paz')::date >= $2::date
         ORDER BY starts_at`,
        [employeeId, date],
      ) as Array<{ id: string; starts_at: Date; ends_at: Date; reference: string }>;
      const reservations = await runner.query(`SELECT id,saga_id,order_id,starts_at,ends_at,status,version,order_confirmed_observed FROM employees.employee_assignments WHERE employee_id=$1 AND saga_id IS NOT NULL AND status IN ('reserved','confirmed') AND NOT order_confirmed_observed AND (starts_at AT TIME ZONE 'America/La_Paz')::date=$2::date ORDER BY starts_at`,[employeeId,date]) as Array<{id:string;saga_id:string;order_id:string;starts_at:Date;ends_at:Date;status:'reserved'|'confirmed';version:number;order_confirmed_observed:boolean}>;
      const { slots } = await import('../../domain/schedule.js');
      const available = absences.length ? [] : shifts.flatMap(row => slots(view(row), date));
      return {
        employeeId,
        date,
        weekday,
        available,
        reservations: reservations.map(row => ({id:row.id,sagaId:row.saga_id,orderId:row.order_id,startsAt:row.starts_at.toISOString(),endsAt:row.ends_at.toISOString(),status:row.status,version:row.version,orderConfirmedObserved:row.order_confirmed_observed})),
        absent: absences.length > 0,
        assignments: assignments.map(row => ({ id: row.id, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(), reference: row.reference })),
      };
    });
  }

  private async shiftConflicts(runner: QueryRunner, employeeId: string, input: ShiftInput, excludeShiftId: string | null): Promise<void> {
    const overlap = await runner.query(
      'SELECT id FROM employees.employee_shifts WHERE employee_id=$1 AND weekday=$2 AND active AND ($3::uuid IS NULL OR id<>$3) AND starts_at < $5::time AND ends_at > $4::time',
      [employeeId, input.weekday, excludeShiftId, input.startsAt, input.endsAt],
    ) as Array<{ id: string }>;
    if (overlap.length) throw new ScheduleError(409, 'SHIFT_OVERLAP');
  }

  private async assignmentConflict(runner: QueryRunner, employeeId: string, input: ShiftInput): Promise<boolean> {
    const rows = await runner.query(
      `SELECT id FROM employees.employee_assignments WHERE employee_id=$1 AND status='confirmed'
       AND EXTRACT(ISODOW FROM (starts_at AT TIME ZONE 'America/La_Paz'))=$2
       AND (starts_at AT TIME ZONE 'America/La_Paz')::time < $4::time
       AND (ends_at AT TIME ZONE 'America/La_Paz')::time > $3::time`,
      [employeeId, input.weekday, input.startsAt, input.endsAt],
    ) as Array<{ id: string }>;
    return rows.length > 0;
  }

  private async absenceAssignmentConflict(runner: QueryRunner, employeeId: string, startsOn: string, endsOn: string): Promise<boolean> {
    const rows = await runner.query(
      `SELECT id FROM employees.employee_assignments WHERE employee_id=$1 AND status='confirmed'
       AND (starts_at AT TIME ZONE 'America/La_Paz')::date <= $3::date AND (ends_at AT TIME ZONE 'America/La_Paz')::date >= $2::date`,
      [employeeId, startsOn, endsOn],
    ) as Array<{ id: string }>;
    return rows.length > 0;
  }

  async createShift(employeeId: string, input: ShiftInput, actor: string, operationId: string, acknowledge: boolean): Promise<ShiftMutation> {
    const fingerprint = this.fingerprint({ actor, action: 'create-shift', employeeId, input, acknowledge });
    return this.locked(['staffing-operation:' + operationId, 'staffing:' + employeeId], async runner => {
      const replayed = await this.replay<ShiftMutation>(runner, operationId, fingerprint);
      if (replayed) return { ...replayed, replayed: true };
      await this.requireActive(runner, employeeId);
      await this.shiftConflicts(runner, employeeId, input, null);
      const affected = await this.assignmentConflict(runner, employeeId, input);
      if (affected && !acknowledge) throw new ScheduleError(409, 'AFFECTS_CONFIRMED_ASSIGNMENT');
      const id = randomUUID();
      const now = new Date().toISOString();
      await runner.query(
        'INSERT INTO employees.employee_shifts(id, employee_id, weekday, starts_at, ends_at, break_start, break_end, active, version, created_at, updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,1,$8,$8)',
        [id, employeeId, input.weekday, input.startsAt, input.endsAt, input.breakStart ?? null, input.breakEnd ?? null, now],
      );
      const shiftView: ShiftView = { id, weekday: input.weekday, startsAt: input.startsAt, endsAt: input.endsAt, breakStart: input.breakStart ?? null, breakEnd: input.breakEnd ?? null, active: true, version: 1 };
      const result: ShiftMutation = { shift: shiftView, replayed: false, acknowledgedAssignments: affected };
      await this.audit(runner, 'shift', id, employeeId, 'created', actor, 1, shiftView);
      await this.remember(runner, operationId, fingerprint, { shift: shiftView, replayed: false, acknowledgedAssignments: affected });
      return result;
    });
  }

  async updateShift(shiftId: string, input: ShiftInput, expectedVersion: number, actor: string, operationId: string, acknowledge: boolean): Promise<ShiftMutation> {
    const fingerprint = this.fingerprint({ actor, action: 'update-shift', shiftId, input, expectedVersion, acknowledge });
    return this.locked(['staffing-operation:' + operationId, 'shift:' + shiftId], async runner => {
      const rows = await runner.query('SELECT id, employee_id, weekday, starts_at, ends_at, break_start, break_end, active, version FROM employees.employee_shifts WHERE id=$1', [shiftId]) as Array<ShiftRow & { employee_id: string }>;
      if (!rows[0]) throw new ScheduleError(404, 'SHIFT_NOT_FOUND');
      const employeeId = rows[0].employee_id;
      const replayed = await this.replay<ShiftMutation>(runner, operationId, fingerprint);
      if (replayed) return { ...replayed, replayed: true };
      if (rows[0].version !== expectedVersion) throw new ScheduleError(409, 'VERSION_CONFLICT');
      await this.requireActive(runner, employeeId);
      await this.shiftConflicts(runner, employeeId, input, shiftId);
      const affected = await this.assignmentConflict(runner, employeeId, input) || await this.assignmentConflict(runner, employeeId, view(rows[0]));
      if (affected && !acknowledge) throw new ScheduleError(409, 'AFFECTS_CONFIRMED_ASSIGNMENT');
      const version = expectedVersion + 1;
      await runner.query(
        'UPDATE employees.employee_shifts SET weekday=$2, starts_at=$3, ends_at=$4, break_start=$5, break_end=$6, version=$7, updated_at=$8 WHERE id=$1',
        [shiftId, input.weekday, input.startsAt, input.endsAt, input.breakStart ?? null, input.breakEnd ?? null, version, new Date().toISOString()],
      );
      const shiftView: ShiftView = { id: shiftId, weekday: input.weekday, startsAt: input.startsAt, endsAt: input.endsAt, breakStart: input.breakStart ?? null, breakEnd: input.breakEnd ?? null, active: true, version };
      await this.audit(runner, 'shift', shiftId, employeeId, 'updated', actor, version, shiftView);
      await this.remember(runner, operationId, fingerprint, { shift: shiftView, replayed: false, acknowledgedAssignments: affected });
      return { shift: shiftView, replayed: false, acknowledgedAssignments: affected };
    });
  }

  async deactivateShift(shiftId: string, expectedVersion: number, actor: string, operationId: string, acknowledge: boolean): Promise<ShiftMutation> {
    const fingerprint = this.fingerprint({ actor, action: 'deactivate-shift', shiftId, expectedVersion, acknowledge });
    return this.locked(['staffing-operation:' + operationId, 'shift:' + shiftId], async runner => {
      const rows = await runner.query('SELECT id, employee_id, weekday, starts_at, ends_at, break_start, break_end, active, version FROM employees.employee_shifts WHERE id=$1', [shiftId]) as Array<ShiftRow & { employee_id: string }>;
      if (!rows[0]) throw new ScheduleError(404, 'SHIFT_NOT_FOUND');
      const current = rows[0];
      const replayed = await this.replay<ShiftMutation>(runner, operationId, fingerprint);
      if (replayed) return { ...replayed, replayed: true };
      if (current.version !== expectedVersion) throw new ScheduleError(409, 'VERSION_CONFLICT');
      const input = view(current);
      const affected = await this.assignmentConflict(runner, current.employee_id, input);
      if (affected && !acknowledge) throw new ScheduleError(409, 'AFFECTS_CONFIRMED_ASSIGNMENT');
      if (current.active) {
        const version = expectedVersion + 1;
        await runner.query('UPDATE employees.employee_shifts SET active=false, version=$2, updated_at=$3 WHERE id=$1', [shiftId, version, new Date().toISOString()]);
        const snapshot = { ...input, active: false, version };
        await this.audit(runner, 'shift', shiftId, current.employee_id, 'deactivated', actor, version, snapshot);
        const result: ShiftMutation = { shift: snapshot, replayed: false, acknowledgedAssignments: affected };
        await this.remember(runner, operationId, fingerprint, { ...result, replayed: false });
        return result;
      }
      const result: ShiftMutation = { shift: { ...input, active: false }, replayed: false, acknowledgedAssignments: affected };
      await this.remember(runner, operationId, fingerprint, result);
      return result;
    });
  }

  async createAbsence(employeeId: string, input: { startsOn: string; endsOn: string; reason: string | null }, actor: string, operationId: string, acknowledge: boolean): Promise<AbsenceMutation> {
    const fingerprint = this.fingerprint({ actor, action: 'create-absence', employeeId, input, acknowledge });
    return this.locked(['staffing-operation:' + operationId, 'staffing:' + employeeId], async runner => {
      const replayed = await this.replay<AbsenceMutation>(runner, operationId, fingerprint);
      if (replayed) return { ...replayed, replayed: true };
      await this.requireActive(runner, employeeId);
      const overlap = await runner.query('SELECT id FROM employees.employee_absences WHERE employee_id=$1 AND active AND starts_on <= $3::date AND ends_on >= $2::date', [employeeId, input.startsOn, input.endsOn]) as Array<{ id: string }>;
      if (overlap.length) throw new ScheduleError(409, 'ABSENCE_OVERLAP');
      const affected = await this.absenceAssignmentConflict(runner, employeeId, input.startsOn, input.endsOn);
      if (affected && !acknowledge) throw new ScheduleError(409, 'AFFECTS_CONFIRMED_ASSIGNMENT');
      const id = randomUUID();
      const now = new Date().toISOString();
      await runner.query(
        'INSERT INTO employees.employee_absences(id, employee_id, starts_on, ends_on, reason, active, version, created_at, updated_at) VALUES($1,$2,$3,$4,$5,true,1,$6,$6)',
        [id, employeeId, input.startsOn, input.endsOn, input.reason, now],
      );
      const absence: AbsenceView = { id, startsOn: input.startsOn, endsOn: input.endsOn, reason: input.reason, active: true, version: 1 };
      await this.audit(runner, 'absence', id, employeeId, 'created', actor, 1, absence);
      await this.remember(runner, operationId, fingerprint, { absence, replayed: false, acknowledgedAssignments: affected });
      return { absence, replayed: false, acknowledgedAssignments: affected };
    });
  }

  async cancelAbsence(absenceId: string, expectedVersion: number, actor: string, operationId: string, acknowledge: boolean): Promise<AbsenceMutation> {
    const fingerprint = this.fingerprint({ actor, action: 'cancel-absence', absenceId, expectedVersion, acknowledge });
    return this.locked(['staffing-operation:' + operationId, 'absence:' + absenceId], async runner => {
      const rows = await runner.query('SELECT id, employee_id, starts_on, ends_on, reason, active, version FROM employees.employee_absences WHERE id=$1', [absenceId]) as Array<AbsenceRow & { employee_id: string }>;
      if (!rows[0]) throw new ScheduleError(404, 'ABSENCE_NOT_FOUND');
      const current = rows[0];
      const replayed = await this.replay<AbsenceMutation>(runner, operationId, fingerprint);
      if (replayed) return { ...replayed, replayed: true };
      if (current.version !== expectedVersion) throw new ScheduleError(409, 'VERSION_CONFLICT');
      const currentView = absenceView(current);
      const affected = await this.absenceAssignmentConflict(runner, current.employee_id, currentView.startsOn, currentView.endsOn);
      if (affected && !acknowledge) throw new ScheduleError(409, 'AFFECTS_CONFIRMED_ASSIGNMENT');
      if (current.active) {
        const version = expectedVersion + 1;
        await runner.query('UPDATE employees.employee_absences SET active=false, version=$2, updated_at=$3 WHERE id=$1', [absenceId, version, new Date().toISOString()]);
        const snapshot = { ...currentView, active: false, version };
        await this.audit(runner, 'absence', absenceId, current.employee_id, 'cancelled', actor, version, snapshot);
        const result: AbsenceMutation = { absence: snapshot, replayed: false, acknowledgedAssignments: affected };
        await this.remember(runner, operationId, fingerprint, result);
        return result;
      }
      const result: AbsenceMutation = { absence: currentView, replayed: false, acknowledgedAssignments: affected };
      await this.remember(runner, operationId, fingerprint, result);
      return result;
    });
  }
}
