import { describe, expect, it, vi } from 'vitest';
import { ManageSecurity } from './manage-security.js';
import { RoleSyncError, type RoleGateway } from './role-gateway.js';
import type { SecurityRepository } from './security-repository.js';
import { SecurityError, type AssignmentView, type RoleView, type SyncStatus } from '../domain/security.js';

const pendingRole = (name: string, permissions: readonly string[] = ['schedules:read']): RoleView => ({
  name, description: '', permissions: permissions as RoleView['permissions'], system: false, version: 1,
  syncStatus: 'pending', syncErrorCode: null, assignedCount: 0, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
});
const pendingAssignment = (id = 'assignment-1'): AssignmentView => ({
  id, roleName: 'supervisor', employeeId: 'employee-1', subject: 'subject-1', status: 'active',
  syncStatus: 'pending', syncErrorCode: null, assignedAt: new Date(0).toISOString(), assignedBy: 'actor', version: 1,
});

function repository(overrides: Partial<SecurityRepository> = {}) {
  const base = {
    permissions: vi.fn(async () => ({ roles: ['administrador'], recognized: ['administrador'], permissions: ['security:read', 'schedules:read'] })),
    roles: vi.fn(async () => [] as RoleView[]),
    role: vi.fn(async () => pendingRole('supervisor')),
    createRole: vi.fn(async (name: string, draft: { description: string; permissions: readonly string[] }) => ({ role: { ...pendingRole(name, draft.permissions), description: draft.description }, replayed: false })),
    updateRole: vi.fn(async (name: string, draft: { permissions: readonly string[] }, version: number) => ({
      role: { ...pendingRole(name, draft.permissions), version: version + 1 }, replayed: false,
    })),
    saveRoleSync: vi.fn(async (name: string, status: SyncStatus, errorCode: string | null) => ({
      ...pendingRole(name), syncStatus: status, syncErrorCode: errorCode as RoleView['syncErrorCode'],
    })),
    unsyncedAssignments: vi.fn(async () => [] as AssignmentView[]),
    employeeRoles: vi.fn(async () => ({ employeeId: 'employee-1', subject: 'subject-1', items: [] })),
    assignRole: vi.fn(async () => ({ assignment: pendingAssignment(), replayed: false })),
    revokeRole: vi.fn(async () => ({ assignment: { ...pendingAssignment(), status: 'revoked' as const }, replayed: false })),
    saveAssignmentSync: vi.fn(async (id: string, status: SyncStatus, errorCode: string | null) => ({
      ...pendingAssignment(id), syncStatus: status, syncErrorCode: errorCode as AssignmentView['syncErrorCode'],
    })),
    history: vi.fn(async (query: { limit?: number; offset?: number }) => ({
      items: [], total: 0, limit: query.limit ?? 20, offset: query.offset ?? 0,
    })),
    ...overrides,
  };
  return base as unknown as SecurityRepository & typeof base;
}

function gateway(overrides: Partial<RoleGateway> = {}) {
  const base = {
    upsertRole: vi.fn(async () => undefined),
    assignRole: vi.fn(async () => undefined),
    revokeRole: vi.fn(async () => undefined),
    ...overrides,
  };
  return base as unknown as RoleGateway & typeof base;
}

const code = async (work: () => Promise<unknown>): Promise<string> => {
  try { await work(); } catch (error) { return (error as SecurityError).code; }
  return 'NO_ERROR';
};

describe('ManageSecurity', () => {
  it('exposes the closed catalog with the actor effective permissions', async () => {
    const security = new ManageSecurity(repository(), gateway());
    const catalog = await security.catalog('subject-1', ['administrador']);
    expect(catalog.catalog.map(item => item.id)).toContain('security:write');
    expect(catalog.effective).toEqual(['security:read', 'schedules:read']);
    expect(catalog.roles).toEqual(['administrador']);
  });

  it('creates a role, materializes it in the IdP and reports synced', async () => {
    const repo = repository();
    const idp = gateway();
    const security = new ManageSecurity(repo, idp);
    const result = await security.createRole(
      { operationId: '4f5c1f9e-0000-4000-8000-000000000001', name: 'supervisor', description: 'Supervisa', permissions: ['schedules:read'] },
      'actor', ['security:write', 'schedules:read'],
    );
    expect(idp.upsertRole).toHaveBeenCalledWith('supervisor', 'Supervisa', ['schedules:read']);
    expect(repo.saveRoleSync).toHaveBeenCalledWith('supervisor', 'synced', null, 'actor', 'role-synced');
    expect(result.role.syncStatus).toBe('synced');
  });

  it('keeps the local role when the IdP fails, reporting a safe error code', async () => {
    const repo = repository();
    const idp = gateway({ upsertRole: vi.fn(async () => { throw new RoleSyncError('IDP_FORBIDDEN'); }) });
    const security = new ManageSecurity(repo, idp);
    const result = await security.createRole(
      { operationId: '4f5c1f9e-0000-4000-8000-000000000002', name: 'supervisor', permissions: ['schedules:read'] },
      'actor', ['security:write', 'schedules:read'],
    );
    expect(repo.saveRoleSync).toHaveBeenCalledWith('supervisor', 'failed', 'IDP_FORBIDDEN', 'actor', 'role-synced');
    expect(result.role.syncStatus).toBe('failed');
    expect(result.role.syncErrorCode).toBe('IDP_FORBIDDEN');
  });

  it('rejects an escalation before touching the repository', async () => {
    const repo = repository();
    const security = new ManageSecurity(repo, gateway());
    const result = await code(() => security.createRole(
      { operationId: '4f5c1f9e-0000-4000-8000-000000000003', name: 'supervisor', permissions: ['employees:write'] },
      'actor', ['security:write'],
    ));
    expect(result).toBe('PERMISSION_ESCALATION');
    expect(repo.createRole).not.toHaveBeenCalled();
  });

  it('requires a positive expectedVersion to update', async () => {
    const security = new ManageSecurity(repository(), gateway());
    expect(await code(() => security.updateRole('supervisor', { operationId: '4f5c1f9e-0000-4000-8000-000000000004', expectedVersion: 0, permissions: ['schedules:read'] }, 'actor', ['schedules:read'])))
      .toBe('VALIDATION_ERROR');
  });

  it('reconciles the role and its pending assignments on retry', async () => {
    const repo = repository({ unsyncedAssignments: vi.fn(async () => [pendingAssignment()]) });
    const idp = gateway();
    const security = new ManageSecurity(repo, idp);
    const result = await security.retryRoleSync('supervisor', { operationId: '4f5c1f9e-0000-4000-8000-000000000005', expectedVersion: 1 }, 'actor');
    expect(idp.upsertRole).toHaveBeenCalled();
    expect(idp.assignRole).toHaveBeenCalledWith('employee-1', 'subject-1', 'supervisor');
    expect(result.role.syncStatus).toBe('synced');
  });

  it('rejects a retry whose version is stale', async () => {
    const repo = repository({ role: vi.fn(async () => ({ ...pendingRole('supervisor'), version: 3 })) });
    const security = new ManageSecurity(repo, gateway());
    expect(await code(() => security.retryRoleSync('supervisor', { operationId: '4f5c1f9e-0000-4000-8000-000000000006', expectedVersion: 2 }, 'actor')))
      .toBe('VERSION_CONFLICT');
  });

  it('assigns a role and syncs the realm mapping', async () => {
    const repo = repository();
    const idp = gateway();
    const security = new ManageSecurity(repo, idp);
    const result = await security.assignRole('11111111-1111-4111-8111-111111111111', { operationId: '4f5c1f9e-0000-4000-8000-000000000007', roleName: 'supervisor' }, 'actor');
    expect(idp.assignRole).toHaveBeenCalledWith('employee-1', 'subject-1', 'supervisor');
    expect(result.assignment.syncStatus).toBe('synced');
  });

  it('revokes a role and removes the realm mapping', async () => {
    const repo = repository({
      saveAssignmentSync: vi.fn(async (id: string, status: SyncStatus, errorCode: string | null) => ({
        ...pendingAssignment(id), status: 'revoked' as const, syncStatus: status, syncErrorCode: errorCode as AssignmentView['syncErrorCode'],
      })),
    });
    const idp = gateway();
    const security = new ManageSecurity(repo, idp);
    const result = await security.revokeRole('11111111-1111-4111-8111-111111111111', 'supervisor', { operationId: '4f5c1f9e-0000-4000-8000-000000000008', expectedVersion: 1 }, 'actor');
    expect(idp.revokeRole).toHaveBeenCalledWith('employee-1', 'subject-1', 'supervisor');
    expect(result.assignment.status).toBe('revoked');
    expect(result.assignment.syncStatus).toBe('synced');
  });

  it('validates the history page bounds', async () => {
    const security = new ManageSecurity(repository(), gateway());
    expect(await code(() => security.history({ limit: 0 }))).toBe('VALIDATION_ERROR');
    expect(await code(() => security.history({ limit: 20, offset: -1 }))).toBe('VALIDATION_ERROR');
    expect((await security.history({ limit: 5 })).limit).toBe(5);
  });
});
