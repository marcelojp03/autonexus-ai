CREATE TABLE operations.vehicle_receptions (
    id uuid PRIMARY KEY,
    vehicle_id uuid NOT NULL REFERENCES operations.vehicles (id) ON DELETE RESTRICT,
    customer_id uuid NOT NULL REFERENCES operations.customers (id) ON DELETE RESTRICT,
    appointment_id uuid NULL REFERENCES operations.appointments (id) ON DELETE RESTRICT,
    mileage integer NOT NULL CHECK (mileage >= 0 AND mileage <= 2000000),
    reason text NOT NULL,
    symptoms text NULL,
    visible_conditions text NULL,
    has_order boolean NOT NULL DEFAULT false,
    received_at timestamptz NOT NULL,
    received_by text NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL
);

-- A vehicle can only have one reception without a work order.
CREATE UNIQUE INDEX vehicle_receptions_open ON operations.vehicle_receptions (vehicle_id) WHERE NOT has_order;
CREATE INDEX vehicle_receptions_history ON operations.vehicle_receptions (vehicle_id, received_at);

CREATE TABLE operations.work_orders (
    id uuid PRIMARY KEY,
    number text NOT NULL UNIQUE,
    reception_id uuid NOT NULL UNIQUE REFERENCES operations.vehicle_receptions (id) ON DELETE RESTRICT,
    vehicle_id uuid NOT NULL REFERENCES operations.vehicles (id) ON DELETE RESTRICT,
    customer_id uuid NOT NULL REFERENCES operations.customers (id) ON DELETE RESTRICT,
    description text NOT NULL,
    priority text NOT NULL CHECK (priority IN ('baja', 'normal', 'alta', 'urgente')),
    notes text NULL,
    status text NOT NULL CHECK (status IN ('pending_quote', 'quote_requested', 'quote_approved', 'cancelled')),
    version integer NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL
);

CREATE INDEX work_orders_status ON operations.work_orders (status, created_at);

CREATE TABLE operations.work_order_items (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES operations.work_orders (id) ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES operations.service_catalog (id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
    estimated_minutes integer NOT NULL CHECK (estimated_minutes BETWEEN 15 AND 480),
    reference_rate numeric(10, 2) NOT NULL CHECK (reference_rate >= 0),
    position integer NOT NULL,
    CONSTRAINT work_order_items_unique UNIQUE (order_id, service_id)
);

CREATE TABLE operations.order_numbers (
    year integer PRIMARY KEY,
    value integer NOT NULL CHECK (value >= 0)
);
