import type { AssignmentCheck } from '../domain/agenda.js';
import type { ExecutionActor, ExecutionScope } from '../domain/executions.js';

/**
 * CU16 resolution. The scope is part of the port so the owner resolves the permission and the
 * record constraint together: there is no path that returns an actor without the scope's grant.
 */
export interface ExecutionsRepository {
  actor(
    subject: string,
    roles: readonly string[],
    scope: ExecutionScope,
  ): Promise<ExecutionActor | null>;
  assignments(
    ids: readonly string[],
    employeeId: string | null,
  ): Promise<AssignmentCheck[]>;
}
