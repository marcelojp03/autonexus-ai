import { BusinessError } from './business-error.js';

export type AgendaScope = 'self' | 'team';
export type AgendaEmployeeStatus = 'active' | 'inactive';
export type AgendaPriority = 'baja' | 'normal' | 'alta' | 'urgente';
export interface AgendaQuery {
  from?: string; to?: string; status?: 'confirmed' | 'completed'; priority?: AgendaPriority;
  employeeId?: string; limit?: number; offset?: number;
}
export interface AgendaEmployeesQuery {
  search?: string; status?: AgendaEmployeeStatus; limit?: number; offset?: number;
}
export interface AgendaEmployee { id: string; fullName: string; status: AgendaEmployeeStatus; }
export interface AgendaActor { employeeId: string; fullName: string; status: AgendaEmployeeStatus; scopes: AgendaScope[]; }
export interface AgendaWork {
  assignmentId: string; orderId: string; orderNumber: string; employee: AgendaEmployee;
  vehicle: { id: string; plate: string; make: string; model: string };
  startsAt: string; endsAt: string; priority: AgendaPriority; status: 'confirmed' | 'completed';
  description: string; notes: string | null;
  services: { serviceId: string; serviceName: string; quantity: number; estimatedMinutes: number }[];
  orderVersion: number; assignmentVersion: number; observedAt: string; confirmationObservation: 'observed' | 'pending';
  executionStatus: 'not_started' | 'in_progress' | 'pending_verification' | 'completed';
  executionProgress: { advances: number; lastAdvanceAt: string | null; availableEvidence: number };
}
export interface AgendaPage {
  actor: AgendaActor; items: AgendaWork[]; total: number; limit: number; offset: number;
  from: string; to: string; timeZone: string; observedAt: string;
}
export interface AgendaEmployeesPage { items: AgendaEmployee[]; total: number; limit: number; offset: number; observedAt: string; }
export interface AgendaGateway {
  list(scope: AgendaScope, query: AgendaQuery, token: string): Promise<AgendaPage>;
  history(scope: AgendaScope, query: AgendaQuery, token: string): Promise<AgendaPage>;
  work(scope: AgendaScope, assignmentId: string, token: string): Promise<AgendaWork>;
  employees(query: AgendaEmployeesQuery, token: string): Promise<AgendaEmployeesPage>;
}

const PRIORITIES = ['baja', 'normal', 'alta', 'urgente'] as const;
const EMPLOYEE_STATUSES = ['active', 'inactive'] as const;
const ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  AGENDA_ACCESS_DENIED: 403, AGENDA_WORK_NOT_FOUND: 404, VALIDATION_ERROR: 400,
  AGENDA_DEPENDENCY_UNAVAILABLE: 503, AGENDA_STATE_UNAVAILABLE: 503, PERSISTENCE_UNAVAILABLE: 503,
});
const invalid = (): never => { throw new BusinessError(400, 'VALIDATION_ERROR'); };
const unavailable = (): never => { throw new BusinessError(503, 'AGENDA_STATE_UNAVAILABLE'); };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}
function text(value: unknown): string { return typeof value === 'string' ? value : unavailable(); }
function integer(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647 ? value : unavailable();
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  return typeof value === 'string' && options.includes(value as T) ? value as T : unavailable();
}
function array<T>(value: unknown, project: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(project) : unavailable();
}
function employee(value: unknown): AgendaEmployee {
  const item = record(value);
  return { id: text(item.id), fullName: text(item.fullName), status: choice(item.status, EMPLOYEE_STATUSES) };
}
function work(value: unknown): AgendaWork {
  const item = record(value);
  const vehicle = record(item.vehicle);
  return {
    assignmentId: text(item.assignmentId), orderId: text(item.orderId), orderNumber: text(item.orderNumber),
    employee: employee(item.employee),
    vehicle: { id: text(vehicle.id), plate: text(vehicle.plate), make: text(vehicle.make), model: text(vehicle.model) },
    startsAt: text(item.startsAt), endsAt: text(item.endsAt), priority: choice(item.priority, PRIORITIES),
    status: choice(item.status, ['confirmed', 'completed']), description: text(item.description), notes: item.notes === null ? null : text(item.notes),
    services: array(item.services, value => {
      const service = record(value);
      return { serviceId: text(service.serviceId), serviceName: text(service.serviceName),
        quantity: integer(service.quantity), estimatedMinutes: integer(service.estimatedMinutes) };
    }),
    orderVersion: integer(item.orderVersion), assignmentVersion: integer(item.assignmentVersion), observedAt: text(item.observedAt),
    confirmationObservation: choice(item.confirmationObservation, ['observed', 'pending']),
    executionStatus: choice(item.executionStatus, ['not_started', 'in_progress', 'pending_verification', 'completed']),
    executionProgress: (() => {
      const progress = record(item.executionProgress);
      return { advances: integer(progress.advances), lastAdvanceAt: progress.lastAdvanceAt === null ? null : text(progress.lastAdvanceAt),
        availableEvidence: integer(progress.availableEvidence) };
    })(),
  };
}
function page(value: unknown) {
  const item = record(value);
  return { total: integer(item.total), limit: integer(item.limit), offset: integer(item.offset), observedAt: text(item.observedAt) };
}
function date(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
  const timestamp = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return invalid();
  return timestamp;
}
function suffix(query: object, keys: readonly string[]): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!keys.includes(key)) return invalid();
    if (value === undefined || value === null) continue;
    if (key === 'limit' || key === 'offset') {
      const min = key === 'limit' ? 1 : 0;
      const max = key === 'limit' ? 100 : 2147483647;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return invalid();
    } else if (typeof value !== 'string') return invalid();
    parameters.set(key, String(value));
  }
  const serialized = parameters.toString();
  return serialized ? '?' + serialized : '';
}

export class HttpAgendaGateway implements AgendaGateway {
  constructor(private readonly operationsUrl: string, private readonly employeesUrl: string, private readonly transport: typeof fetch = fetch) {}

  async list(scope: AgendaScope, query: AgendaQuery, token: string): Promise<AgendaPage> {
    return this.pageAt(scope, query, token, '');
  }

  /** Completed work: same record-scope checks, different collection. */
  async history(scope: AgendaScope, query: AgendaQuery, token: string): Promise<AgendaPage> {
    return this.pageAt(scope, query, token, 'history/');
  }

  private async pageAt(scope: AgendaScope, query: AgendaQuery, token: string, prefix: string): Promise<AgendaPage> {
    const keys = ['from', 'to', 'status', 'priority', 'limit', 'offset', ...(scope === 'team' ? ['employeeId'] : [])];
    const search = suffix(query, keys);
    const from = query.from == null ? undefined : date(query.from);
    const to = query.to == null ? undefined : date(query.to);
    if (from !== undefined && to !== undefined && (from > to || to - from > 30 * 86400000)) return invalid();
    const allowed = prefix === 'history/' ? ['completed'] : ['confirmed'];
    if (query.status != null && !allowed.includes(query.status)) return invalid();
    if (query.priority != null && !PRIORITIES.includes(query.priority)) return invalid();
    const item = record(await this.request(this.operationsUrl, '/agenda/' + prefix + (scope === 'self' ? 'me' : 'team') + search, token));
    const actor = record(item.actor);
    return { ...page(item),
      actor: { employeeId: text(actor.employeeId), fullName: text(actor.fullName), status: choice(actor.status, ['active']),
        scopes: array(actor.scopes, value => choice(value, ['self', 'team'])) },
      items: array(item.items, work), from: text(item.from), to: text(item.to), timeZone: choice(item.timeZone, ['America/La_Paz']),
    };
  }

  async work(scope: AgendaScope, assignmentId: string, token: string): Promise<AgendaWork> {
    return work(await this.request(this.operationsUrl, '/agenda/' + (scope === 'self' ? 'me' : 'team') + '/' + encodeURIComponent(assignmentId), token));
  }

  async employees(query: AgendaEmployeesQuery, token: string): Promise<AgendaEmployeesPage> {
    const search = suffix(query, ['search', 'status', 'limit', 'offset']);
    if (query.status != null && !EMPLOYEE_STATUSES.includes(query.status)) return invalid();
    const item = record(await this.request(this.employeesUrl, '/agenda/team/employees' + search, token));
    return { ...page(item), items: array(item.items, employee) };
  }

  private async request(base: string, path: string, token: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(base + path, { method: 'GET', headers: { Authorization: `Bearer ${token}` },
        redirect: 'error', signal: AbortSignal.timeout(10000) });
    } catch { throw new BusinessError(503, 'AGENDA_DEPENDENCY_UNAVAILABLE'); }
    if (response.status === 401) throw new BusinessError(401, 'UNAUTHENTICATED');
    if (response.status === 403) throw new BusinessError(403, 'AGENDA_ACCESS_DENIED');
    if (response.status === 404) throw new BusinessError(404, 'AGENDA_WORK_NOT_FOUND');
    let body: unknown;
    try { body = await response.json(); } catch { throw new BusinessError(503, 'AGENDA_DEPENDENCY_UNAVAILABLE'); }
    if (response.status === 200) return body;
    const code = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    if (code && ERROR_STATUS[code] === response.status) throw new BusinessError(response.status, code);
    throw new BusinessError(response.status === 400 ? 400 : 503, response.status === 400 ? 'VALIDATION_ERROR' : 'AGENDA_DEPENDENCY_UNAVAILABLE');
  }
}
