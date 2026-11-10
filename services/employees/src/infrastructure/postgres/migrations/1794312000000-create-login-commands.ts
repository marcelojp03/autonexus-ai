import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateLoginCommands1794312000000 implements MigrationInterface {
  name = 'CreateLoginCommands1794312000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE employees.login_commands (
      operation_id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES employees.employee_records(id),
      actor_subject text NOT NULL, username text NOT NULL,
      status text NOT NULL CHECK (status IN ('pending','ready','failed')),
      error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  async down(runner: QueryRunner): Promise<void> { await runner.query('DROP TABLE employees.login_commands'); }
}
