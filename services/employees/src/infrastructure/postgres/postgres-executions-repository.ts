import type { AssignmentCheck } from '../../domain/agenda.js';
import type {
  ExecutionActor,
  ExecutionScope,
} from '../../domain/executions.js';
import { EXECUTION_PERMISSION } from '../../domain/executions.js';
import type { ExecutionsRepository } from '../../application/executions-repository.js';
import { Cu15Database } from './cu15-database.js';

/**
 * CU16 reads only. The permission of the requested scope is matched inside the same query that
 * proves the link and the activity, so an unlinked subject never receives an actor.
 */
export class PostgresExecutionsRepository
  extends Cu15Database
  implements ExecutionsRepository
{
  async actor(
    subject: string,
    roles: readonly string[],
    scope: ExecutionScope,
  ): Promise<ExecutionActor | null> {
    return this.transaction(async (r) => {
      const rows = (await r.query(
        `SELECT e.id, concat_ws(' ',e.record->>'firstName',e.record->>'lastName') AS full_name
         FROM employees.employee_records e
         JOIN employees.security_role_assignments a ON a.employee_id=e.id AND a.subject=$1 AND a.revoked_at IS NULL
         JOIN employees.security_roles s ON s.name=a.role_name AND s.name=ANY($2::text[])
         WHERE e.subject=$1 AND e.record->'access'->>'subject'=$1
           AND e.record->>'status'='active'
           AND $3 = ANY(s.permissions)
         GROUP BY e.id,e.record->>'firstName',e.record->>'lastName'`,
        [subject, [...roles], EXECUTION_PERMISSION[scope]],
      )) as Array<{ id: string; full_name: string }>;
      const row = rows[0];
      if (!row) return null;
      return { employeeId: row.id, fullName: row.full_name, status: 'active' };
    });
  }

  async assignments(
    ids: readonly string[],
    employeeId: string | null,
  ): Promise<AssignmentCheck[]> {
    return this.transaction(async (r) => {
      const rows = (await r.query(
        `SELECT a.id AS "assignmentId",a.saga_id AS "sagaId",a.order_id AS "orderId",a.employee_id AS "employeeId",
           concat_ws(' ',e.record->>'firstName',e.record->>'lastName') AS "fullName",e.record->>'status' AS "employeeStatus",
           a.starts_at,a.ends_at,a.status,a.version,a.order_confirmed_observed AS "orderConfirmedObserved"
         FROM employees.employee_assignments a JOIN employees.employee_records e ON e.id=a.employee_id
         WHERE a.id=ANY($1::uuid[]) AND a.saga_id IS NOT NULL AND a.order_id IS NOT NULL
           AND ($2::uuid IS NULL OR a.employee_id=$2)
         ORDER BY array_position($1::uuid[],a.id)`,
        [[...ids], employeeId],
      )) as Array<
        Omit<AssignmentCheck, 'startsAt' | 'endsAt'> & {
          starts_at: Date;
          ends_at: Date;
        }
      >;
      return rows.map(({ starts_at, ends_at, ...row }) => ({
        ...row,
        startsAt: starts_at.toISOString(),
        endsAt: ends_at.toISOString(),
      }));
    });
  }
}
