import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { PostgresCu15Inbox } from './postgres-cu15-inbox.js';
import { orderConfirmed } from '../../domain/cu15-event.js';
import { type Assignment } from '../../domain/assignment.js';
const id = '11111111-1111-4111-8111-111111111111';
const assignment: Assignment = {
  id,
  sagaId: id,
  orderId: id,
  employeeId: id,
  requiredSpecialty: 'Motor',
  startsAt: '2099-10-28T13:00:00.000Z',
  endsAt: '2099-10-28T14:00:00.000Z',
  status: 'confirmed',
  version: 2,
  orderConfirmedObserved: false,
};
const event = () => ({
  eventId: randomUUID(),
  schemaVersion: 1,
  eventType: 'operations.order.confirmed.v1',
  producer: 'operations',
  aggregateType: 'order',
  aggregateId: id,
  aggregateVersion: 3,
  correlationId: id,
  causationId: id,
  occurredAt: '2026-10-28T12:00:00.000Z',
  initiatedBy: 'human',
  executedBy: 'autonexus-cu15-coordinator',
  data: {
    sagaId: id,
    orderId: id,
    assignmentId: id,
    employeeId: id,
    startsAt: assignment.startsAt,
    endsAt: assignment.endsAt,
    quoteId: id,
    quoteVersion: 1,
    quoteLinkId: id,
  },
});
describe('CU15 order-confirmed Inbox (runner fake, not broker/SQL integration)', () => {
  it('validates closed schema, producer, references and type', () => {
    const e = event();
    expect(orderConfirmed(e).event.eventId).toBe(e.eventId);
    for (const value of [
      { ...e, producer: 'finance' },
      { ...e, eventType: 'untrusted' },
      { ...e, instructions: 'ignored' },
      { ...e, data: { ...e.data, orderId: randomUUID() } },
      { ...e, aggregateVersion: 0 },
    ])
      expect(() => orderConfirmed(value)).toThrow('VALIDATION_ERROR');
  });
  function fixture() {
    const fingerprints = new Map<string, string>();
    const query = vi.fn(async (sql: string, p: unknown[] = []) => {
      if (sql.startsWith('SELECT fingerprint'))
        return fingerprints.has(p[0] as string)
          ? [{ fingerprint: fingerprints.get(p[0] as string) }]
          : [];
      if (sql.startsWith('INSERT INTO employees.cu15_inbox'))
        fingerprints.set(p[0] as string, p[1] as string);
      return [];
    });
    const inbox = new PostgresCu15Inbox();
    vi.spyOn(inbox, 'transaction').mockImplementation(async (work) =>
      work({ query } as unknown as QueryRunner),
    );
    vi.spyOn(inbox, 'current').mockResolvedValue(assignment);
    return { inbox, query };
  }
  it('deduplicates and commits Inbox, notification and closure without another assignment', async () => {
    const { inbox, query } = fixture();
    const e = event();
    await inbox.receive(e);
    await inbox.receive(e);
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(
      statements.filter((sql) =>
        sql.startsWith('INSERT INTO employees.cu15_notifications'),
      ),
    ).toHaveLength(1);
    expect(
      statements.filter((sql) =>
        sql.startsWith(
          'UPDATE employees.employee_assignments SET order_confirmed_observed=true',
        ),
      ),
    ).toHaveLength(1);
    expect(
      statements.some((sql) =>
        sql.startsWith('INSERT INTO employees.employee_assignments'),
      ),
    ).toBe(false);
    await expect(
      inbox.receive({ ...e, data: { ...e.data, quoteVersion: 2 } }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
  });
  it('quarantines an event whose assignment references do not match', async () => {
    const { inbox, query } = fixture();
    const e = event();
    await expect(
      inbox.receive({ ...e, data: { ...e.data, assignmentId: randomUUID() } }),
    ).rejects.toMatchObject({ code: 'EVENT_ASSIGNMENT_MISMATCH' });
    expect(
      query.mock.calls.some(([sql]) =>
        sql.startsWith('INSERT INTO employees.cu15_inbox'),
      ),
    ).toBe(false);
  });
});
