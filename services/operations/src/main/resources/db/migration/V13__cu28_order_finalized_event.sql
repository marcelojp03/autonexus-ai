-- CU28 automation catalogue. The Outbox already carries one closed type; V13 admits the second flow of
-- the catalogue verified end to end — "orden finalizada", produced when CU17 approves the verification
-- and the order becomes technically completed. The list stays an allowlist: an unknown type is still
-- rejected by the constraint instead of being published by accident.
ALTER TABLE operations.cu28_outbox
    DROP CONSTRAINT cu28_outbox_event_type;

ALTER TABLE operations.cu28_outbox
    ADD CONSTRAINT cu28_outbox_event_type CHECK (event_type IN (
        'operations.execution.review.requested.v1',
        'operations.order.finalized.v1'));
