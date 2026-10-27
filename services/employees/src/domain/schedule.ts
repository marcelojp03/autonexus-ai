export class ScheduleError extends Error {
  constructor(readonly statusCode: number, readonly code: string) { super(code); this.name = 'ScheduleError'; }
}
export const scheduleInvalid = (): never => { throw new ScheduleError(400, 'VALIDATION_ERROR'); };
export const SHIFT_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof SHIFT_WEEKDAYS)[number];
export interface ShiftInput { weekday: number; startsAt: string; endsAt: string; breakStart?: string | null; breakEnd?: string | null; }
export interface ShiftView extends Required<ShiftInput> { id: string; active: boolean; version: number; }
export interface AbsenceView { id: string; startsOn: string; endsOn: string; reason: string | null; active: boolean; version: number; }
export interface AssignmentView { id: string; startsAt: string; endsAt: string; reference: string; }
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const minutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

export function shift(input: unknown): ShiftInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return scheduleInvalid();
  const value = input as Record<string, unknown>;
  if (!SHIFT_WEEKDAYS.includes(value.weekday as Weekday)) return scheduleInvalid();
  for (const key of ['startsAt', 'endsAt']) {
    if (typeof value[key] !== 'string' || !TIME.test(value[key] as string)) return scheduleInvalid();
  }
  const startsAt = value.startsAt as string;
  const endsAt = value.endsAt as string;
  if (minutes(startsAt) >= minutes(endsAt)) return scheduleInvalid();
  let breakStart: string | null = null;
  let breakEnd: string | null = null;
  if (value.breakStart !== undefined && value.breakStart !== null || value.breakEnd !== undefined && value.breakEnd !== null) {
    if (typeof value.breakStart !== 'string' || typeof value.breakEnd !== 'string') return scheduleInvalid();
    if (!TIME.test(value.breakStart) || !TIME.test(value.breakEnd)) return scheduleInvalid();
    if (minutes(value.breakStart as string) >= minutes(value.breakEnd as string)) return scheduleInvalid();
    if (minutes(value.breakStart as string) < minutes(startsAt) || minutes(value.breakEnd as string) > minutes(endsAt)) return scheduleInvalid();
    breakStart = value.breakStart as string;
    breakEnd = value.breakEnd as string;
  }
  return { weekday: value.weekday as number, startsAt, endsAt, breakStart, breakEnd };
}

export function absence(input: unknown): { startsOn: string; endsOn: string; reason: string | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return scheduleInvalid();
  const value = input as Record<string, unknown>;
  if (typeof value.startsOn !== 'string' || !DATE.test(value.startsOn)) return scheduleInvalid();
  if (typeof value.endsOn !== 'string' || !DATE.test(value.endsOn)) return scheduleInvalid();
  for (const key of ['startsOn', 'endsOn'] as const) {
    if (Number.isNaN(new Date(value[key] + 'T00:00:00Z').getTime())) return scheduleInvalid();
  }
  if ((value.startsOn as string) > (value.endsOn as string)) return scheduleInvalid();
  if (value.reason !== undefined && value.reason !== null) {
    if (typeof value.reason !== 'string' || value.reason.trim().length > 200) return scheduleInvalid();
  }
  return { startsOn: value.startsOn as string, endsOn: value.endsOn as string, reason: typeof value.reason === 'string' && value.reason.trim() ? value.reason.trim() : null };
}

export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => aStart < bEnd && bStart < aEnd;
export const shiftMinutes = (value: Pick<ShiftInput, 'startsAt' | 'endsAt'>) => [minutes(value.startsAt), minutes(value.endsAt)] as const;
export const shiftOverlaps = (a: ShiftInput, b: ShiftInput): boolean => {
  const [aStart, aEnd] = shiftMinutes(a);
  const [bStart, bEnd] = shiftMinutes(b);
  return overlaps(aStart, aEnd, bStart, bEnd);
};
export const datesOverlap = (a: { startsOn: string; endsOn: string }, b: { startsOn: string; endsOn: string }): boolean =>
  a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

/** Weekday of a calendar date, ISO 1..7, computed in UTC to avoid host-timezone drift. */
export function weekdayOf(date: string): number {
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  return day === 0 ? 7 : day;
}
export function slots(shiftValue: ShiftView, date: string): Array<{ start: string; end: string }> {
  if (!shiftValue.active || shiftValue.weekday !== weekdayOf(date)) return [];
  const start = minutes(shiftValue.startsAt);
  const end = minutes(shiftValue.endsAt);
  const result: Array<{ start: string; end: string }> = [];
  const toTime = (value: number) => String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
  if (shiftValue.breakStart && shiftValue.breakEnd) {
    const breakStart = minutes(shiftValue.breakStart);
    const breakEnd = minutes(shiftValue.breakEnd);
    if (start < breakStart) result.push({ start: shiftValue.startsAt, end: shiftValue.breakStart });
    if (breakEnd < end) result.push({ start: shiftValue.breakEnd, end: shiftValue.endsAt });
    return result;
  }
  return [{ start: toTime(start), end: toTime(end) }];
}
