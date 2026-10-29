import type { AgendaRepository } from '../../application/agenda-repository.js';
import type {
  AgendaActor,
  AgendaScope,
  AssignmentCheck,
} from '../../domain/agenda.js';
import type { PageQuery } from '../../domain/employee.js';
import { Cu15Database } from './cu15-database.js';

export class PostgresAgendaRepository
  extends Cu15Database
  implements AgendaRepository
{
  async actor(
    subject: string,
    roles: readonly string[],
  ): Promise<AgendaActor | null> {
    return this.transaction(async (r) => {
      const rows = (await r.query(
        `SELECT e.id, concat_ws(' ',e.record->>'firstName',e.record->>'lastName') AS full_name,
                array_agg(DISTINCT p.permission) AS permissions
         FROM employees.employee_records e
         JOIN employees.security_role_assignments a ON a.employee_id=e.id AND a.subject=$1 AND a.revoked_at IS NULL
         JOIN employees.security_roles s ON s.name=a.role_name AND s.name=ANY($2::text[])
         CROSS JOIN LATERAL unnest(s.permissions) AS p(permission)
         WHERE e.subject=$1 AND e.record->'access'->>'subject'=$1
           AND e.record->>'status'='active'
           AND p.permission IN ('agenda:read:self','agenda:read:team')
         GROUP BY e.id,e.record->>'firstName',e.record->>'lastName'`,
        [subject, [...roles]],
      )) as Array<{ id: string; full_name: string; permissions: string[] }>;
      const row = rows[0];
      if (!row) return null;
      const scopes: AgendaScope[] = (['self', 'team'] as const).filter(
        (scope) => row.permissions.includes('agenda:read:' + scope),
      );
      return {
        employeeId: row.id,
        fullName: row.full_name,
        status: 'active',
        scopes,
      };
    });
  }

  async employees(page: PageQuery) {
    return this.transaction(async (r) => {
      const values = [page.status ?? null, page.search ?? null];
      const where = `FROM employees.employee_records e
        WHERE ($1::text IS NULL OR e.record->>'status'=$1)
          AND ($2::text IS NULL OR strpos(lower(concat_ws(' ',e.record->>'firstName',e.record->>'lastName')),lower($2))>0)`;
      const totals = (await r.query(
        'SELECT count(*)::int AS total ' + where,
        values,
      )) as Array<{ total: number }>;
      const items = await r.query(
        `SELECT e.id, concat_ws(' ',e.record->>'firstName',e.record->>'lastName') AS "fullName", e.record->>'status' AS status ` +
          where +
          ' ORDER BY "fullName",e.id LIMIT $3 OFFSET $4',
        [...values, page.limit, page.offset],
      );
      return {
        items,
        total: totals[0].total,
        limit: page.limit,
        offset: page.offset,
      };
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
