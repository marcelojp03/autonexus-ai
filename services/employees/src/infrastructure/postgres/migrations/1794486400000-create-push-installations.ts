import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePushInstallations1794486400000 implements MigrationInterface {
  name = 'CreatePushInstallations1794486400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE employees.push_installations (
        fid text PRIMARY KEY,
        employee_id uuid NOT NULL REFERENCES employees.employee_records(id),
        subject text NOT NULL,
        app_id text NOT NULL,
        platform text NOT NULL CHECK (platform IN ('android')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','inactive'))
      )
    `);
    await queryRunner.query('CREATE INDEX push_installations_employee_active ON employees.push_installations(employee_id) WHERE state=\'active\'');
    await queryRunner.query(`ALTER TABLE employees.cu15_notifications
      ADD COLUMN push_state text NOT NULL DEFAULT 'pending' CHECK (push_state IN ('pending','sending','sent','disabled')),
      ADD COLUMN push_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN push_next_attempt_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN push_lease_until timestamptz,
      ADD COLUMN push_lease_id uuid,
      ADD COLUMN push_sent_at timestamptz`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE employees.cu15_notifications DROP COLUMN push_sent_at, DROP COLUMN push_lease_id, DROP COLUMN push_lease_until, DROP COLUMN push_next_attempt_at, DROP COLUMN push_attempts, DROP COLUMN push_state');
    await queryRunner.query('DROP TABLE employees.push_installations');
  }
}
