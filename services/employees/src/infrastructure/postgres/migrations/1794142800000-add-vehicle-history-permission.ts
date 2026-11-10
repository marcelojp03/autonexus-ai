import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CU08 grants read-only vehicle history independently from general vehicle records. */
export class AddVehicleHistoryPermission1794142800000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    for (const name of [
      'administrador',
      'jefe_taller',
      'recepcionista',
      'mecanico',
    ]) {
      await r.query(
        `WITH changed AS (
          UPDATE employees.security_roles
          SET permissions=ARRAY(SELECT unnest(permissions) UNION SELECT $2::text),
              version=version+1,sync_status='pending',sync_error_code=NULL,updated_at=now()
          WHERE name=$1 AND NOT ($2::text = ANY(permissions)) RETURNING *
        ) INSERT INTO employees.security_history(id,entity,entity_id,role_name,employee_id,action,actor_subject,occurred_at,version,snapshot)
          SELECT gen_random_uuid(),'role',name,name,NULL,'role-updated','migration:cu08',now(),version,
            jsonb_build_object('name',name,'permissions',permissions,'version',version) FROM changed`,
        [name, 'vehicle-history:read'],
      );
    }
  }

  async down(): Promise<void> {
    throw new Error(
      'CU08 permission history requires an explicit retention migration',
    );
  }
}
