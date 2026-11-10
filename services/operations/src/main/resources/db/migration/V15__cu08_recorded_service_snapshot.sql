ALTER TABLE operations.work_order_items
    ADD COLUMN service_name text,
    ADD COLUMN service_category text;

UPDATE operations.work_order_items i
SET service_name = s.name, service_category = s.category
FROM operations.service_catalog s
WHERE s.id = i.service_id;

ALTER TABLE operations.work_order_items
    ALTER COLUMN service_name SET NOT NULL,
    ALTER COLUMN service_category SET NOT NULL;
