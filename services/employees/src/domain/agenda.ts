import { invalid, object, only, uuid } from './employee.js';

export type AgendaScope = 'self' | 'team';
export interface AgendaActor {
  employeeId: string;
  fullName: string;
  status: 'active';
  scopes: AgendaScope[];
}
export interface AgendaEmployee {
  id: string;
  fullName: string;
  status: 'active' | 'inactive';
}
export interface AssignmentCheck {
  assignmentId: string;
  sagaId: string;
  orderId: string;
  employeeId: string;
  fullName: string;
  employeeStatus: 'active' | 'inactive';
  startsAt: string;
  endsAt: string;
  status: 'reserved' | 'confirmed' | 'released';
  version: number;
  orderConfirmedObserved: boolean;
}
export function agendaScope(value: unknown): AgendaScope {
  if (value !== 'self' && value !== 'team') return invalid();
  return value;
}
export function assignmentCheckInput(input: unknown) {
  const value = object(input);
  only(value, ['scope', 'assignmentIds']);
  const scope = agendaScope(value.scope);
  if (!Array.isArray(value.assignmentIds) || value.assignmentIds.length > 100)
    return invalid();
  const assignmentIds = value.assignmentIds.map(uuid);
  if (new Set(assignmentIds).size !== assignmentIds.length) return invalid();
  return { scope, assignmentIds };
}
