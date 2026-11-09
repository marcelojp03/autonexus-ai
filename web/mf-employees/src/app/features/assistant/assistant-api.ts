import { inject, Injectable } from '@angular/core';
import { SESSION_PORT } from '../../auth/session';
import { EmployeesFailure } from '../employees/employees-api';
import {
  ASSISTANT_ANSWER_FIELDS,
  OPERATIONS_REPORT_FIELDS,
  REPORT_JOB_FIELDS,
  type AssistantAnswer,
  type OperationsReport,
  type ReportJob,
} from './assistant.contract';
import { FINANCIAL_JOB_FIELDS, type FinancialJob } from './financial.contract';

/**
 * CU25/CU26 transport. Both roots travel through the BFF with the Shell session; the component never
 * sees a token. The assistant may take up to two minutes, so its callers render a waiting state; the
 * report is created as a job and polled, so no request waits for the generation.
 */
@Injectable({ providedIn: 'root' })
export class AssistantApi {
  private readonly session = inject(SESSION_PORT);

  private async run<T>(root: string, query: string, variables: Record<string, unknown>,
    options?: { readonly timeoutMs?: number }): Promise<T> {
    const result = await this.session.requestBusiness(query, variables, options);
    if (result.errors?.length) throw new EmployeesFailure(result.errors[0]);
    const data = result.data as Record<string, T> | undefined;
    if (!data?.[root]) throw new EmployeesFailure({ code: 'SERVICE_UNAVAILABLE', statusCode: 503, message: '' });
    return data[root];
  }

  /**
   * One assistant turn is the slowest read in the platform: it waits above the BFF's own 120 s budget
   * so a slow model arrives as the BFF's clean SERVICE_UNAVAILABLE and not as a local abort.
   */
  ask(question: string): Promise<AssistantAnswer> {
    return this.run<AssistantAnswer>(
      'assistantAnswer',
      'query($query:String!){assistantAnswer(query:$query){' + ASSISTANT_ANSWER_FIELDS + '}}',
      { query: question },
      { timeoutMs: 130_000 },
    );
  }

  /** Synchronous report: kept for scripts and contract checks, not used by the interface. */
  report(from: string, to: string): Promise<OperationsReport> {
    return this.run<OperationsReport>(
      'operationsReport',
      'query($from:Date!,$to:Date!){operationsReport(from:$from,to:$to){' + OPERATIONS_REPORT_FIELDS + '}}',
      { from, to },
    );
  }

  /** Creates the job. Repeating it with the same `operationId` returns the same job, never a new run. */
  startReport(from: string, to: string, operationId: string): Promise<ReportJob> {
    return this.run<ReportJob>(
      'startOperationsReport',
      'mutation($from:Date!,$to:Date!,$operationId:UUID!){startOperationsReport(from:$from,to:$to,operationId:$operationId){' +
        REPORT_JOB_FIELDS + '}}',
      { from, to, operationId },
    );
  }

  /** Reads the state of a job: `SUCCEEDED` carries the document, the other terminals carry a code. */
  reportJob(jobId: string): Promise<ReportJob> {
    return this.run<ReportJob>(
      'operationsReportJob',
      'query($jobId:ID!){operationsReportJob(jobId:$jobId){' + REPORT_JOB_FIELDS + '}}',
      { jobId },
    );
  }

  /**
   * CU26 financial report: own GraphQL fields, own job. The service keeps financial authority with the
   * employee grants, so this transport only forwards the session and the period.
   */
  startFinancialReport(from: string, to: string, operationId: string): Promise<FinancialJob> {
    return this.run<FinancialJob>(
      'startFinancialReport',
      'mutation($from:Date!,$to:Date!,$operationId:UUID!){startFinancialReport(from:$from,to:$to,operationId:$operationId){' +
        FINANCIAL_JOB_FIELDS + '}}',
      { from, to, operationId },
    );
  }

  financialReportJob(jobId: string): Promise<FinancialJob> {
    return this.run<FinancialJob>(
      'financialReportJob',
      'query($jobId:ID!){financialReportJob(jobId:$jobId){' + FINANCIAL_JOB_FIELDS + '}}',
      { jobId },
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
