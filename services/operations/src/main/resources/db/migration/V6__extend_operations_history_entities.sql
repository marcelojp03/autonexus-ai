-- CU11/CU12 add two audited entities to the shared operations history.
ALTER TABLE operations.operations_history DROP CONSTRAINT operations_history_entity_check;
ALTER TABLE operations.operations_history ADD CONSTRAINT operations_history_entity_check
    CHECK (entity IN ('customer', 'vehicle', 'service', 'appointment', 'reception', 'work-order'));
