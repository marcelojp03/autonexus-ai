import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CU23 adds the Intelligence permissions. Additive and idempotent: only roles that may already
 * work with evidence receive them, `recepcionista` and `responsable_financiero` never do, and a
 * role that already carries a permission is left untouched (no version bump, no fake history).
 */
export class AddIntelligencePermissions1793800800000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    for (const [name, permissions] of [
      ['administrador', ['intelligence:analyze', 'intelligence:read']],
      ['jefe_taller', ['intelligence:read']],
      ['mecanico', ['intelligence:analyze', 'intelligence:read']],
    ] as const) {
      await r.query(
        `WITH changed AS (
          UPDATE employees.security_roles
          SET permissions=ARRAY(SELECT unnest(permissions) UNION SELECT unnest($2::text[])),
              version=version+1,sync_status='pending',sync_error_code=NULL,updated_at=now()
          WHERE name=$1 AND NOT permissions @> $2::text[] RETURNING *
        ) INSERT INTO employees.security_history(id,entity,entity_id,role_name,employee_id,action,actor_subject,occurred_at,version,snapshot)
          SELECT gen_random_uuid(),'role',name,name,NULL,'role-updated','migration:cu23',now(),version,
            jsonb_build_object('name',name,'permissions',permissions,'version',version) FROM changed`,
        [name, [...permissions]],
      );
    }
  }

  async down(): Promise<void> {
    throw new Error('Intelligence permission history requires an explicit retention migration');
  }
}
