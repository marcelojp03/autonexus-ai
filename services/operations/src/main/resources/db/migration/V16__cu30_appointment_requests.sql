CREATE TABLE operations.appointment_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id uuid NOT NULL UNIQUE,
    payload_hash char(64) NOT NULL,
    client_id varchar(200) NOT NULL,
    requester_subject varchar(128) NOT NULL,
    customer_id uuid NOT NULL REFERENCES operations.customers(id),
    vehicle_id uuid NOT NULL REFERENCES operations.vehicles(id),
    service_id uuid NOT NULL REFERENCES operations.service_catalog(id),
    requested_starts_at timestamptz NOT NULL,
    time_zone varchar(64) NOT NULL,
    notes varchar(500),
    status varchar(20) NOT NULL CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    reviewer_subject varchar(128),
    review_reason varchar(300),
    appointment_id uuid REFERENCES operations.appointments(id),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    CHECK ((status = 'PENDING_REVIEW' AND reviewed_at IS NULL AND reviewer_subject IS NULL AND appointment_id IS NULL)
        OR (status = 'APPROVED' AND reviewed_at IS NOT NULL AND reviewer_subject IS NOT NULL AND appointment_id IS NOT NULL)
        OR (status = 'REJECTED' AND reviewed_at IS NOT NULL AND reviewer_subject IS NOT NULL AND review_reason IS NOT NULL AND appointment_id IS NULL))
);

CREATE INDEX appointment_requests_pending_created_idx
    ON operations.appointment_requests (created_at, id) WHERE status = 'PENDING_REVIEW';
