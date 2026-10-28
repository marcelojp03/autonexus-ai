CREATE TABLE operations.appointments (
    id uuid PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES operations.customers (id) ON DELETE RESTRICT,
    vehicle_id uuid NOT NULL REFERENCES operations.vehicles (id) ON DELETE RESTRICT,
    service_id uuid NOT NULL REFERENCES operations.service_catalog (id) ON DELETE RESTRICT,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    status text NOT NULL CHECK (status IN ('scheduled', 'cancelled')),
    notes text NULL,
    cancel_reason text NULL,
    version integer NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL,
    CONSTRAINT appointment_order CHECK (starts_at < ends_at),
    CONSTRAINT appointment_cancel_reason CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);

CREATE INDEX appointments_slot ON operations.appointments (starts_at, ends_at) WHERE status = 'scheduled';
CREATE INDEX appointments_vehicle ON operations.appointments (vehicle_id, starts_at);
CREATE UNIQUE INDEX appointments_duplicate
    ON operations.appointments (vehicle_id, service_id, starts_at)
    WHERE status = 'scheduled';
