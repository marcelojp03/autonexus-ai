import type { Permission } from '../domain/permissions.js';
import type { AssignmentView, RoleDraft, RoleView, SecurityHistoryView, SyncErrorCode, SyncStatus } from '../domain/security.js';

export interface EffectivePermissions {
  readonly roles: readonly string[];
  readonly recognized: readonly string[];
  readonly permissions: readonly Permission[];
}

export interface RoleMutation { readonly role: RoleView; readonly replayed: boolean; }
export interface AssignmentMutation { readonly assignment: AssignmentView; readonly replayed: boolean; }
export interface EmployeeRoles { readonly employeeId: string; readonly subject: string | null; readonly items: readonly AssignmentView[]; }

export interface SecurityHistoryQuery {
  readonly limit?: number;
  readonly offset?: number;
  readonly roleName?: string;
  readonly employeeId?: string;
}
export interface SecurityHistoryPage {
  readonly items: readonly SecurityHistoryView[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** Port to the owner database. Nothing here crosses into another service's schema. */
export interface SecurityRepository {
  permissions(subject: string, roles: readonly string[]): Promise<EffectivePermissions>;
  roles(): Promise<readonly RoleView[]>;
  role(name: string): Promise<RoleView>;
  createRole(name: string, draft: RoleDraft, actor: string, operationId: string): Promise<RoleMutation>;
  updateRole(name: string, draft: RoleDraft, expectedVersion: number, actor: string, operationId: string): Promise<RoleMutation>;
  saveRoleSync(name: string, status: SyncStatus, errorCode: SyncErrorCode | null, actor: string, action: string): Promise<RoleView>;
  unsyncedAssignments(roleName: string): Promise<readonly AssignmentView[]>;
  employeeRoles(employeeId: string): Promise<EmployeeRoles>;
  assignRole(employeeId: string, roleName: string, actor: string, operationId: string): Promise<AssignmentMutation>;
  revokeRole(employeeId: string, roleName: string, expectedVersion: number, actor: string, operationId: string): Promise<AssignmentMutation>;
  saveAssignmentSync(id: string, status: SyncStatus, errorCode: SyncErrorCode | null): Promise<AssignmentView>;
  history(query: SecurityHistoryQuery): Promise<SecurityHistoryPage>;
}
