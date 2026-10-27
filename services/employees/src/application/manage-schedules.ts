import { absence, shift, weekdayOf, type AbsenceView, type ShiftView } from '../domain/schedule.js';
import { ScheduleError } from '../domain/schedule.js';
import type { AbsenceMutation, ScheduleRepository, ScheduleView, ShiftMutation, StaffingEmployee, AvailabilityView } from './schedule-repository.js';
import { uuid } from '../domain/employee.js';

const command = (value: unknown, keys: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ScheduleError(400, 'VALIDATION_ERROR');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !keys.includes(key))) throw new ScheduleError(400, 'VALIDATION_ERROR');
  return body;
};
const operation = (value: unknown): string => {
  if (typeof value !== 'string') throw new ScheduleError(400, 'VALIDATION_ERROR');
  return uuid(value);
};

export class ManageSchedules {
  constructor(private readonly repository: ScheduleRepository) {}

  employees(input: unknown): Promise<StaffingEmployee[]> {
    if (input === undefined || input === null) return this.repository.employees();
    const query = command(input, ['search']);
    if (query.search !== undefined && typeof query.search !== 'string') throw new ScheduleError(400, 'VALIDATION_ERROR');
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    if (search.length > 100) throw new ScheduleError(400, 'VALIDATION_ERROR');
    return this.repository.employees(search || undefined);
  }

  schedule(employeeId: unknown): Promise<ScheduleView> {
    return this.repository.schedule(uuid(employeeId));
  }

  availability(employeeId: unknown, date: unknown): Promise<AvailabilityView> {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date + 'T00:00:00Z').getTime())) {
      throw new ScheduleError(400, 'VALIDATION_ERROR');
    }
    const id = uuid(employeeId);
    if (!weekdayOf(date)) throw new ScheduleError(400, 'VALIDATION_ERROR');
    return this.repository.availability(id, date);
  }

  createShift(employeeId: unknown, body: unknown, actor: string): Promise<ShiftMutation> {
    const input = command(body, ['operationId', 'weekday', 'startsAt', 'endsAt', 'breakStart', 'breakEnd', 'acknowledgeConfirmedAssignments']);
    return this.repository.createShift(uuid(employeeId), shift(input), actor, operation(input.operationId), input.acknowledgeConfirmedAssignments === true);
  }

  updateShift(shiftId: unknown, body: unknown, actor: string): Promise<ShiftMutation> {
    const input = command(body, ['operationId', 'expectedVersion', 'weekday', 'startsAt', 'endsAt', 'breakStart', 'breakEnd', 'acknowledgeConfirmedAssignments']);
    const version = input.expectedVersion;
    if (!Number.isSafeInteger(version) || (version as number) < 1) throw new ScheduleError(400, 'VALIDATION_ERROR');
    return this.repository.updateShift(uuid(shiftId), shift(input), version as number, actor, operation(input.operationId), input.acknowledgeConfirmedAssignments === true);
  }

  deactivateShift(shiftId: unknown, body: unknown, actor: string): Promise<ShiftMutation> {
    const input = command(body, ['operationId', 'expectedVersion', 'acknowledgeConfirmedAssignments']);
    const version = input.expectedVersion;
    if (!Number.isSafeInteger(version) || (version as number) < 1) throw new ScheduleError(400, 'VALIDATION_ERROR');
    return this.repository.deactivateShift(uuid(shiftId), version as number, actor, operation(input.operationId), input.acknowledgeConfirmedAssignments === true);
  }

  createAbsence(employeeId: unknown, body: unknown, actor: string): Promise<AbsenceMutation> {
    const input = command(body, ['operationId', 'startsOn', 'endsOn', 'reason', 'acknowledgeConfirmedAssignments']);
    return this.repository.createAbsence(uuid(employeeId), absence(input), actor, operation(input.operationId), input.acknowledgeConfirmedAssignments === true);
  }

  cancelAbsence(absenceId: unknown, body: unknown, actor: string): Promise<AbsenceMutation> {
    const input = command(body, ['operationId', 'expectedVersion', 'acknowledgeConfirmedAssignments']);
    const version = input.expectedVersion;
    if (!Number.isSafeInteger(version) || (version as number) < 1) throw new ScheduleError(400, 'VALIDATION_ERROR');
    return this.repository.cancelAbsence(uuid(absenceId), version as number, actor, operation(input.operationId), input.acknowledgeConfirmedAssignments === true);
  }
}

export type { ShiftView, AbsenceView };
