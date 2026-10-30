-- CU16 records its separate execution, advance and evidence aggregates in the owner's audit log.
ALTER TABLE operations.operations_history DROP CONSTRAINT operations_history_entity_check;
ALTER TABLE operations.operations_history ADD CONSTRAINT operations_history_entity_check
    CHECK (entity IN ('customer', 'vehicle', 'service', 'appointment', 'reception', 'work-order',
                      'work-execution', 'work-advance', 'work-evidence'));
