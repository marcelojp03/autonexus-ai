-- CU17 technical verification. The order keeps its CU15 confirmation while the work runs and is
-- reviewed; it becomes completed only when the workshop head approves. Delivery and payment are
-- separate facts and are not derived from this state.
ALTER TABLE operations.work_orders DROP CONSTRAINT work_orders_status_check;
ALTER TABLE operations.work_orders ADD CONSTRAINT work_orders_status_check
    CHECK (status IN ('pending_quote','quote_requested','quote_approved','cancelled',
                      'confirmation_pending','confirmed','completed'));

-- A completed order still carries the CU15 confirmation references.
ALTER TABLE operations.work_orders DROP CONSTRAINT work_orders_confirmed_references;
ALTER TABLE operations.work_orders ADD CONSTRAINT work_orders_confirmed_references CHECK
 (status NOT IN ('confirmed','completed') OR
  (confirmation_saga_id IS NOT NULL AND quote_id IS NOT NULL AND quote_version IS NOT NULL
   AND quote_version > 0 AND quote_link_id IS NOT NULL AND assignment_id IS NOT NULL
   AND employee_id IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL
   AND starts_at < ends_at));

ALTER TABLE operations.work_executions DROP CONSTRAINT work_executions_status;
ALTER TABLE operations.work_executions ADD CONSTRAINT work_executions_status
    CHECK (status IN ('in_progress','pending_verification','completed'));

ALTER TABLE operations.work_executions
    ADD COLUMN review_requested_at timestamptz,
    ADD COLUMN review_requested_by text,
    ADD COLUMN verified_at timestamptz,
    ADD COLUMN verified_by text,
    ADD COLUMN returned_at timestamptz,
    ADD COLUMN return_reason text,
    ADD CONSTRAINT work_executions_review_trace CHECK (
        status <> 'pending_verification'
        OR (review_requested_at IS NOT NULL AND review_requested_by IS NOT NULL)),
    ADD CONSTRAINT work_executions_completed_trace CHECK (
        status <> 'completed' OR (verified_at IS NOT NULL AND verified_by IS NOT NULL));

-- Mandatory activities derived from the order items already copied to the order. A textual
-- advance or a percentage never marks an item as done; only explicit, traced confirmation does.
CREATE TABLE operations.work_execution_checklist (
    id uuid PRIMARY KEY,
    execution_id uuid NOT NULL REFERENCES operations.work_executions (id) ON DELETE RESTRICT,
    order_item_id uuid NOT NULL,
    position integer NOT NULL CHECK (position >= 1),
    description text NOT NULL,
    quantity integer NOT NULL CHECK (quantity >= 1),
    state text NOT NULL CHECK (state IN ('pending', 'done')),
    done_at timestamptz,
    done_by text,
    version integer NOT NULL CHECK (version >= 1),
    CONSTRAINT work_execution_checklist_item UNIQUE (execution_id, order_item_id),
    CONSTRAINT work_execution_checklist_done CHECK (
        state <> 'done' OR (done_at IS NOT NULL AND done_by IS NOT NULL))
);

CREATE INDEX work_execution_checklist_order ON operations.work_execution_checklist (execution_id, position);

-- Append-only review trail: request, approval and return keep actor, reason and version.
CREATE TABLE operations.work_execution_reviews (
    id uuid PRIMARY KEY,
    execution_id uuid NOT NULL REFERENCES operations.work_executions (id) ON DELETE RESTRICT,
    order_id uuid NOT NULL,
    action text NOT NULL CHECK (action IN ('requested', 'approved', 'returned')),
    actor text NOT NULL,
    reason text,
    execution_version integer NOT NULL CHECK (execution_version >= 1),
    occurred_at timestamptz NOT NULL,
    CONSTRAINT work_execution_reviews_reason CHECK (
        action <> 'returned' OR (reason IS NOT NULL AND length(btrim(reason)) BETWEEN 3 AND 500))
);

CREATE INDEX work_execution_reviews_order ON operations.work_execution_reviews (order_id, occurred_at);

ALTER TABLE operations.operations_history DROP CONSTRAINT operations_history_entity_check;
ALTER TABLE operations.operations_history ADD CONSTRAINT operations_history_entity_check
    CHECK (entity IN ('customer', 'vehicle', 'service', 'appointment', 'reception', 'work-order',
                      'work-execution', 'work-advance', 'work-evidence', 'work-execution-review'));
