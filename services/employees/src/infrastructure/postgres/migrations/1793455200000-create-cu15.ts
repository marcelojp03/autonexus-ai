import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateCu151793455200000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(
      `UPDATE employees.employee_records SET record = record || '{"mechanicEnabled":false}'::jsonb WHERE NOT record ? 'mechanicEnabled'`,
    );
    await r.query(
      `ALTER TABLE employees.employee_records ADD CONSTRAINT mechanic_specialty CHECK (NOT COALESCE((record->>'mechanicEnabled')::boolean,false) OR jsonb_array_length(record->'specialties') > 0)`,
    );
    await r.query(
      `ALTER TABLE employees.employee_assignments DROP CONSTRAINT employee_assignments_status_check, ADD CONSTRAINT employee_assignments_status_check CHECK(status IN ('reserved','confirmed','released')), ADD COLUMN saga_id uuid UNIQUE, ADD COLUMN order_id uuid, ADD COLUMN required_specialty text, ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0), ADD COLUMN order_confirmed_observed boolean NOT NULL DEFAULT false`,
    );
    await r.query(
      `CREATE UNIQUE INDEX cu15_assignment_order ON employees.employee_assignments(order_id) WHERE saga_id IS NOT NULL AND status IN ('reserved','confirmed')`,
    );
    await r.query(
      'CREATE TABLE employees.cu15_tombstones(saga_id uuid PRIMARY KEY, version integer NOT NULL CHECK(version>0))',
    );
    await r.query(
      `CREATE TABLE employees.cu15_operations(operation_id uuid PRIMARY KEY, saga_id uuid NOT NULL, command text NOT NULL, fingerprint text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('applied','rejected')), result jsonb NOT NULL, committed_at timestamptz NOT NULL)`,
    );
    await r.query(
      'CREATE TABLE employees.cu15_audit(id uuid PRIMARY KEY, saga_id uuid NOT NULL, operation_id uuid NOT NULL UNIQUE, actor_subject text NOT NULL, executed_by text NOT NULL, occurred_at timestamptz NOT NULL, snapshot jsonb NOT NULL)',
    );
    await r.query(
      'CREATE TABLE employees.cu15_outbox(id uuid PRIMARY KEY, event_type text NOT NULL, aggregate_type text NOT NULL, aggregate_id uuid NOT NULL, aggregate_version integer NOT NULL, saga_id uuid NOT NULL, causation_id uuid NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_owner text, lease_until timestamptz, published_at timestamptz, last_error_code text)',
    );
    await r.query(
      'CREATE INDEX cu15_outbox_pending ON employees.cu15_outbox(next_attempt_at) WHERE published_at IS NULL',
    );
    await r.query(
      'CREATE TABLE employees.cu15_inbox(event_id uuid PRIMARY KEY, fingerprint text NOT NULL, received_at timestamptz NOT NULL)',
    );
    await r.query(
      'CREATE TABLE employees.cu15_notifications(event_id uuid PRIMARY KEY REFERENCES employees.cu15_inbox(event_id), saga_id uuid NOT NULL, assignment_id uuid NOT NULL REFERENCES employees.employee_assignments(id), employee_id uuid NOT NULL, order_id uuid NOT NULL, created_at timestamptz NOT NULL, payload jsonb NOT NULL)',
    );
    await r.query(
      `WITH changed AS (UPDATE employees.security_roles SET permissions = ARRAY(SELECT unnest(permissions) UNION SELECT unnest(ARRAY['confirmations:read','confirmations:write']::text[])), version=version+1, sync_status='pending', sync_error_code=NULL, updated_at=now() WHERE name IN ('administrador','jefe_taller') AND NOT permissions @> ARRAY['confirmations:read','confirmations:write']::text[] RETURNING *) INSERT INTO employees.security_history(id,entity,entity_id,role_name,employee_id,action,actor_subject,occurred_at,version,snapshot) SELECT gen_random_uuid(),'role',name,name,NULL,'role-updated','migration:cu15',now(),version,jsonb_build_object('name',name,'permissions',permissions,'version',version) FROM changed`,
    );
  }
  async down(): Promise<void> {
    throw new Error('CU15 history requires an explicit retention migration');
  }
}
