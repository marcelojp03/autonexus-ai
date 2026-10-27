import type { AbsenceView, ShiftInput, ShiftView } from '../domain/schedule.js';

export interface StaffingEmployee { id: string; fullName: string; jobTitle: string; status: 'active' | 'inactive'; }
export interface ScheduleView { employeeId: string; timezone: string; shifts: ShiftView[]; absences: AbsenceView[]; }
export interface AvailabilityView {
  employeeId: string;
  date: string;
  weekday: number;
  available: Array<{ start: string; end: string }>;
  absent: boolean;
  assignments: Array<{ id: string; startsAt: string; endsAt: string; reference: string }>;
}
export interface ShiftMutation { shift: ShiftView; replayed: boolean; acknowledgedAssignments: boolean; }
export interface AbsenceMutation { absence: AbsenceView; replayed: boolean; acknowledgedAssignments: boolean; }

/** Port for CU04 planning data. Assignments are read-only here and owned by the CU15 contract. */
export interface ScheduleRepository {
  employees(search?: string): Promise<StaffingEmployee[]>;
  schedule(employeeId: string): Promise<ScheduleView>;
  availability(employeeId: string, date: string): Promise<AvailabilityView>;
  createShift(employeeId: string, input: ShiftInput, actor: string, operationId: string, acknowledge: boolean): Promise<ShiftMutation>;
  updateShift(shiftId: string, input: ShiftInput, expectedVersion: number, actor: string, operationId: string, acknowledge: boolean): Promise<ShiftMutation>;
  deactivateShift(shiftId: string, expectedVersion: number, actor: string, operationId: string, acknowledge: boolean): Promise<ShiftMutation>;
  createAbsence(employeeId: string, input: { startsOn: string; endsOn: string; reason: string | null }, actor: string, operationId: string, acknowledge: boolean): Promise<AbsenceMutation>;
  cancelAbsence(absenceId: string, expectedVersion: number, actor: string, operationId: string, acknowledge: boolean): Promise<AbsenceMutation>;
}
