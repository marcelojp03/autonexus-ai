import type {
  AgendaActor,
  AgendaEmployee,
  AgendaScope,
  AssignmentCheck,
} from '../domain/agenda.js';
import type { PageQuery } from '../domain/employee.js';

export interface AgendaRepository {
  actor(subject: string, roles: readonly string[]): Promise<AgendaActor | null>;
  employees(
    query: PageQuery,
  ): Promise<{
    items: AgendaEmployee[];
    total: number;
    limit: number;
    offset: number;
  }>;
  assignments(
    ids: readonly string[],
    employeeId: string | null,
  ): Promise<AssignmentCheck[]>;
}
export interface AgendaIdentity {
  subject: string;
  roles: readonly string[];
}
export interface AgendaContextAuthorization {
  context(
    identity: AgendaIdentity,
    scope: AgendaScope,
  ): Promise<{ actor: AgendaActor; observedAt: string }>;
}
