import { inject, Injectable } from '@angular/core';

import { WORK_FIELDS, type AgendaScope, type AgendaFilters, type AgendaPage, type AgendaWork, type EmployeesPage } from './agenda.contract';
import { SESSION_PORT } from '../../auth/session';
import { EmployeesFailure } from '../employees/employees-api';
@Injectable({ providedIn: 'root' })
export class AgendaApi {
  private readonly session = inject(SESSION_PORT);
  async list(scope: AgendaScope, filters: AgendaFilters, employeeId?: string): Promise<AgendaPage> {
    const root = scope === 'team' ? 'teamAgenda' : 'myAgenda';
    return this.run<AgendaPage>(
      root,
      `query Agenda($from:Date,$to:Date,$status:AgendaStatus,$priority:AgendaPriority,$limit:Int,$offset:Int${scope === 'team' ? ',$employeeId:UUID' : ''}) { ${root}(from:$from,to:$to,status:$status,priority:$priority,limit:$limit,offset:$offset${scope === 'team' ? ',employeeId:$employeeId' : ''}) { actor { employeeId fullName status scopes } items { ${WORK_FIELDS} } total limit offset from to timeZone observedAt } }`,
      {
        from: filters.from,
        to: filters.to,
        status: filters.status,
        priority: filters.priority,
        limit: filters.limit,
        offset: filters.offset,
        ...(scope === 'team' && employeeId ? { employeeId } : {})
      }
    );
  }
  detail(scope: AgendaScope, assignmentId: string): Promise<AgendaWork> {
    const root = scope === 'team' ? 'teamAgendaWork' : 'myAgendaWork';
    return this.run(root, `query AgendaWork($assignmentId:UUID!) { ${root}(assignmentId:$assignmentId) { ${WORK_FIELDS} } }`, {
      assignmentId
    });
  }
  employees(search: string, status: string, offset: number): Promise<EmployeesPage> {
    return this.run(
      'agendaTeamEmployees',
      'query AgendaEmployees($search:String,$status:AgendaEmployeeStatus,$limit:Int,$offset:Int) { agendaTeamEmployees(search:$search,status:$status,limit:$limit,offset:$offset) { items { id fullName status } total limit offset observedAt } }',
      { search: search.trim() || undefined, status: status || undefined, limit: 20, offset }
    );
  }
  private async run<T>(root: string, query: string, variables: Readonly<Record<string, unknown>>): Promise<T> {
    const result = await this.session.requestBusiness(query, variables);
    if (result.errors?.length) throw new EmployeesFailure(result.errors[0]);
    const data = result.data as Record<string, T> | undefined;
    if (!data?.[root]) throw new EmployeesFailure({ code: 'AGENDA_DEPENDENCY_UNAVAILABLE', statusCode: 503, message: '' });
    return data[root];
  }
}
