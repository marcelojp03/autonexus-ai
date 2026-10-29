import {
  agendaScope,
  assignmentCheckInput,
  type AgendaScope,
} from '../domain/agenda.js';
import { EmployeeError, object, only, query } from '../domain/employee.js';
import type {
  AgendaContextAuthorization,
  AgendaIdentity,
  AgendaRepository,
} from './agenda-repository.js';

export class ReadAgenda implements AgendaContextAuthorization {
  constructor(private readonly repository: AgendaRepository) {}

  async context(identity: AgendaIdentity, scope: AgendaScope) {
    const actor = await this.repository.actor(identity.subject, identity.roles);
    if (!actor || !actor.scopes.includes(scope))
      throw new EmployeeError(403, 'AGENDA_ACCESS_DENIED');
    return { actor, observedAt: new Date().toISOString() };
  }

  contextQuery(identity: AgendaIdentity, input: unknown) {
    const value = object(input);
    only(value, ['scope']);
    return this.context(identity, agendaScope(value.scope));
  }

  async teamEmployees(identity: AgendaIdentity, input: unknown) {
    const page = query(input);
    await this.context(identity, 'team');
    return {
      ...(await this.repository.employees(page)),
      observedAt: new Date().toISOString(),
    };
  }

  async check(identity: AgendaIdentity, input: unknown) {
    const { scope, assignmentIds } = assignmentCheckInput(input);
    const { actor } = await this.context(identity, scope);
    const items = await this.repository.assignments(
      assignmentIds,
      scope === 'self' ? actor.employeeId : null,
    );
    if (items.length !== assignmentIds.length)
      throw new EmployeeError(404, 'AGENDA_WORK_NOT_FOUND');
    return { actor, items, observedAt: new Date().toISOString() };
  }
}
