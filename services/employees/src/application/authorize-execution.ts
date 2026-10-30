import {
  EXECUTION_PERMISSION,
  OWN_RECORD_SCOPES,
  executionAuthorizeInput,
} from '../domain/executions.js';
import { EmployeeError } from '../domain/employee.js';
import type { ExecutionActor } from '../domain/executions.js';
import type { ExecutionsRepository } from './executions-repository.js';

export interface ExecutionIdentity {
  subject: string;
  roles: readonly string[];
  permissions: readonly string[];
}

const denied = () => new EmployeeError(403, 'EXECUTION_ACCESS_DENIED');
const missing = () => new EmployeeError(404, 'EXECUTION_WORK_NOT_FOUND');

/**
 * Read-only resolution for CU16. It never mutates: Operations decides the execution itself and
 * only asks the owner of identity for the human actor and the current assignment state.
 */
export class AuthorizeExecution {
  constructor(private readonly repository: ExecutionsRepository) {}

  async authorize(identity: ExecutionIdentity, input: unknown) {
    const { scope, assignmentIds } = executionAuthorizeInput(input);
    // The guard resolved the catalog; the scope decides which grant is required.
    if (!identity.permissions.includes(EXECUTION_PERMISSION[scope])) throw denied();
    const actor: ExecutionActor | null = await this.repository.actor(
      identity.subject,
      identity.roles,
      scope,
    );
    if (!actor) throw denied();
    const items = await this.repository.assignments(
      assignmentIds,
      OWN_RECORD_SCOPES.includes(scope) ? actor.employeeId : null,
    );
    // Never a partial answer: any unknown, saga-less or out-of-scope id fails the whole request.
    if (items.length !== assignmentIds.length) throw missing();
    return {
      actor: {
        employeeId: actor.employeeId,
        fullName: actor.fullName,
        status: actor.status,
      },
      items,
      observedAt: new Date().toISOString(),
    };
  }
}
