-- CU16 execution progress and evidence. The order keeps its CU15 confirmation state; execution
-- is a separate aggregate so there is a single source of truth for each fact.
CREATE TABLE operations.work_executions (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL UNIQUE REFERENCES operations.work_orders (id) ON DELETE RESTRICT,
    assignment_id uuid NOT NULL UNIQUE,
    employee_id uuid NOT NULL,
    status text NOT NULL,
    started_at timestamptz NOT NULL,
    started_by text NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT work_executions_status CHECK (status IN ('in_progress'))
);

CREATE INDEX work_executions_order ON operations.work_executions (order_id, status);

CREATE TABLE operations.work_advances (
    id uuid PRIMARY KEY,
    execution_id uuid NOT NULL REFERENCES operations.work_executions (id) ON DELETE RESTRICT,
    sequence integer NOT NULL CHECK (sequence >= 1),
    description text NOT NULL,
    minutes_worked integer NOT NULL CHECK (minutes_worked BETWEEN 1 AND 1440),
    occurred_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL,
    recorded_by text NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    CONSTRAINT work_advances_sequence UNIQUE (execution_id, sequence)
);

CREATE INDEX work_advances_execution ON operations.work_advances (execution_id, sequence);

CREATE TABLE operations.work_evidence (
    id uuid PRIMARY KEY,
    advance_id uuid NOT NULL REFERENCES operations.work_advances (id) ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES operations.work_orders (id) ON DELETE RESTRICT,
    file_name text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    checksum_sha256 text NOT NULL,
    state text NOT NULL CHECK (state IN ('pending', 'available', 'failed')),
    attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 5),
    object_key text NOT NULL UNIQUE,
    failure_code text,
    etag text,
    version_id text,
    verified_size_bytes bigint,
    verified_content_type text,
    requested_by text NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    confirmed_at timestamptz,
    version integer NOT NULL CHECK (version >= 1),
    CONSTRAINT work_evidence_available CHECK (
        state <> 'available'
        OR (etag IS NOT NULL AND verified_size_bytes IS NOT NULL
            AND verified_content_type IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE INDEX work_evidence_advance ON operations.work_evidence (advance_id, created_at);
CREATE INDEX work_evidence_order ON operations.work_evidence (order_id, state);
