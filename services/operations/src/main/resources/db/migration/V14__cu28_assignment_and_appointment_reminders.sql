ALTER TABLE operations.cu28_outbox DROP CONSTRAINT cu28_outbox_event_type;
ALTER TABLE operations.cu28_outbox ADD CONSTRAINT cu28_outbox_event_type CHECK (event_type IN (
    'operations.execution.review.requested.v1', 'operations.order.finalized.v1',
    'operations.assignment.confirmed.v1', 'operations.appointment.reminder.due.v1'));

ALTER TABLE operations.cu28_outbox ADD COLUMN suppressed_at timestamptz;
ALTER TABLE operations.cu28_outbox ADD CONSTRAINT cu28_outbox_suppressed
    CHECK (suppressed_at IS NULL OR (delivered_at IS NULL AND abandoned_at IS NULL));
