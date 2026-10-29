import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAgendaPermissions1793541600000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    for (const [name, permissions] of [
      ['administrador', ['agenda:read:self', 'agenda:read:team']],
      ['jefe_taller', ['agenda:read:self', 'agenda:read:team']],
      ['mecanico', ['agenda:read:self']],
    ] as const) {
      await r.query(
        `WITH changed AS (
          UPDATE employees.security_roles
          SET permissions=ARRAY(SELECT unnest(permissions) UNION SELECT unnest($2::text[])),
              version=version+1,sync_status='pending',sync_error_code=NULL,updated_at=now()
          WHERE name=$1 AND NOT permissions @> $2::text[] RETURNING *
        ) INSERT INTO employees.security_history(id,entity,entity_id,role_name,employee_id,action,actor_subject,occurred_at,version,snapshot)
          SELECT gen_random_uuid(),'role',name,name,NULL,'role-updated','migration:cu05',now(),version,
            jsonb_build_object('name',name,'permissions',permissions,'version',version) FROM changed`,
        [name, [...permissions]],
      );
    }
  }
  async down(): Promise<void> {
    throw new Error(
      'Agenda permission history requires an explicit retention migration',
    );
  }
}
