import { inject, Injectable } from '@angular/core';
import { SESSION_PORT } from '../../auth/session';
import { EmployeesFailure } from '../employees/employees-api';
import {
  ASSISTANT_ANSWER_FIELDS,
  OPERATIONS_REPORT_FIELDS,
  type AssistantAnswer,
  type OperationsReport,
} from './assistant.contract';

/**
 * CU25/CU26 transport. Both roots travel through the BFF with the Shell session; the component never
 * sees a token. The assistant may take up to two minutes, so callers must render a waiting state.
 */
@Injectable({ providedIn: 'root' })
export class AssistantApi {
  private readonly session = inject(SESSION_PORT);

  private async run<T>(root: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const result = await this.session.requestBusiness(query, variables);
    if (result.errors?.length) throw new EmployeesFailure(result.errors[0]);
    const data = result.data as Record<string, T> | undefined;
    if (!data?.[root]) throw new EmployeesFailure({ code: 'SERVICE_UNAVAILABLE', statusCode: 503, message: '' });
    return data[root];
  }

  ask(question: string): Promise<AssistantAnswer> {
    return this.run<AssistantAnswer>(
      'assistantAnswer',
      'query($query:String!){assistantAnswer(query:$query){' + ASSISTANT_ANSWER_FIELDS + '}}',
      { query: question },
    );
  }

  report(from: string, to: string): Promise<OperationsReport> {
    return this.run<OperationsReport>(
      'operationsReport',
      'query($from:Date!,$to:Date!){operationsReport(from:$from,to:$to){' + OPERATIONS_REPORT_FIELDS + '}}',
      { from, to },
    );
  }

  /** Presentation only: the BFF and the assistant service re-authorize the report on their own. */
  async permissions(): Promise<readonly string[]> {
    const data = await this.run<{ effective?: readonly string[] }>(
      'securityCatalog',
      'query{securityCatalog{effective}}',
      {},
    );
    return Array.isArray(data.effective) ? data.effective : [];
  }
}
