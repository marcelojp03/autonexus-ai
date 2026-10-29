import { digest, instant } from './assignment.js';
import { invalid, object, only, uuid } from './employee.js';
export interface OrderConfirmed {
  eventId: string;
  schemaVersion: 1;
  eventType: 'operations.order.confirmed.v1';
  producer: 'operations';
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  causationId: string;
  occurredAt: string;
  initiatedBy: string;
  executedBy: string;
  data: {
    sagaId: string;
    orderId: string;
    assignmentId: string;
    employeeId: string;
    startsAt: string;
    endsAt: string;
    quoteId: string;
    quoteVersion: number;
    quoteLinkId: string;
  };
}
export function orderConfirmed(value: unknown): {
  event: OrderConfirmed;
  fingerprint: string;
} {
  const v = object(value);
  only(v, [
    'eventId',
    'schemaVersion',
    'eventType',
    'producer',
    'aggregateType',
    'aggregateId',
    'aggregateVersion',
    'correlationId',
    'causationId',
    'occurredAt',
    'initiatedBy',
    'executedBy',
    'data',
  ]);
  if (
    v.schemaVersion !== 1 ||
    v.eventType !== 'operations.order.confirmed.v1' ||
    v.producer !== 'operations' ||
    v.aggregateType !== 'order' ||
    !Number.isSafeInteger(v.aggregateVersion) ||
    Number(v.aggregateVersion) < 1
  )
    invalid();
  for (const k of ['eventId', 'aggregateId', 'correlationId', 'causationId'])
    uuid(v[k]);
  instant(v.occurredAt);
  for (const k of ['initiatedBy', 'executedBy'])
    if (
      typeof v[k] !== 'string' ||
      !(v[k] as string).trim() ||
      (v[k] as string).length > 200 ||
      /[\x00-\x1f\x7f]/.test(v[k] as string)
    )
      invalid();
  const d = object(v.data);
  only(d, [
    'sagaId',
    'orderId',
    'assignmentId',
    'employeeId',
    'startsAt',
    'endsAt',
    'quoteId',
    'quoteVersion',
    'quoteLinkId',
  ]);
  for (const k of [
    'sagaId',
    'orderId',
    'assignmentId',
    'employeeId',
    'quoteId',
    'quoteLinkId',
  ])
    uuid(d[k]);
  if (
    !Number.isSafeInteger(d.quoteVersion) ||
    Number(d.quoteVersion) < 1 ||
    instant(d.startsAt) >= instant(d.endsAt) ||
    uuid(v.correlationId) !== uuid(d.sagaId) ||
    uuid(v.aggregateId) !== uuid(d.orderId)
  )
    invalid();
  const event = {
    ...v,
    eventId: uuid(v.eventId),
    correlationId: uuid(v.correlationId),
    aggregateId: uuid(v.aggregateId),
    data: {
      ...d,
      sagaId: uuid(d.sagaId),
      orderId: uuid(d.orderId),
      assignmentId: uuid(d.assignmentId),
      employeeId: uuid(d.employeeId),
      startsAt: instant(d.startsAt),
      endsAt: instant(d.endsAt),
    },
  } as OrderConfirmed;
  return { event, fingerprint: digest(v) };
}
