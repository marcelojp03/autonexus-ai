import { createHash } from 'node:crypto';
import {
  EmployeeError,
  invalid,
  object,
  only,
  uuid,
  type Employee,
} from './employee.js';

export const CU15_CLIENT = 'autonexus-cu15-coordinator';
export type AssignmentCommand =
  'reserve_assignment' | 'confirm_assignment' | 'release_assignment';
export interface CommandBody {
  operationId: string;
  expectedVersion: number;
  initiatedBy: string;
  authorizedAt: string;
  orderId?: string;
  employeeId?: string;
  employeeVersion?: number;
  requiredSpecialty?: string;
  startsAt?: string;
  endsAt?: string;
  reasonCode?: string;
}
export interface Assignment {
  id: string;
  sagaId: string;
  orderId: string;
  employeeId: string;
  requiredSpecialty: string;
  startsAt: string;
  endsAt: string;
  status: 'reserved' | 'confirmed' | 'released';
  version: number;
  orderConfirmedObserved: boolean;
}
export interface Tombstone {
  sagaId: string;
  status: 'released';
  version: number;
  tombstone: true;
}
export type AssignmentResource = Assignment | Tombstone;
export interface CommandResult {
  operationId: string;
  sagaId: string;
  command: AssignmentCommand;
  fingerprint: string;
  outcome: 'applied' | 'rejected';
  resource: AssignmentResource | null;
  errorCode: string | null;
  committedAt: string;
  replayed: boolean;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const digest = (value: unknown): string =>
  createHash('sha256').update(canonical(value), 'utf8').digest('hex');
export function instant(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return invalid();
  const day = new Date(value.slice(0, 10) + 'T00:00:00.000Z');
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10) ||
    Number(value.slice(11, 13)) > 23
  )
    return invalid();
  return date.toISOString();
}
export function assignmentBody(
  command: AssignmentCommand,
  value: unknown,
): CommandBody {
  const v = object(value);
  only(v, [
    'operationId',
    'expectedVersion',
    'initiatedBy',
    'authorizedAt',
    ...(command === 'reserve_assignment'
      ? [
          'orderId',
          'employeeId',
          'employeeVersion',
          'requiredSpecialty',
          'startsAt',
          'endsAt',
        ]
      : command === 'release_assignment'
        ? ['reasonCode']
        : []),
  ]);
  if (
    !Number.isSafeInteger(v.expectedVersion) ||
    Number(v.expectedVersion) < 0 ||
    (command === 'reserve_assignment' && v.expectedVersion !== 0) ||
    (command === 'confirm_assignment' && Number(v.expectedVersion) < 1)
  )
    invalid();
  if (
    typeof v.initiatedBy !== 'string' ||
    !v.initiatedBy.trim() ||
    v.initiatedBy.length > 200 ||
    /[\x00-\x1f\x7f]/.test(v.initiatedBy)
  )
    invalid();
  const body: CommandBody = {
    operationId: uuid(v.operationId),
    expectedVersion: v.expectedVersion as number,
    initiatedBy: v.initiatedBy as string,
    authorizedAt: instant(v.authorizedAt),
  };
  if (command === 'reserve_assignment') {
    if (
      !Number.isSafeInteger(v.employeeVersion) ||
      Number(v.employeeVersion) < 1 ||
      typeof v.requiredSpecialty !== 'string' ||
      !v.requiredSpecialty.trim() ||
      v.requiredSpecialty.length > 80 ||
      /[\x00-\x1f\x7f]/.test(v.requiredSpecialty)
    )
      invalid();
    Object.assign(body, {
      orderId: uuid(v.orderId),
      employeeId: uuid(v.employeeId),
      employeeVersion: v.employeeVersion,
      requiredSpecialty: (v.requiredSpecialty as string)
        .trim()
        .split(/\s+/u)
        .join(' '),
      startsAt: instant(v.startsAt),
      endsAt: instant(v.endsAt),
    });
    if (body.startsAt! >= body.endsAt!) invalid();
  }
  if (command === 'release_assignment') {
    if (
      typeof v.reasonCode !== 'string' ||
      !/^[A-Z][A-Z0-9_]{1,79}$/.test(v.reasonCode)
    )
      invalid();
    body.reasonCode = v.reasonCode as string;
  }
  return body;
}
export function eligibility(employee: Employee): string[] {
  return [
    ...(employee.status !== 'active' ? ['EMPLOYEE_INACTIVE'] : []),
    ...(!employee.mechanicEnabled ? ['MECHANIC_NOT_ENABLED'] : []),
    ...(!employee.specialties.length ? ['SPECIALTY_REQUIRED'] : []),
  ];
}
export function requireMechanic(
  employee: Employee | null,
  specialty: string,
  version?: number,
): void {
  if (!employee) throw new EmployeeError(409, 'EMPLOYEE_NOT_FOUND');
  if (version !== undefined && employee.version !== version)
    throw new EmployeeError(409, 'EMPLOYEE_VERSION_CONFLICT');
  const reasons = eligibility(employee);
  if (reasons[0]) throw new EmployeeError(409, reasons[0]);
  if (!employee.specialties.includes(specialty))
    throw new EmployeeError(409, 'SPECIALTY_MISMATCH');
}
