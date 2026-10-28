import { PERMISSION_CATALOG, type Permission } from '../domain/permissions.js';
import {
  SecurityError,
  type AssignmentView,
  assertNoEscalation,
  expectedVersionOf,
  roleDraft,
  roleName,
  type RoleView,
} from '../domain/security.js';
import { uuid } from '../domain/employee.js';
import type { SyncErrorCode } from '../domain/security.js';
import { RoleSyncError, type RoleGateway } from './role-gateway.js';
import type {
  AssignmentMutation,
  EmployeeRoles,
  RoleMutation,
  SecurityHistoryPage,
  SecurityHistoryQuery,
  SecurityRepository,
} from './security-repository.js';

const invalid = (): never => { throw new SecurityError(400, 'VALIDATION_ERROR'); };
const command = (value: unknown, keys: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !keys.includes(key))) return invalid();
  return body;
};
const operation = (value: unknown): string => (typeof value === 'string' ? uuid(value) : invalid());
const syncCode = (error: unknown): SyncErrorCode => (error instanceof RoleSyncError ? error.code : 'IDP_UNAVAILABLE');

const CREATE_ROLE_KEYS = ['operationId', 'name', 'description', 'permissions'] as const;
const UPDATE_ROLE_KEYS = ['operationId', 'expectedVersion', 'description', 'permissions'] as const;
const RETRY_KEYS = ['operationId', 'expectedVersion'] as const;
const REVOKE_KEYS = ['operationId', 'expectedVersion'] as const;
const ASSIGN_KEYS = ['operationId', 'roleName'] as const;

export interface SecurityCatalog {
  readonly catalog: typeof PERMISSION_CATALOG;
  readonly effective: readonly Permission[];
  readonly roles: readonly string[];
}

/** CU02 use cases. Authorization itself happens in the guard and in the BFF policy. */
export class ManageSecurity {
  constructor(
    private readonly repository: SecurityRepository,
    private readonly identityProvider: RoleGateway,
  ) {}

  async catalog(subject: string, roles: readonly string[]): Promise<SecurityCatalog> {
    const effective = await this.repository.permissions(subject, roles);
    return { catalog: PERMISSION_CATALOG, effective: effective.permissions, roles: effective.recognized };
  }

  roles(): Promise<readonly RoleView[]> {
    return this.repository.roles();
  }

  role(name: unknown): Promise<RoleView> {
    return this.repository.role(roleName(name));
  }

  employeeRoles(employeeId: unknown): Promise<EmployeeRoles> {
    return this.repository.employeeRoles(uuid(employeeId));
  }

  history(query: unknown): Promise<SecurityHistoryPage> {
    const input = query === undefined || query === null ? {} : command(query, ['limit', 'offset', 'roleName', 'employeeId']);
    const limit = input.limit === undefined ? 20 : input.limit;
    const offset = input.offset === undefined ? 0 : input.offset;
    if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) return invalid();
    if (!Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) > 2147483647) return invalid();
    const roleNameFilter = input.roleName === undefined ? undefined : roleName(input.roleName);
    const employeeIdFilter = input.employeeId === undefined ? undefined : uuid(input.employeeId);
    return this.repository.history({
      limit: limit as number,
      offset: offset as number,
      ...(roleNameFilter ? { roleName: roleNameFilter } : {}),
      ...(employeeIdFilter ? { employeeId: employeeIdFilter } : {}),
    });
  }

  async createRole(body: unknown, actorSubject: string, actorPermissions: readonly Permission[]): Promise<RoleMutation> {
    const input = command(body, CREATE_ROLE_KEYS);
    const draft = roleDraft({ description: input.description, permissions: input.permissions }, ['description', 'permissions']);
    assertNoEscalation(draft.permissions, actorPermissions);
    const mutation = await this.repository.createRole(roleName(input.name), draft, actorSubject, operation(input.operationId));
    return this.syncRole(mutation, actorSubject);
  }

  async updateRole(name: unknown, body: unknown, actorSubject: string, actorPermissions: readonly Permission[]): Promise<RoleMutation> {
    const input = command(body, UPDATE_ROLE_KEYS);
    const draft = roleDraft({ description: input.description, permissions: input.permissions }, ['description', 'permissions']);
    assertNoEscalation(draft.permissions, actorPermissions);
    const mutation = await this.repository.updateRole(
      roleName(name), draft, expectedVersionOf(input.expectedVersion), actorSubject, operation(input.operationId),
    );
    return this.syncRole(mutation, actorSubject);
  }

  async retryRoleSync(name: unknown, body: unknown, actorSubject: string): Promise<RoleMutation> {
    const input = command(body, RETRY_KEYS);
    const mutation = await this.repository.retryRoleSync(
      roleName(name), expectedVersionOf(input.expectedVersion), actorSubject, operation(input.operationId),
    );
    const synced = await this.syncRole(mutation, actorSubject);
    if (mutation.replayed) return synced;
    for (const assignment of await this.repository.unsyncedAssignments(mutation.role.name)) {
      await this.syncAssignment(assignment);
    }
    return synced;
  }

  async assignRole(employeeId: unknown, body: unknown, actorSubject: string, actorPermissions: readonly Permission[]): Promise<AssignmentMutation> {
    const input = command(body, ASSIGN_KEYS);
    const target = await this.repository.role(roleName(input.roleName));
    // An actor cannot hand out a role with permissions it does not hold itself.
    assertNoEscalation(target.permissions, actorPermissions);
    const mutation = await this.repository.assignRole(uuid(employeeId), target.name, actorSubject, operation(input.operationId));
    return this.syncAssignmentMutation(mutation);
  }

  async revokeRole(employeeId: unknown, roleNameValue: unknown, body: unknown, actorSubject: string): Promise<AssignmentMutation> {
    const input = command(body, REVOKE_KEYS);
    const mutation = await this.repository.revokeRole(
      uuid(employeeId), roleName(roleNameValue), expectedVersionOf(input.expectedVersion), actorSubject, operation(input.operationId),
    );
    if (mutation.replayed) return mutation;
    return this.syncRevoke(mutation);
  }

  private async syncRole(mutation: RoleMutation, actorSubject: string): Promise<RoleMutation> {
    if (mutation.replayed) return mutation;
    const role = mutation.role;
    try {
      await this.identityProvider.upsertRole(role.name, role.description, role.permissions);
    } catch (error) {
      const failed = await this.repository.saveRoleSync(role.name, 'failed', syncCode(error), actorSubject, 'role-synced');
      return { role: failed, replayed: false };
    }
    const synced = await this.repository.saveRoleSync(role.name, 'synced', null, actorSubject, 'role-synced');
    return { role: synced, replayed: false };
  }

  private async syncAssignmentMutation(mutation: AssignmentMutation): Promise<AssignmentMutation> {
    if (mutation.replayed) return mutation;
    const assignment = mutation.assignment;
    const updated = await this.syncAssignment(assignment);
    return { assignment: updated, replayed: false };
  }

  private async syncRevoke(mutation: AssignmentMutation): Promise<AssignmentMutation> {
    const assignment = mutation.assignment;
    if (assignment.status === 'revoked' && assignment.syncStatus === 'pending') {
      try {
        await this.identityProvider.revokeRole(assignment.employeeId, assignment.subject, assignment.roleName);
        const synced = await this.repository.saveAssignmentSync(assignment.id, 'synced', null);
        return { assignment: synced, replayed: false };
      } catch (error) {
        const failed = await this.repository.saveAssignmentSync(assignment.id, 'failed', syncCode(error));
        return { assignment: failed, replayed: false };
      }
    }
    return mutation;
  }

  /** Applies the assignment or its revocation, depending on the persisted state. */
  private async syncAssignment(assignment: AssignmentView) {
    try {
      if (assignment.status === 'revoked') {
        await this.identityProvider.revokeRole(assignment.employeeId, assignment.subject, assignment.roleName);
      } else {
        await this.identityProvider.assignRole(assignment.employeeId, assignment.subject, assignment.roleName);
      }
      return this.repository.saveAssignmentSync(assignment.id, 'synced', null);
    } catch (error) {
      return this.repository.saveAssignmentSync(assignment.id, 'failed', syncCode(error));
    }
  }
}
