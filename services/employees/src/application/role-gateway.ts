import type { Permission } from '../domain/permissions.js';
import type { SyncErrorCode } from '../domain/security.js';

export class RoleSyncError extends Error {
  constructor(readonly code: SyncErrorCode) { super(code); this.name = 'RoleSyncError'; }
}

/** Port to the identity provider. Failures never roll back the local commit. */
export interface RoleGateway {
  upsertRole(name: string, description: string, permissions: readonly Permission[]): Promise<void>;
  assignRole(employeeId: string, subject: string, roleName: string): Promise<void>;
  revokeRole(employeeId: string, subject: string, roleName: string): Promise<void>;
}
