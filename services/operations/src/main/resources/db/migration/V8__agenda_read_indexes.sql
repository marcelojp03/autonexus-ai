CREATE INDEX work_orders_agenda_confirmed_time
    ON operations.work_orders (starts_at, id, assignment_id) WHERE status = 'confirmed';
CREATE INDEX work_orders_agenda_confirmed_assignment
    ON operations.work_orders (assignment_id, employee_id) WHERE status = 'confirmed';
