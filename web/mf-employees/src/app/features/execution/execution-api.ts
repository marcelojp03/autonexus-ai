import { inject, Injectable } from '@angular/core';
import { SESSION_PORT } from '../../auth/session';
import type { EvidenceUploadTarget } from '../../../../../../contracts/auth/session';
import { EmployeesFailure } from '../employees/employees-api';
import type { AgendaWorkRef, Execution, ExecutionAdvance, ExecutionEvidence } from './execution.contract';
import { AGENDA_FIELDS, EXECUTION_FIELDS } from './execution.contract';

interface Upload {
  readonly url: string;
  readonly method: string;
  readonly headersJson: string;
  readonly expiresAt: string;
}

export interface EvidenceRequest {
  readonly evidence: ExecutionEvidence;
  readonly upload: Upload;
}

/** CU16 transport: GraphQL through the BFF plus the bounded binary transfer of the evidence bytes. */
@Injectable({ providedIn: 'root' })
export class ExecutionApi {
  private readonly session = inject(SESSION_PORT);

  private async run<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const result = await this.session.requestBusiness(query, variables);
    if (result.errors?.length) throw new EmployeesFailure(result.errors[0]);
    const data = result.data as Record<string, T> | undefined;
    const root = data ? Object.values(data)[0] : undefined;
    if (root === undefined) throw new EmployeesFailure({ code: 'EXECUTION_STATE_UNAVAILABLE', statusCode: 503, message: '' });
    return root;
  }

  myWorks(from: string, to: string): Promise<{ actor: { employeeId: string }; items: AgendaWorkRef[] }> {
    return this.run<{ actor: { employeeId: string }; items: AgendaWorkRef[] }>(
      'query($from:Date,$to:Date){myAgenda(from:$from,to:$to,limit:50){actor{employeeId} items{' + AGENDA_FIELDS + '}}}',
      { from, to },
    );
  }

  teamWorks(from: string, to: string): Promise<{ actor: { employeeId: string }; items: AgendaWorkRef[] }> {
    return this.run<{ actor: { employeeId: string }; items: AgendaWorkRef[] }>(
      "query($from:Date,$to:Date){teamAgenda(from:$from,to:$to,limit:100){actor{employeeId} items{" + AGENDA_FIELDS + "}}}",
      { from, to },
    );
  }

  work(kind: 'me' | 'team', assignmentId: string): Promise<AgendaWorkRef> {
    const field = kind === 'team' ? 'teamAgendaWork' : 'myAgendaWork';
    return this.run<AgendaWorkRef>(
      'query($id:UUID!){' + field + '(assignmentId:$id){' + AGENDA_FIELDS + '}}',
      { id: assignmentId },
    );
  }

  permissions(): Promise<{ effective: string[] }> {
    return this.run<{ effective: string[] }>(
      "query{securityCatalog{effective}}", {},
    );
  }

  execution(kind: "me" | "team", assignmentId: string): Promise<Execution> {
    const field = kind === "team" ? "teamExecution" : "myExecution";
    return this.run<Execution>(
      'query($id:UUID!){' + field + '(assignmentId:$id){' + EXECUTION_FIELDS + '}}',
      { id: assignmentId },
    );
  }

  start(assignmentId: string, operationId: string): Promise<{ execution: Execution }> {
    return this.run<{ execution: Execution }>(
      'mutation($id:UUID!,$input:StartExecutionInput!){startExecution(assignmentId:$id,input:$input){execution{'
        + EXECUTION_FIELDS + '} replayed}}',
      { id: assignmentId, input: { operationId } },
    );
  }

  advance(assignmentId: string, operationId: string, expectedVersion: number, description: string, minutesWorked: number): Promise<{ execution: Execution; advance: ExecutionAdvance }> {
    return this.run<{ execution: Execution; advance: ExecutionAdvance }>(
      'mutation($id:UUID!,$input:RecordAdvanceInput!){recordAdvance(assignmentId:$id,input:$input){execution{'
        + EXECUTION_FIELDS + '} advance{id sequence} replayed}}',
      { id: assignmentId, input: { operationId, expectedVersion, description, minutesWorked } },
    );
  }

  requestEvidence(assignmentId: string, advanceId: string, operationId: string, input: { fileName: string; contentType: string; sizeBytes: number; checksumSha256: string }): Promise<EvidenceRequest> {
    return this.run<EvidenceRequest>(
      'mutation($id:UUID!,$advance:UUID!,$input:RequestEvidenceInput!){requestEvidence(assignmentId:$id,advanceId:$advance,input:$input){'
        + 'evidence{id advanceId fileName contentType sizeBytes state attempt failureCode createdAt confirmedAt version} upload{url method headersJson expiresAt} replayed}}',
      { id: assignmentId, advance: advanceId, input: { operationId, ...input } },
    );
  }

  confirmEvidence(assignmentId: string, evidenceId: string, operationId: string, expectedVersion: number): Promise<{ evidence: ExecutionEvidence }> {
    return this.run<{ evidence: ExecutionEvidence }>(
      'mutation($id:UUID!,$evidence:UUID!,$input:ConfirmEvidenceInput!){confirmEvidence(assignmentId:$id,evidenceId:$evidence,input:$input){'
        + 'evidence{id advanceId fileName contentType sizeBytes state attempt failureCode createdAt confirmedAt version} replayed}}',
      { id: assignmentId, evidence: evidenceId, input: { operationId, expectedVersion } },
    );
  }

  retryEvidence(assignmentId: string, evidenceId: string, operationId: string, expectedVersion: number, fileName: string, contentType: string, sizeBytes: number, checksumSha256: string): Promise<EvidenceRequest> {
    return this.run<EvidenceRequest>(
      'mutation($id:UUID!,$evidence:UUID!,$input:RetryEvidenceInput!){retryEvidence(assignmentId:$id,evidenceId:$evidence,input:$input){evidence{id advanceId fileName contentType sizeBytes state attempt failureCode createdAt confirmedAt version} upload{url method headersJson expiresAt} replayed}}',
      { id: assignmentId, evidence: evidenceId, input: { operationId, expectedVersion, fileName, contentType, sizeBytes, checksumSha256 } },
    );
  }

  evidenceDownload(kind: "me" | "team", assignmentId: string, evidenceId: string): Promise<{ url: string; expiresAt: string }> {
    const field = kind === "team" ? "teamEvidenceDownload" : "myEvidenceDownload";
    return this.run<{ url: string; expiresAt: string }>(
      'query($id:UUID!,$evidence:UUID!){' + field + '(assignmentId:$id,evidenceId:$evidence){url expiresAt}}',
      { id: assignmentId, evidence: evidenceId },
    );
  }

  /** Bytes only: the owner authorized this exact object and the browser sends no credentials. */
  async upload(request: EvidenceRequest, body: ArrayBuffer): Promise<{ completed: boolean; status: number }> {
    const headers = JSON.parse(request.upload.headersJson) as Record<string, string>;
    const target: EvidenceUploadTarget = {
      url: request.upload.url,
      method: 'PUT',
      headers,
      expiresAt: request.upload.expiresAt,
    };
    return this.session.uploadEvidence(target, body);
  }
}
