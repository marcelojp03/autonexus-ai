/** CU04 web contract: schedules, absences and availability through the BFF. */
export interface StaffingEmployee { id: string; fullName: string; jobTitle: string; status: 'active' | 'inactive'; }
export interface Shift {
  id: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  breakStart: string | null;
  breakEnd: string | null;
  active: boolean;
  version: number;
}
export interface Absence { id: string; startsOn: string; endsOn: string; reason: string | null; active: boolean; version: number; }
export interface Schedule { employeeId: string; timezone: string; shifts: Shift[]; absences: Absence[]; }
export interface Availability {
  employeeId: string;
  date: string;
  weekday: number;
  available: Array<{ start: string; end: string }>;
  absent: boolean;
  assignments: Array<{ id: string; startsAt: string; endsAt: string; reference: string }>;
}

const SHIFT = 'id weekday startsAt endsAt breakStart breakEnd active version';

export const STAFFING_EMPLOYEES = `query Staffing($search: String) { staffingEmployees(search: $search) { id fullName jobTitle status } }`;
export const SCHEDULE_QUERY = `query Schedule($id: UUID!) { employeeSchedule(id: $id) { employeeId timezone shifts { ${SHIFT} } absences { id startsOn endsOn reason active version } } }`;
export const AVAILABILITY_QUERY = `query Availability($id: UUID!, $date: Date!) { employeeAvailability(id: $id, date: $date) { employeeId date weekday available { start end } absent assignments { id startsAt endsAt reference } } }`;
export const CREATE_SHIFT = `mutation CreateShift($employeeId: UUID!, $input: ShiftInput!) { createShift(employeeId: $employeeId, input: $input) { shift { ${SHIFT} } replayed acknowledgedAssignments } }`;
export const DEACTIVATE_SHIFT = `mutation DeactivateShift($id: UUID!, $input: StaffingCommandInput!) { deactivateShift(id: $id, input: $input) { shift { ${SHIFT} } replayed acknowledgedAssignments } }`;
export const CREATE_ABSENCE = `mutation CreateAbsence($employeeId: UUID!, $input: AbsenceInput!) { createAbsence(employeeId: $employeeId, input: $input) { absence { id startsOn endsOn reason active version } replayed acknowledgedAssignments } }`;
export const CANCEL_ABSENCE = `mutation CancelAbsence($id: UUID!, $input: StaffingCommandInput!) { cancelAbsence(id: $id, input: $input) { absence { id startsOn endsOn reason active version } replayed acknowledgedAssignments } }`;

export const WEEKDAYS: ReadonlyArray<{ value: number; label: string }> = Object.freeze([
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
]);
export const weekdayLabel = (value: number): string => WEEKDAYS.find(day => day.value === value)?.label ?? String(value);
