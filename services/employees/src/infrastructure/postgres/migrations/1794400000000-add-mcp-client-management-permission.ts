import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CU31 administration is granted only to the built-in administrator role. */
export class AddMcpClientManagementPermission1794400000000 implements MigrationInterface {
  name = 'AddMcpClientManagementPermission1794400000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      WITH changed AS (
        UPDATE employees.security_roles
           SET permissions=ARRAY(SELECT unnest(permissions) UNION SELECT 'mcp-clients:manage'::text),
               version=version+1,sync_status='pending',sync_error_code=NULL,updated_at=now()
         WHERE name='administrador' AND NOT ('mcp-clients:manage'=ANY(permissions)) RETURNING *
      )
      INSERT INTO employees.security_history(id,entity,entity_id,role_name,employee_id,action,actor_subject,occurred_at,version,snapshot)
      SELECT gen_random_uuid(),'role',name,name,NULL,'role-updated','migration:cu31',now(),version,
             jsonb_build_object('name',name,'permissions',permissions,'version',version) FROM changed
    `);
  }
  async down(): Promise<void> {
    throw new Error(
      'CU31 permission history requires an explicit retention migration',
    );
  }
}
