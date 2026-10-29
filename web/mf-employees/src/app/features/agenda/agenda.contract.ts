export type AgendaScope = 'self' | 'team';
export type Priority = 'baja' | 'normal' | 'alta' | 'urgente';
export interface AgendaEmployee {
  id: string;
  fullName: string;
  status: 'active' | 'inactive';
}
export interface AgendaWork {
  assignmentId: string;
  orderId: string;
  orderNumber: string;
  employee: AgendaEmployee;
  vehicle: { id: string; plate: string; make: string; model: string };
  startsAt: string;
  endsAt: string;
  priority: Priority;
  status: 'confirmed';
  description: string;
  notes: string | null;
  services: Array<{ serviceId: string; serviceName: string; quantity: number; estimatedMinutes: number }>;
  orderVersion: number;
  assignmentVersion: number;
  observedAt: string;
  confirmationObservation: 'observed' | 'pending';
}
export interface AgendaPage {
  actor: { employeeId: string; fullName: string; status: 'active'; scopes: AgendaScope[] };
  items: AgendaWork[];
  total: number;
  limit: number;
  offset: number;
  from: string;
  to: string;
  timeZone: string;
  observedAt: string;
}
export interface EmployeesPage {
  items: AgendaEmployee[];
  total: number;
  limit: number;
  offset: number;
  observedAt: string;
}
export interface AgendaFilters {
  from: string;
  to: string;
  status: 'confirmed';
  priority?: Priority;
  limit: number;
  offset: number;
}
export const WORK_FIELDS =
  'assignmentId orderId orderNumber employee { id fullName status } vehicle { id plate make model } startsAt endsAt priority status description notes services { serviceId serviceName quantity estimatedMinutes } orderVersion assignmentVersion observedAt confirmationObservation';
export function civilToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function validRange(from: string, to: string): boolean {
  const valid = (value: string): boolean =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return valid(from) && valid(to) && from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 < 31;
}
export function employeeLanding(effective: readonly string[]): string {
  return effective.includes('employees:read')
    ? 'list'
    : effective.includes('agenda:read:self')
      ? 'agenda'
      : effective.includes('agenda:read:team')
        ? 'agenda/team'
        : 'list';
}
export function agendaError(error: { code: string; statusCode: number }): string {
  if (error.statusCode === 401) return 'La sesión terminó. Ingresá nuevamente.';
  if (error.statusCode === 403) return 'No se puede consultar: se requiere permiso y un vínculo laboral activo vigente.';
  if (error.statusCode === 404) return 'El trabajo no está disponible en este alcance.';
  if (error.code === 'AGENDA_STATE_UNAVAILABLE') return 'Los datos cambiaron o no se pueden comprobar. Volvé a consultar.';
  if (error.statusCode === 400) return 'Revisá los filtros: fechas válidas y hasta 31 días inclusivos.';
  return 'No se pudo comprobar la agenda: una dependencia no está disponible. Reintentá.';
}
