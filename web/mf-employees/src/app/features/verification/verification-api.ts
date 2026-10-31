import { inject, Injectable } from '@angular/core';
import { SESSION_PORT } from '../../auth/session';
import { EmployeesFailure } from '../employees/employees-api';
import {
  PENDING_FIELDS,
  VERIFICATION_FIELDS,
  type PendingWork,
  type Verification,
} from './verification.contract';

/** CU17 transport: team agenda for the queue, GraphQL verification for the decision. */
@Injectable({ providedIn: 'root' })
export class VerificationApi {
  private readonly session = inject(SESSION_PORT);

  private async run<T>(root: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const result = await this.session.requestBusiness(query, variables);
    if (result.errors?.length) throw new EmployeesFailure(result.errors[0]);
    const data = result.data as Record<string, T> | undefined;
    if (!data?.[root]) throw new EmployeesFailure({ code: 'SERVICE_UNAVAILABLE', statusCode: 503, message: '' });
    return data[root];
  }

  pending(from: string, to: string): Promise<{ items: PendingWork[] }> {
    return this.run<{ items: PendingWork[] }>(
      'teamAgenda',
      'query($from:Date,$to:Date){teamAgenda(from:$from,to:$to,limit:100){items{' + PENDING_FIELDS + '}}}',
      { from, to },
    );
  }

  history(from: string, to: string): Promise<{ items: PendingWork[] }> {
    return this.run<{ items: PendingWork[] }>(
      'teamAgendaHistory',
      'query($from:Date,$to:Date){teamAgendaHistory(from:$from,to:$to,status:completed,limit:100){items{' + PENDING_FIELDS + '}}}',
      { from, to },
    );
  }

  detail(assignmentId: string): Promise<Verification> {
    return this.run<Verification>(
      'teamVerification',
      'query($id:UUID!){teamVerification(assignmentId:$id){' + VERIFICATION_FIELDS + '}}',
      { id: assignmentId },
    );
  }

  approve(assignmentId: string, operationId: string, expectedVersion: number): Promise<Verification> {
    return this.run<Verification>(
      'approveExecution',
      'mutation($id:UUID!,$input:ReviewInput!){approveExecution(assignmentId:$id,input:$input){' + VERIFICATION_FIELDS + '}}',
      { id: assignmentId, input: { operationId, expectedVersion } },
    );
  }

  returnToWork(assignmentId: string, operationId: string, expectedVersion: number, reason: string): Promise<Verification> {
    return this.run<Verification>(
      'returnExecution',
      'mutation($id:UUID!,$input:ReturnInput!){returnExecution(assignmentId:$id,input:$input){' + VERIFICATION_FIELDS + '}}',
      { id: assignmentId, input: { operationId, expectedVersion, reason } },
    );
  }
}
