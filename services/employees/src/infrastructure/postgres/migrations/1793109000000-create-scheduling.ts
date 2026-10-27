import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScheduling1793109000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE employees.employee_shifts (
      id uuid PRIMARY KEY,
      employee_id uuid NOT NULL REFERENCES employees.employee_records(id) ON DELETE RESTRICT,
      weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
      starts_at time NOT NULL,
      ends_at time NOT NULL,
      break_start time NULL,
      break_end time NULL,
      active boolean NOT NULL DEFAULT true,
      version integer NOT NULL CHECK (version >= 1),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT shift_order CHECK (starts_at < ends_at),
      CONSTRAINT shift_break_order CHECK (break_start IS NULL OR (break_start < break_end AND break_start >= starts_at AND break_end <= ends_at))
    )`);
    await r.query('CREATE INDEX employee_shifts_lookup ON employees.employee_shifts (employee_id, weekday) WHERE active');
    await r.query(`CREATE TABLE employees.employee_absences (
      id uuid PRIMARY KEY,
      employee_id uuid NOT NULL REFERENCES employees.employee_records(id) ON DELETE RESTRICT,
      starts_on date NOT NULL,
      ends_on date NOT NULL,
      reason text NULL,
      active boolean NOT NULL DEFAULT true,
      version integer NOT NULL CHECK (version >= 1),
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT absence_order CHECK (starts_on <= ends_on)
    )`);
    await r.query('CREATE INDEX employee_absences_lookup ON employees.employee_absences (employee_id, starts_on, ends_on) WHERE active');
    await r.query(`CREATE TABLE employees.employee_assignments (
      id uuid PRIMARY KEY,
      employee_id uuid NOT NULL REFERENCES employees.employee_records(id) ON DELETE RESTRICT,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      status text NOT NULL CHECK (status IN ('confirmed')),
      reference text NOT NULL,
      created_at timestamptz NOT NULL,
      CONSTRAINT assignment_order CHECK (starts_at < ends_at)
    )`);
    await r.query('CREATE INDEX employee_assignments_lookup ON employees.employee_assignments (employee_id, starts_at, ends_at)');
    await r.query(`CREATE TABLE employees.staffing_operations (
      operation_id uuid PRIMARY KEY,
      fingerprint text NOT NULL,
      result jsonb NOT NULL
    )`);
    await r.query(`CREATE TABLE employees.staffing_audit (
      id uuid PRIMARY KEY,
      entity text NOT NULL,
      entity_id uuid NOT NULL,
      employee_id uuid NOT NULL,
      action text NOT NULL,
      actor_subject text NOT NULL,
      occurred_at timestamptz NOT NULL,
      version integer NOT NULL,
      snapshot jsonb NOT NULL
    )`);
  }
  async down(): Promise<void> {
    throw new Error('CU04 history is retained; destructive rollback requires an explicit data migration');
  }
}
