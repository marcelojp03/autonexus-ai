import { EmployeeError } from '../../domain/employee.js';
import { orderConfirmed } from '../../domain/cu15-event.js';
import { PostgresAssignmentRepository } from './postgres-assignment-repository.js';
import { employeeLock } from './cu15-database.js';

export class PostgresCu15Inbox extends PostgresAssignmentRepository {
  async receive(value: unknown): Promise<void> {
    const { event: e, fingerprint } = orderConfirmed(value);
    await this.transaction(async (r) => {
      await r.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'cu15-inbox:' + e.eventId,
      ]);
      const previous = (await r.query(
        'SELECT fingerprint FROM employees.cu15_inbox WHERE event_id=$1',
        [e.eventId],
      )) as Array<{ fingerprint: string }>;
      if (previous[0]) {
        if (previous[0].fingerprint !== fingerprint)
          throw new EmployeeError(409, 'EVENT_ID_CONFLICT');
        return;
      }
      await r.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'cu15-saga:' + e.data.sagaId,
      ]);
      await employeeLock(r, e.data.employeeId);
      const a = await this.current(r, e.data.sagaId);
      if (
        !a ||
        'tombstone' in a ||
        a.status !== 'confirmed' ||
        a.id !== e.data.assignmentId ||
        a.orderId !== e.data.orderId ||
        a.employeeId !== e.data.employeeId ||
        a.startsAt !== e.data.startsAt ||
        a.endsAt !== e.data.endsAt
      )
        throw new EmployeeError(409, 'EVENT_ASSIGNMENT_MISMATCH');
      await r.query(
        'INSERT INTO employees.cu15_inbox(event_id,fingerprint,received_at) VALUES($1,$2,now())',
        [e.eventId, fingerprint],
      );
      await r.query(
        'INSERT INTO employees.cu15_notifications(event_id,saga_id,assignment_id,employee_id,order_id,created_at,payload) VALUES($1,$2,$3,$4,$5,now(),$6::jsonb)',
        [e.eventId, a.sagaId, a.id, a.employeeId, a.orderId, JSON.stringify(e)],
      );
      await r.query(
        'UPDATE employees.employee_assignments SET order_confirmed_observed=true WHERE id=$1',
        [a.id],
      );
    });
  }
}
