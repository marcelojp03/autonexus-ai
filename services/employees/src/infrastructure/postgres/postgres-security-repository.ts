import { createHash, randomUUID } from 'node:crypto';
import type { OnApplicationShutdown } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import { isPermission, type Permission } from '../../domain/permissions.js';
import {
  SecurityError,
  type AssignmentView,
  type RoleDraft,
  type RoleView,
  type SecurityHistoryView,
  type SyncErrorCode,
  type SyncStatus,
} from '../../domain/security.js';
import type {
  AssignmentMutation,
  EffectivePermissions,
  EmployeeRoles,
  RoleMutation,
  SecurityHistoryPage,
  SecurityHistoryQuery,
  SecurityRepository,
} from '../../application/security-repository.js';
import { dataSourceOptions } from './data-source-options.js';

type RoleRow = {
  name: string; description: string; permissions: string[]; system: boolean; version: number;
  sync_status: SyncStatus; sync_error_code: SyncErrorCode | null; created_at: Date; updated_at: Date; assigned_count?: number;
};
type AssignmentRow = {
  id: string; role_name: string; employee_id: string; subject: string; version: number;
  sync_status: SyncStatus; sync_error_code: SyncErrorCode | null; assigned_at: Date; assigned_by: string; revoked_at: Date | null;
};
type HistoryRow = {
  id: string; entity: 'role' | 'assignment'; entity_id: string; action: string; actor_subject: string;
  occurred_at: Date; version: number; snapshot: unknown;
};

const permissionsOf = (values: string[]): readonly Permission[] => values.filter(isPermission);
const roleView = (row: RoleRow): RoleView => ({
  name: row.name,
  description: row.description,
  permissions: permissionsOf(row.permissions),
  system: row.system,
  version: row.version,
  syncStatus: row.sync_status,
  syncErrorCode: row.sync_error_code,
  assignedCount: Number(row.assigned_count ?? 0),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
const assignmentView = (row: AssignmentRow): AssignmentView => ({
  id: row.id,
  roleName: row.role_name,
  employeeId: row.employee_id,
  subject: row.subject,
  status: row.revoked_at ? 'revoked' : 'active',
  syncStatus: row.sync_status,
  syncErrorCode: row.sync_error_code,
  assignedAt: row.assigned_at.toISOString(),
  assignedBy: row.assigned_by,
  version: row.version,
});
const historyView = (row: HistoryRow): SecurityHistoryView => ({
  id: row.id,
  entity: row.entity,
  entityId: row.entity_id,
  action: row.action,
  actorSubject: row.actor_subject,
  occurredAt: row.occurred_at.toISOString(),
  version: row.version,
  snapshot: row.snapshot,
});

/** UPDATE ... RETURNING may arrive as rows or as [rows, affected]; normalise both shapes. */
const returned = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) {
    const structured = value as { records?: unknown[]; raw?: unknown[] };
    return structured.records ?? structured.raw ?? [];
  }
  return Array.isArray(value[0]) ? (value[0] as unknown[]) : value;
};

const ROLE_COLUMNS = 'name, description, permissions, system, version, sync_status, sync_error_code, created_at, updated_at';
const ASSIGNMENT_COLUMNS = 'id, role_name, employee_id, subject, version, sync_status, sync_error_code, assigned_at, assigned_by, revoked_at';

export class PostgresSecurityRepository implements SecurityRepository, OnApplicationShutdown {
  private source?: DataSource;
  private initializing?: Promise<DataSource>;

  private async database(): Promise<DataSource> {
    this.source ??= new DataSource(dataSourceOptions());
    if (!this.source.isInitialized) {
      this.initializing ??= this.source.initialize();
      try { await this.initializing; } finally { this.initializing = undefined; }
    }
    return this.source;
  }

  async onApplicationShutdown(): Promise<void> {
    try { await this.initializing; } catch { /* no pool */ }
    if (this.source?.isInitialized) await this.source.destroy();
  }

  private failure(error: unknown): never {
    if (error instanceof SecurityError) throw error;
    const sql = error as { code?: string };
    if (sql.code === '23505') throw new SecurityError(409, 'ROLE_ALREADY_ASSIGNED');
    if (sql.code === '23514' || sql.code === '22P02' || sql.code === '22007' || sql.code === '22001') throw new SecurityError(400, 'VALIDATION_ERROR');
    throw new SecurityError(503, 'PERSISTENCE_UNAVAILABLE', { cause: error });
  }

  /** One advisory-locked transaction per mutation; version and last-administrator checks share it. */
  private async transactional<T>(keys: readonly string[], work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    let runner: QueryRunner | undefined;
    try {
      runner = (await this.database()).createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      for (const key of keys) {
        const rows = await runner.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [key]) as Array<{ acquired: boolean }>;
        if (!rows[0]?.acquired) throw new SecurityError(503, 'PERSISTENCE_UNAVAILABLE');
      }
      const result = await work(runner);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      if (runner?.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      return this.failure(error);
    } finally {
      await runner?.release();
    }
  }

  private async read<T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = (await this.database()).createQueryRunner();
    try {
      await runner.connect();
      return await work(runner);
    } catch (error) {
      return this.failure(error);
    } finally {
      await runner.release();
    }
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async replay<T>(runner: QueryRunner, operationId: string, fingerprint: string): Promise<T | null> {
    const rows = await runner.query('SELECT fingerprint, result FROM employees.security_operations WHERE operation_id=$1', [operationId]) as Array<{ fingerprint: string; result: T }>;
    if (!rows[0]) return null;
    if (rows[0].fingerprint !== fingerprint) throw new SecurityError(409, 'IDEMPOTENCY_CONFLICT');
    return rows[0].result;
  }

  private async remember(runner: QueryRunner, operationId: string, fingerprint: string, result: unknown): Promise<void> {
    await runner.query('INSERT INTO employees.security_operations(operation_id, fingerprint, result) VALUES($1,$2,$3::jsonb)', [operationId, fingerprint, JSON.stringify(result)]);
  }

  private async audit(
    runner: QueryRunner, entity: 'role' | 'assignment', entityId: string, roleName: string,
    employeeId: string | null, action: string, actor: string, version: number, snapshot: unknown,
  ): Promise<void> {
    await runner.query(
      `INSERT INTO employees.security_history(id, entity, entity_id, role_name, employee_id, action, actor_subject, occurred_at, version, snapshot)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [randomUUID(), entity, entityId, roleName, employeeId, action, actor, new Date().toISOString(), version, JSON.stringify(snapshot)],
    );
  }

  async permissions(subject: string, roles: readonly string[]): Promise<EffectivePermissions> {
    if (roles.length === 0) return { roles, recognized: [], permissions: [] };
    return this.read(async runner => {
      const rows = await runner.query(
        `SELECT r.name, r.permissions
         FROM employees.security_roles r
         WHERE r.name = ANY($1::text[])
           AND (
             NOT EXISTS (SELECT 1 FROM employees.employee_records e WHERE e.subject = $2)
             OR EXISTS (
               SELECT 1 FROM employees.security_role_assignments a
               JOIN employees.employee_records e ON e.id = a.employee_id
               WHERE a.role_name = r.name AND a.revoked_at IS NULL AND a.subject = $2
                 AND e.record->>'status' = 'active'
             )
           )
         ORDER BY r.name`,
        [[...roles], subject],
      ) as Array<{ name: string; permissions: string[] }>;
      const granted = new Set<string>();
      for (const row of rows) for (const permission of permissionsOf(row.permissions)) granted.add(permission);
      return {
        roles,
        recognized: rows.map(row => row.name),
        permissions: [...granted].sort() as Permission[],
      };
    });
  }

  async roles(): Promise<readonly RoleView[]> {
    return this.read(async runner => {
      const rows = await runner.query(
        `SELECT ${ROLE_COLUMNS},
           (SELECT count(*)::int FROM employees.security_role_assignments a WHERE a.role_name=r.name AND a.revoked_at IS NULL) AS assigned_count
         FROM employees.security_roles r
         ORDER BY r.system DESC, r.name`,
      ) as RoleRow[];
      return rows.map(roleView);
    });
  }

  async role(name: string): Promise<RoleView> {
    return this.read(async runner => {
      const rows = await runner.query(
        `SELECT ${ROLE_COLUMNS},
           (SELECT count(*)::int FROM employees.security_role_assignments a WHERE a.role_name=r.name AND a.revoked_at IS NULL) AS assigned_count
         FROM employees.security_roles r WHERE r.name=$1`,
        [name],
      ) as RoleRow[];
      if (!rows[0]) throw new SecurityError(404, 'ROLE_NOT_FOUND');
      return roleView(rows[0]);
    });
  }

  async createRole(name: string, draft: RoleDraft, actor: string, operationId: string): Promise<RoleMutation> {
    const fingerprint = this.fingerprint({ actor, action: 'create-role', name, draft });
    return this.transactional(['security:role:' + name], async runner => {
      const replayed = await this.replay<RoleMutation>(runner, operationId, fingerprint);
      if (replayed) return { role: replayed.role, replayed: true };
      const existing = await runner.query('SELECT 1 FROM employees.security_roles WHERE name=$1', [name]) as unknown[];
      if (existing.length) throw new SecurityError(409, 'ROLE_DUPLICATE');
      const now = new Date().toISOString();
      await runner.query(
        `INSERT INTO employees.security_roles(name, description, permissions, system, version, sync_status, created_at, updated_at)
         VALUES($1,$2,$3::text[],false,1,'pending',$4,$4)`,
        [name, draft.description, draft.permissions, now],
      );
      const role = roleView({
        name, description: draft.description, permissions: [...draft.permissions], system: false, version: 1,
        sync_status: 'pending', sync_error_code: null, created_at: new Date(now), updated_at: new Date(now), assigned_count: 0,
      } as RoleRow);
      await this.audit(runner, 'role', name, name, null, 'role-created', actor, 1, role);
      const result: RoleMutation = { role, replayed: false };
      await this.remember(runner, operationId, fingerprint, result);
      return result;
    });
  }

  async updateRole(name: string, draft: RoleDraft, expectedVersion: number, actor: string, operationId: string): Promise<RoleMutation> {
    const fingerprint = this.fingerprint({ actor, action: 'update-role', name, draft, expectedVersion });
    return this.transactional(['security:administrators', 'security:role:' + name], async runner => {
      const rows = await runner.query(`SELECT ${ROLE_COLUMNS} FROM employees.security_roles WHERE name=$1`, [name]) as RoleRow[];
      if (!rows[0]) throw new SecurityError(404, 'ROLE_NOT_FOUND');
      const replayed = await this.replay<RoleMutation>(runner, operationId, fingerprint);
      if (replayed) return { role: replayed.role, replayed: true };
      if (rows[0].version !== expectedVersion) throw new SecurityError(409, 'VERSION_CONFLICT');
      const version = expectedVersion + 1;
      await runner.query(
        `UPDATE employees.security_roles SET description=$2, permissions=$3::text[], version=$4, sync_status='pending', sync_error_code=NULL, updated_at=$5
         WHERE name=$1`,
        [name, draft.description, draft.permissions, version, new Date().toISOString()],
      );
      if (!draft.permissions.includes('security:write') && rows[0].permissions.includes('security:write')) {
        await this.assertAdministratorsRemain(runner, null);
      }
      const role = roleView({ ...rows[0], description: draft.description, permissions: [...draft.permissions], version, sync_status: 'pending' } as RoleRow);
      await this.audit(runner, 'role', name, name, null, 'role-updated', actor, version, role);
      const result: RoleMutation = { role, replayed: false };
      await this.remember(runner, operationId, fingerprint, result);
      return result;
    });
  }

  async saveRoleSync(name: string, status: SyncStatus, errorCode: SyncErrorCode | null, actor: string, action: string): Promise<RoleView> {
    return this.transactional([], async runner => {
      const result = await runner.query(
        `UPDATE employees.security_roles SET sync_status=$2, sync_error_code=$3, updated_at=$4 WHERE name=$1
         RETURNING name, description, permissions, system, version, sync_status, sync_error_code, created_at, updated_at`,
        [name, status, errorCode, new Date().toISOString()],
      );
      const row = returned(result)[0] as RoleRow | undefined;
      if (!row) throw new SecurityError(404, 'ROLE_NOT_FOUND');
      const role = roleView(row);
      await this.audit(runner, 'role', name, name, null, action, actor, role.version, role);
      return role;
    });
  }

  async unsyncedAssignments(roleName: string): Promise<readonly AssignmentView[]> {
    return this.read(async runner => {
      const rows = await runner.query(
        `SELECT ${ASSIGNMENT_COLUMNS} FROM employees.security_role_assignments
         WHERE role_name=$1 AND revoked_at IS NULL AND sync_status<>'synced' ORDER BY assigned_at`,
        [roleName],
      ) as AssignmentRow[];
      return rows.map(assignmentView);
    });
  }

  async employeeRoles(employeeId: string): Promise<EmployeeRoles> {
    return this.read(async runner => {
      const employees = await runner.query('SELECT id, subject FROM employees.employee_records WHERE id=$1', [employeeId]) as Array<{ id: string; subject: string | null }>;
      if (!employees[0]) throw new SecurityError(404, 'EMPLOYEE_NOT_FOUND');
      const rows = await runner.query(
        `SELECT ${ASSIGNMENT_COLUMNS} FROM employees.security_role_assignments WHERE employee_id=$1 ORDER BY assigned_at DESC, role_name`,
        [employeeId],
      ) as AssignmentRow[];
      return { employeeId, subject: employees[0].subject, items: rows.map(assignmentView) };
    });
  }

  async assignRole(employeeId: string, roleName: string, actor: string, operationId: string): Promise<AssignmentMutation> {
    const fingerprint = this.fingerprint({ actor, action: 'assign-role', employeeId, roleName });
    return this.transactional(['security:administrators', 'security:employee:' + employeeId], async runner => {
      const replayed = await this.replay<AssignmentMutation>(runner, operationId, fingerprint);
      if (replayed) return { assignment: replayed.assignment, replayed: true };
      const roles = await runner.query('SELECT 1 FROM employees.security_roles WHERE name=$1', [roleName]) as unknown[];
      if (!roles.length) throw new SecurityError(404, 'ROLE_NOT_FOUND');
      const employees = await runner.query(
        "SELECT id, subject, record->>'status' AS status FROM employees.employee_records WHERE id=$1",
        [employeeId],
      ) as Array<{ id: string; subject: string | null; status: string }>;
      if (!employees[0]) throw new SecurityError(404, 'EMPLOYEE_NOT_FOUND');
      if (employees[0].status !== 'active') throw new SecurityError(409, 'EMPLOYEE_INACTIVE');
      const subject = employees[0].subject;
      if (!subject) throw new SecurityError(409, 'EMPLOYEE_WITHOUT_IDENTITY');
      const active = await runner.query(
        'SELECT 1 FROM employees.security_role_assignments WHERE employee_id=$1 AND role_name=$2 AND revoked_at IS NULL',
        [employeeId, roleName],
      ) as unknown[];
      if (active.length) throw new SecurityError(409, 'ROLE_ALREADY_ASSIGNED');
      const id = randomUUID();
      const now = new Date().toISOString();
      await runner.query(
        `INSERT INTO employees.security_role_assignments(id, role_name, employee_id, subject, version, sync_status, assigned_at, assigned_by)
         VALUES($1,$2,$3,$4,1,'pending',$5,$6)`,
        [id, roleName, employeeId, subject, now, actor],
      );
      const assignment: AssignmentView = {
        id, roleName, employeeId, subject, status: 'active', syncStatus: 'pending', syncErrorCode: null,
        assignedAt: now, assignedBy: actor, version: 1,
      };
      await this.audit(runner, 'assignment', id, roleName, employeeId, 'role-assigned', actor, 1, assignment);
      const result: AssignmentMutation = { assignment, replayed: false };
      await this.remember(runner, operationId, fingerprint, result);
      return result;
    });
  }

  async revokeRole(employeeId: string, roleName: string, expectedVersion: number, actor: string, operationId: string): Promise<AssignmentMutation> {
    const fingerprint = this.fingerprint({ actor, action: 'revoke-role', employeeId, roleName, expectedVersion });
    return this.transactional(['security:administrators', 'security:employee:' + employeeId], async runner => {
      const replayed = await this.replay<AssignmentMutation>(runner, operationId, fingerprint);
      if (replayed) return { assignment: replayed.assignment, replayed: true };
      const rows = await runner.query(
        `SELECT ${ASSIGNMENT_COLUMNS} FROM employees.security_role_assignments
         WHERE employee_id=$1 AND role_name=$2 AND revoked_at IS NULL`,
        [employeeId, roleName],
      ) as AssignmentRow[];
      if (!rows[0]) {
        const any = await runner.query('SELECT 1 FROM employees.security_role_assignments WHERE employee_id=$1 AND role_name=$2', [employeeId, roleName]) as unknown[];
        throw new SecurityError(any.length ? 409 : 404, any.length ? 'ASSIGNMENT_NOT_ACTIVE' : 'ASSIGNMENT_NOT_FOUND');
      }
      const current = rows[0];
      if (current.version !== expectedVersion) throw new SecurityError(409, 'VERSION_CONFLICT');
      const grantsAdministration = await runner.query(
        "SELECT 1 FROM employees.security_roles WHERE name=$1 AND 'security:write' = ANY(permissions)",
        [roleName],
      ) as unknown[];
      const employeeActive = await runner.query(
        "SELECT 1 FROM employees.employee_records WHERE id=$1 AND record->>'status'='active'",
        [employeeId],
      ) as unknown[];
      if (grantsAdministration.length && employeeActive.length) await this.assertAdministratorsRemain(runner, current.id);
      const version = expectedVersion + 1;
      await runner.query(
        "UPDATE employees.security_role_assignments SET revoked_at=$2, version=$3, sync_status='pending', sync_error_code=NULL WHERE id=$1",
        [current.id, new Date().toISOString(), version],
      );
      const assignment = assignmentView({ ...current, version, sync_status: 'pending', revoked_at: new Date() });
      await this.audit(runner, 'assignment', current.id, roleName, employeeId, 'role-revoked', actor, version, assignment);
      const result: AssignmentMutation = { assignment, replayed: false };
      await this.remember(runner, operationId, fingerprint, result);
      return result;
    });
  }

  async saveAssignmentSync(id: string, status: SyncStatus, errorCode: SyncErrorCode | null): Promise<AssignmentView> {
    return this.transactional([], async runner => {
      const result = await runner.query(
        `UPDATE employees.security_role_assignments SET sync_status=$2, sync_error_code=$3 WHERE id=$1 RETURNING ${ASSIGNMENT_COLUMNS}`,
        [id, status, errorCode],
      );
      const row = returned(result)[0] as AssignmentRow | undefined;
      if (!row) throw new SecurityError(404, 'ASSIGNMENT_NOT_FOUND');
      return assignmentView(row);
    });
  }

  async history(query: SecurityHistoryQuery): Promise<SecurityHistoryPage> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    return this.read(async runner => {
      const filters: string[] = [];
      const values: unknown[] = [];
      if (query.roleName) { values.push(query.roleName); filters.push('role_name=$' + values.length); }
      if (query.employeeId) { values.push(query.employeeId); filters.push('employee_id=$' + values.length); }
      const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
      const total = await runner.query('SELECT count(*)::int AS count FROM employees.security_history' + where, values) as Array<{ count: number }>;
      const rows = await runner.query(
        'SELECT id, entity, entity_id, action, actor_subject, occurred_at, version, snapshot FROM employees.security_history' + where +
        ' ORDER BY occurred_at DESC, id DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2),
        [...values, limit, offset],
      ) as HistoryRow[];
      return { items: rows.map(historyView), total: total[0]?.count ?? 0, limit, offset };
    });
  }

  /** Last-administrator invariant, evaluated inside the caller's transaction and lock. */
  private async assertAdministratorsRemain(runner: QueryRunner, excludingAssignmentId: string | null): Promise<void> {
    const rows = await runner.query(
      `SELECT count(DISTINCT e.id)::int AS count
       FROM employees.security_role_assignments a
       JOIN employees.security_roles r ON r.name = a.role_name
       JOIN employees.employee_records e ON e.id = a.employee_id
       WHERE a.revoked_at IS NULL AND 'security:write' = ANY(r.permissions)
         AND e.record->>'status' = 'active'
         AND ($1::uuid IS NULL OR a.id <> $1)`,
      [excludingAssignmentId],
    ) as Array<{ count: number }>;
    if ((rows[0]?.count ?? 0) === 0) throw new SecurityError(409, 'LAST_ADMINISTRATOR');
  }
}
