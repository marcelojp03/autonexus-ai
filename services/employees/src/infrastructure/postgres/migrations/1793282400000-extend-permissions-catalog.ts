import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Operations block: extends the closed catalog and reseeds the initial roles (CU06/CU07/CU09/CU10). */
export class ExtendPermissionsCatalog1793282400000 implements MigrationInterface {
  private readonly seeds: Array<[string, string[]]> = [
    ['administrador', [
      'employees:read', 'employees:write', 'schedules:read', 'schedules:write', 'security:read', 'security:write',
      'customers:read', 'customers:write', 'vehicles:read', 'vehicles:write',
      'catalog:read', 'catalog:write', 'appointments:read', 'appointments:write',
    ]],
    ['jefe_taller', [
      'schedules:read', 'schedules:write', 'customers:read', 'vehicles:read',
      'catalog:read', 'catalog:write', 'appointments:read', 'appointments:write',
    ]],
    ['recepcionista', [
      'customers:read', 'customers:write', 'vehicles:read', 'vehicles:write',
      'catalog:read', 'appointments:read', 'appointments:write',
    ]],
    ['mecanico', []],
    ['responsable_financiero', []],
  ];

  async up(r: QueryRunner): Promise<void> {
    // Only seeded roles move; custom roles and assignments are untouched.
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
       SELECT gen_random_uuid(), 'role', name, name, NULL, 'role-synced', 'migration:operations-base', now(), version,
              jsonb_build_object('name', name, 'permissions', permissions, 'version', version, 'source', 'operations-base')
         FROM employees.security_roles WHERE system`,
    );
  }

  async down(): Promise<void> {
    throw new Error('Catalog extension is retained; rollback requires an explicit data migration');
  }
}
