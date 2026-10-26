export class EmployeeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export const invalid = (): never => {
  throw new EmployeeError(400, 'VALIDATION_ERROR');
};
export interface EmployeeFields {
  firstName: string;
  lastName: string;
  document: string;
  email: string;
  phone: string;
  jobTitle: string;
  startDate: string;
  specialties: string[];
}
export type AccessStatus =
  'not_requested' | 'pending' | 'synced' | 'failed' | 'conflict';
export interface Employee extends EmployeeFields {
  id: string;
  status: 'active' | 'inactive';
  version: number;
  createdAt: string;
  updatedAt: string;
  access: {
    requested: boolean;
    status: AccessStatus;
    subject: string | null;
    attempts: number;
    errorCode: string | null;
  };
}
export type Action = 'create' | 'update' | 'deactivate' | 'retry';
export interface Command {
  action: Action;
  id: string | null;
  operationId: string;
  expectedVersion?: number;
  fields?: EmployeeFields;
  requested?: boolean;
}
export interface Transition {
  employee: Employee;
  action: 'created' | 'updated' | 'deactivated' | null;
  synchronize: boolean;
}
export interface PageQuery {
  limit: number;
  offset: number;
  status?: 'active' | 'inactive';
  search?: string;
}
export interface History {
  id: string;
  employeeId: string;
  operationId: string;
  action: 'created' | 'updated' | 'deactivated';
  actorSubject: string;
  occurredAt: string;
  version: number;
  snapshot: Employee;
}
const fieldNames = [
  'firstName',
  'lastName',
  'document',
  'email',
  'phone',
  'jobTitle',
  'startDate',
  'specialties',
];
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
export function only(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (Object.keys(value).some((k) => !keys.includes(k))) invalid();
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return invalid();
  const normalized = value.trim().split(/\s+/u).join(' ');
  if (!normalized || normalized.length > max) return invalid();
  for (const character of normalized) {
    const point = character.codePointAt(0)!;
    if (point < 32 || point === 127 || (point >= 0xd800 && point <= 0xdfff))
      return invalid();
  }
  return normalized;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    return invalid();
  return value.toLowerCase();
}
export function fields(value: unknown): EmployeeFields {
  const v = object(value);
  only(v, fieldNames);
  const email = text(v.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) invalid();
  const phone = text(v.phone, 25);
  if (phone.length < 7 || !/^[0-9+(). -]+$/.test(phone) || !/[0-9]/.test(phone))
    invalid();
  if (
    typeof v.startDate !== 'string' ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v.startDate)
  )
    invalid();
  const date = new Date(v.startDate as string);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== v.startDate ||
    (v.startDate as string) > new Date().toISOString().slice(0, 10)
  )
    invalid();
  if (!Array.isArray(v.specialties) || v.specialties.length > 20) invalid();
  const specialties = (v.specialties as unknown[]).map((item) =>
    text(item, 80),
  );
  if (new Set(specialties).size !== specialties.length) invalid();
  return {
    firstName: text(v.firstName, 100),
    lastName: text(v.lastName, 100),
    document: text(v.document, 40),
    email,
    phone,
    jobTitle: text(v.jobTitle, 100),
    startDate: v.startDate as string,
    specialties,
  };
}
export function command(action: Action, id: unknown, value: unknown): Command {
  const v = object(value);
  const editing = action === 'create' || action === 'update';
  only(v, [
    'operationId',
    ...(action === 'create' ? [] : ['expectedVersion']),
    ...(editing ? [...fieldNames, 'access'] : []),
  ]);
  const result: Command = {
    action,
    id: action === 'create' ? null : uuid(id),
    operationId: uuid(v.operationId),
  };
  if (action !== 'create') {
    if (
      !Number.isSafeInteger(v.expectedVersion) ||
      Number(v.expectedVersion) < 1
    )
      invalid();
    result.expectedVersion = v.expectedVersion as number;
  }
  if (editing) {
    result.fields = fields(
      Object.fromEntries(fieldNames.map((k) => [k, v[k]])),
    );
    if ('access' in v) {
      const access = object(v.access);
      only(access, ['requested']);
      if (typeof access.requested !== 'boolean') invalid();
      result.requested = access.requested as boolean;
    }
  }
  return result;
}
export function query(value: unknown, history = false): PageQuery {
  const v = object(value);
  only(
    v,
    history ? ['limit', 'offset'] : ['limit', 'offset', 'status', 'search'],
  );
  const integer = (
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    if (!(key in v)) return fallback;
    if (typeof v[key] !== 'string' || !/^[0-9]+$/.test(v[key] as string))
      return invalid();
    const number = Number(v[key]);
    if (!Number.isSafeInteger(number) || number < min || number > max)
      return invalid();
    return number;
  };
  const result: PageQuery = {
    limit: integer('limit', 20, 1, 100),
    offset: integer('offset', 0, 0, 2147483647),
  };
  if ('status' in v) {
    if (v.status !== 'active' && v.status !== 'inactive') invalid();
    result.status = v.status as 'active' | 'inactive';
  }
  if ('search' in v) {
    if (typeof v.search !== 'string' || v.search.length > 100) invalid();
    const search = (v.search as string).trim().split(/\s+/u).join(' ');
    if (search) result.search = text(search, 100);
  }
  return result;
}
export function transition(
  c: Command,
  current: Employee | null,
  actor: string,
  newId: string,
  now: string,
): Transition {
  if (c.action === 'create') {
    const requested = c.requested === true;
    return {
      employee: {
        ...c.fields!,
        id: newId,
        status: 'active',
        version: 1,
        createdAt: now,
        updatedAt: now,
        access: {
          requested,
          status: requested ? 'pending' : 'not_requested',
          subject: null,
          attempts: 0,
          errorCode: null,
        },
      },
      action: 'created',
      synchronize: requested,
    };
  }
  if (!current) throw new EmployeeError(404, 'EMPLOYEE_NOT_FOUND');
  if (current.version !== c.expectedVersion)
    throw new EmployeeError(409, 'VERSION_CONFLICT');
  const employee = structuredClone(current);
  if (c.action === 'retry') {
    if (!employee.access.requested)
      throw new EmployeeError(409, 'ACCESS_NOT_REQUESTED');
    const synchronize = employee.access.status !== 'synced';
    if (synchronize) {
      employee.access.status = 'pending';
      employee.access.errorCode = null;
    }
    return { employee, action: null, synchronize };
  }
  if (c.action === 'deactivate') {
    if (employee.access.subject === actor)
      throw new EmployeeError(409, 'SELF_DEACTIVATION_FORBIDDEN');
    if (employee.status === 'inactive')
      return { employee, action: null, synchronize: false };
    employee.status = 'inactive';
  } else {
    if (c.requested === false && employee.access.requested)
      throw new EmployeeError(409, 'ACCESS_REQUEST_CANNOT_BE_REVOKED');
    Object.assign(employee, c.fields);
    if (c.requested === true) employee.access.requested = true;
  }
  employee.version++;
  employee.updatedAt = now;
  const synchronize =
    employee.access.requested &&
    (current.access.status !== 'synced' ||
      c.action === 'deactivate' ||
      current.firstName !== employee.firstName ||
      current.lastName !== employee.lastName ||
      current.email !== employee.email ||
      !current.access.requested);
  if (synchronize) {
    employee.access.status = 'pending';
    employee.access.errorCode = null;
  }
  return {
    employee,
    action: c.action === 'deactivate' ? 'deactivated' : 'updated',
    synchronize,
  };
}
