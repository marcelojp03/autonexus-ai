ALTER TABLE operations.work_orders DROP CONSTRAINT work_orders_status_check;
ALTER TABLE operations.work_orders ADD CONSTRAINT work_orders_status_check CHECK
 (status IN ('pending_quote','quote_requested','quote_approved','cancelled','confirmation_pending','confirmed'));
ALTER TABLE operations.work_orders
 ADD COLUMN confirmation_saga_id uuid, ADD COLUMN quote_id uuid, ADD COLUMN quote_version integer,
 ADD COLUMN quote_link_id uuid, ADD COLUMN assignment_id uuid, ADD COLUMN employee_id uuid,
 ADD COLUMN starts_at timestamptz, ADD COLUMN ends_at timestamptz;
ALTER TABLE operations.work_orders ADD CONSTRAINT work_orders_confirmed_references CHECK
 (status <> 'confirmed' OR (confirmation_saga_id IS NOT NULL AND quote_id IS NOT NULL AND quote_version IS NOT NULL AND quote_version > 0
  AND quote_link_id IS NOT NULL AND assignment_id IS NOT NULL AND employee_id IS NOT NULL
  AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_at < ends_at));
CREATE TABLE operations.cu15_sagas (
 id uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES operations.work_orders(id),
 status text NOT NULL CHECK(status IN ('running','recovery_pending','compensating','compensation_pending','confirmed','rejected')),
 phase text NOT NULL, version bigint NOT NULL, document jsonb NOT NULL,
 next_attempt_at timestamptz NOT NULL, lease_owner uuid, lease_until timestamptz, fence bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX cu15_one_active_order ON operations.cu15_sagas(order_id) WHERE status NOT IN ('confirmed','rejected');
CREATE INDEX cu15_sagas_due ON operations.cu15_sagas(next_attempt_at) WHERE status NOT IN ('confirmed','rejected');
ALTER TABLE operations.work_orders ADD CONSTRAINT work_orders_confirmation_saga_fk FOREIGN KEY(confirmation_saga_id) REFERENCES operations.cu15_sagas(id);
CREATE TABLE operations.cu15_steps (
 operation_id uuid PRIMARY KEY, saga_id uuid NOT NULL REFERENCES operations.cu15_sagas(id), command text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('forward','compensation')),
 status text NOT NULL CHECK(status IN ('pending','dispatched','applied','rejected','uncertain')),
 body jsonb, fingerprint text, attempts integer NOT NULL DEFAULT 0, result jsonb,
 next_attempt_at timestamptz NOT NULL, last_error_code text
);
CREATE TABLE operations.cu15_ledger (
 operation_id uuid PRIMARY KEY, saga_id uuid NOT NULL REFERENCES operations.cu15_sagas(id),
 command text NOT NULL, fingerprint text NOT NULL, actor text NOT NULL, committed_at timestamptz NOT NULL
);
CREATE TABLE operations.cu15_history (
 id uuid PRIMARY KEY, saga_id uuid NOT NULL REFERENCES operations.cu15_sagas(id), version bigint NOT NULL,
 action text NOT NULL, actor text NOT NULL, occurred_at timestamptz NOT NULL, snapshot jsonb NOT NULL
);
CREATE TABLE operations.cu15_outbox (
 id uuid PRIMARY KEY, event_type text NOT NULL, aggregate_type text NOT NULL, aggregate_id uuid NOT NULL,
 aggregate_version bigint NOT NULL, saga_id uuid NOT NULL, causation_id uuid NOT NULL, payload jsonb NOT NULL,
 occurred_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL,
 lease_owner uuid, lease_until timestamptz, published_at timestamptz, last_error_code text
);
CREATE INDEX cu15_outbox_due ON operations.cu15_outbox(next_attempt_at) WHERE published_at IS NULL;
CREATE TABLE operations.cu15_inbox (event_id uuid PRIMARY KEY, fingerprint text NOT NULL, received_at timestamptz NOT NULL);
