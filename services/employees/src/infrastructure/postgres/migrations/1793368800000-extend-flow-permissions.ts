import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Operations flow: reception, work orders and quotes permissions (CU11-CU14). */
export class ExtendFlowPermissions1793368800000 implements MigrationInterface {
  private readonly seeds: Array<[string, string[]]> = [
    ['administrador', [
      'employees:read', 'employees:write', 'schedules:read', 'schedules:write', 'security:read', 'security:write',
      'customers:read', 'customers:write', 'vehicles:read', 'vehicles:write',
      'catalog:read', 'catalog:write', 'appointments:read', 'appointments:write',
      'receptions:read', 'receptions:write', 'orders:read', 'orders:write',
      'quotes:read', 'quotes:write', 'quotes:decide',
    ]],
    ['jefe_taller', [
      'schedules:read', 'schedules:write', 'customers:read', 'vehicles:read', 'catalog:read', 'catalog:write',
      'appointments:read', 'appointments:write', 'receptions:read', 'orders:read', 'orders:write',
      'quotes:read', 'quotes:decide',
    ]],
    ['recepcionista', [
      'customers:read', 'customers:write', 'vehicles:read', 'vehicles:write', 'catalog:read',
      'appointments:read', 'appointments:write', 'receptions:read', 'receptions:write',
      'orders:read', 'orders:write', 'quotes:read', 'quotes:decide',
    ]],
    ['mecanico', ['receptions:read', 'receptions:write']],
    ['responsable_financiero', ['orders:read', 'quotes:read', 'quotes:write', 'quotes:decide']],
  ];

  async up(r: QueryRunner): Promise<void> {
    for (const [name, permissions] of this.seeds) {
      await r.query(
        `UPDATE employees.security_roles
            SET permissions = $2::text[],
                version = version + 1,
                sync_status = 'pending',
                sync_error_code = NULL,
                updated_at = now()
          WHERE name = $1 AND system AND permissions IS DISTINCT FROM $2::text[]`,
        [name, permissions],
      );
    }
    await r.query(
      `INSERT INTO employees.security_history(id, entity, entity_id, role_name, employee_id, action, actor_subject, occurred_at, version, snapshot)
       SELECT gen_random_uuid(), 'role', name, name, NULL, 'role-synced', 'migration:operations-flow', now(), version,
              jsonb_build_object('name', name, 'permissions', permissions, 'version', version, 'source', 'operations-flow')
         FROM employees.security_roles WHERE system`,
    );
  }

  async down(): Promise<void> {
    throw new Error('Catalog extension is retained; rollback requires an explicit data migration');
  }
}
