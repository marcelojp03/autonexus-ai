CREATE TABLE operations.customers (
    id uuid PRIMARY KEY,
    first_name text NOT NULL,
    last_name text NOT NULL,
    document text NOT NULL UNIQUE,
    phone text NOT NULL,
    email text NULL,
    address text NULL,
    status text NOT NULL CHECK (status IN ('active', 'inactive')),
    version integer NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL
);

CREATE INDEX customers_search ON operations.customers (lower(last_name), lower(first_name));

CREATE TABLE operations.vehicles (
    id uuid PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES operations.customers (id) ON DELETE RESTRICT,
    plate text NOT NULL UNIQUE,
    make text NOT NULL,
    model text NOT NULL,
    year integer NOT NULL CHECK (year BETWEEN 1950 AND 2100),
    fuel_type text NOT NULL CHECK (fuel_type IN ('gasolina', 'diesel', 'gas', 'electrico', 'hibrido')),
    color text NULL,
    status text NOT NULL CHECK (status IN ('active', 'inactive')),
    version integer NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL
);

CREATE INDEX vehicles_customer ON operations.vehicles (customer_id);

CREATE TABLE operations.vehicle_owners (
    id uuid PRIMARY KEY,
    vehicle_id uuid NOT NULL REFERENCES operations.vehicles (id) ON DELETE RESTRICT,
    customer_id uuid NOT NULL REFERENCES operations.customers (id) ON DELETE RESTRICT,
    from_at timestamptz NOT NULL,
    to_at timestamptz NULL,
    changed_by text NOT NULL
);

CREATE UNIQUE INDEX vehicle_owners_current ON operations.vehicle_owners (vehicle_id) WHERE to_at IS NULL;

CREATE TABLE operations.operations_operations (
    operation_id uuid PRIMARY KEY,
    fingerprint text NOT NULL,
    result jsonb NOT NULL
);

CREATE TABLE operations.operations_history (
    id uuid PRIMARY KEY,
    entity text NOT NULL CHECK (entity IN ('customer', 'vehicle', 'service', 'appointment')),
    entity_id uuid NOT NULL,
    action text NOT NULL,
    actor_subject text NOT NULL,
    occurred_at timestamptz NOT NULL,
    version integer NOT NULL,
    snapshot jsonb NOT NULL
);

CREATE INDEX operations_history_entity ON operations.operations_history (entity, entity_id, occurred_at);
