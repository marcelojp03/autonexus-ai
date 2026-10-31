import { invalid, object, only, uuid } from './employee.js';
import type { Permission } from './permissions.js';

/** CU16 scopes. The scope selects both the required permission and the record constraint. */
export type ExecutionScope = 'write' | 'read-self' | 'read-team' | 'verify';

/** One closed permission per scope: no prefix inheritance, no decisions by role name. */
export const EXECUTION_PERMISSION: Readonly<Record<ExecutionScope, Permission>> = Object.freeze({
  write: 'executions:write',
  'read-self': 'executions:read:self',
  'read-team': 'executions:read:team',
  verify: 'executions:verify',
});

/** Scopes that constrain the record to the resolved employee. */
export const OWN_RECORD_SCOPES: readonly ExecutionScope[] = Object.freeze(['write', 'read-self']);

export interface ExecutionActor {
  employeeId: string;
  fullName: string;
  status: 'active';
}

export function executionScope(value: unknown): ExecutionScope {
  if (value !== 'write' && value !== 'read-self' && value !== 'read-team' && value !== 'verify') return invalid();
  return value;
}

export interface ExecutionAuthorizeRequest {
  scope: ExecutionScope;
  assignmentIds: string[];
}

export function executionAuthorizeInput(value: unknown): ExecutionAuthorizeRequest {
  const input = object(value);
  only(input, ['scope', 'assignmentIds']);
  const scope = executionScope(input.scope);
  const ids = input.assignmentIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) return invalid();
  const assignmentIds = ids.map(uuid);
  if (new Set(assignmentIds).size !== assignmentIds.length) return invalid();
  return { scope, assignmentIds };
}
