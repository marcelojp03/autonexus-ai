-- CU28 event flow. The CU17 review request records operations.execution.review.requested.v1 in this
-- owner's Outbox inside the same transaction that moves the execution to pending_verification, so a
-- rollback of the business change also removes the intent to publish. Nothing leaves the process
-- from the HTTP transaction: a separate publisher claims due rows, delivers them and only then marks
-- them delivered. CU15 keeps its own outbox and semantics untouched.
CREATE TABLE operations.cu28_outbox (
    event_id uuid PRIMARY KEY,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_version integer NOT NULL,
    correlation_id uuid NOT NULL,
    causation_id uuid NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL,
    lease_owner uuid,
    lease_until timestamptz,
    delivered_at timestamptz,
    abandoned_at timestamptz,
    last_error_code text,
    CONSTRAINT cu28_outbox_event_type CHECK (event_type IN ('operations.execution.review.requested.v1')),
    CONSTRAINT cu28_outbox_attempts CHECK (attempts >= 0),
    CONSTRAINT cu28_outbox_aggregate_version CHECK (aggregate_version >= 1),
    CONSTRAINT cu28_outbox_lease CHECK (
        (lease_owner IS NULL AND lease_until IS NULL) OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL)),
    CONSTRAINT cu28_outbox_outcome CHECK (NOT (delivered_at IS NOT NULL AND abandoned_at IS NOT NULL))
);

-- Pending rows are the only ones the publisher scans; delivered and abandoned rows stay as history.
CREATE INDEX cu28_outbox_due ON operations.cu28_outbox (next_attempt_at)
    WHERE delivered_at IS NULL AND abandoned_at IS NULL;

CREATE INDEX cu28_outbox_aggregate ON operations.cu28_outbox (aggregate_id, aggregate_version);
