import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateEmployeeManagement1793023200000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE employees.employee_records (
      id uuid PRIMARY KEY, record jsonb NOT NULL, subject text UNIQUE,
      CONSTRAINT employee_record_id CHECK (record->>'id'=id::text),
      CONSTRAINT employee_status CHECK (record->>'status' IN ('active','inactive')),
      CONSTRAINT employee_version CHECK ((record->>'version')::integer>=1),
      CONSTRAINT employee_subject CHECK (subject IS NOT DISTINCT FROM record->'access'->>'subject'),
      CONSTRAINT employee_access_status CHECK (record->'access'->>'status' IN ('not_requested','pending','synced','failed','conflict'))
    )`);
    await r.query(
      "CREATE UNIQUE INDEX employee_document_unique ON employees.employee_records ((record->>'document'))",
    );
    await r.query(
      "CREATE UNIQUE INDEX employee_email_unique ON employees.employee_records ((lower(record->>'email')))",
    );
    await r.query(
      `CREATE TABLE employees.employee_operations (operation_id uuid PRIMARY KEY, fingerprint text NOT NULL, result jsonb NOT NULL)`,
    );
    await r.query(
      `CREATE TABLE employees.employee_history (id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES employees.employee_records(id) ON DELETE RESTRICT, version integer NOT NULL, entry jsonb NOT NULL, UNIQUE(employee_id,version))`,
    );
    await r.query(
      `CREATE TABLE employees.identity_intents (employee_id uuid PRIMARY KEY REFERENCES employees.employee_records(id) ON DELETE RESTRICT, version integer NOT NULL, desired jsonb NOT NULL)`,
    );
  }
  async down(): Promise<void> {
    throw new Error(
      'CU03 history is retained; destructive rollback requires an explicit data migration',
    );
  }
}
