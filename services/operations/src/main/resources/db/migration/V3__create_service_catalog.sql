CREATE TABLE operations.service_catalog (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    name_key text NOT NULL UNIQUE,
    description text NOT NULL,
    category text NOT NULL CHECK (category IN ('mantenimiento', 'reparacion', 'diagnostico', 'otros')),
    estimated_minutes integer NOT NULL CHECK (estimated_minutes BETWEEN 15 AND 480),
    reference_rate numeric(10, 2) NOT NULL CHECK (reference_rate >= 0),
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL CHECK (version >= 1),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    created_by text NOT NULL,
    updated_by text NOT NULL
);

CREATE INDEX service_catalog_active ON operations.service_catalog (category) WHERE active;
