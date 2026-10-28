import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CU02 security schema. Prior CU03 audits are append-only; no destructive rollback. */
export class CreateSecurity1793196000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE employees.security_roles (
      name text PRIMARY KEY,
      description text NOT NULL DEFAULT '',
      permissions text[] NOT NULL,
      system boolean NOT NULL DEFAULT false,
      version integer NOT NULL CHECK (version >= 1),
      sync_status text NOT NULL CHECK (sync_status IN ('synced','pending','failed')),
      sync_error_code text NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT security_role_name_format CHECK (name ~ '^[a-z][a-z0-9_]{2,63}$')
    )`);
    await r.query(`CREATE TABLE employees.security_role_assignments (
      id uuid PRIMARY KEY,
      role_name text NOT NULL REFERENCES employees.security_roles(name) ON DELETE RESTRICT,
      employee_id uuid NOT NULL REFERENCES employees.employee_records(id) ON DELETE RESTRICT,
      subject text NOT NULL CHECK (length(subject) > 0),
      version integer NOT NULL CHECK (version >= 1),
      sync_status text NOT NULL CHECK (sync_status IN ('synced','pending','failed')),
      sync_error_code text NULL,
      assigned_at timestamptz NOT NULL,
      assigned_by text NOT NULL,
      revoked_at timestamptz NULL
    )`);
    await r.query('CREATE UNIQUE INDEX security_active_assignment ON employees.security_role_assignments (employee_id, role_name) WHERE revoked_at IS NULL');
    await r.query('CREATE INDEX security_assignment_subject ON employees.security_role_assignments (subject) WHERE revoked_at IS NULL');
    await r.query(`CREATE TABLE employees.security_operations (
      operation_id uuid PRIMARY KEY,
      fingerprint text NOT NULL,
      result jsonb NOT NULL
    )`);
    await r.query(`CREATE TABLE employees.security_history (
      id uuid PRIMARY KEY,
      entity text NOT NULL CHECK (entity IN ('role','assignment')),
      entity_id text NOT NULL,
      role_name text NOT NULL,
      employee_id uuid NULL,
      action text NOT NULL,
      actor_subject text NOT NULL,
      occurred_at timestamptz NOT NULL,
      version integer NOT NULL,
      snapshot jsonb NOT NULL
    )`);
    await r.query('CREATE INDEX security_history_role ON employees.security_history (role_name, occurred_at)');
    await r.query('CREATE INDEX security_history_employee ON employees.security_history (employee_id, occurred_at) WHERE employee_id IS NOT NULL');
    const seeds: Array<[string, string, string[]]> = [
      ['administrador', 'Administración completa de la plataforma', ['employees:read', 'employees:write', 'schedules:read', 'schedules:write', 'security:read', 'security:write']],
      ['jefe_taller', 'Planificación de horarios y disponibilidad', ['schedules:read', 'schedules:write']],
      ['recepcionista', 'Atención al cliente en recepción', []],
      ['mecanico', 'Trabajo técnico en el taller', []],
      ['responsable_financiero', 'Responsabilidad financiera', []],
    ];
    for (const [name, description, permissions] of seeds) {
      await r.query(
        `INSERT INTO employees.security_roles(name, description, permissions, system, version, sync_status, created_at, updated_at)
         VALUES($1,$2,$3,true,1,'synced',now(),now()) ON CONFLICT (name) DO NOTHING`,
        [name, description, permissions],
      );
    }
  }

  async down(): Promise<void> {
    throw new Error('CU02 security history is retained; destructive rollback requires an explicit data migration');
  }
}
