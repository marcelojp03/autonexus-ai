export const project = 'autonexus-messaging-dev';
export const container = 'autonexus-messaging-dev-rabbitmq';
export const version = '4.2.9';
export const vhost = 'autonexus';
export const exchange = 'autonexus.business.v1';
export const deadExchange = 'autonexus.dlx.v1';
export const events = {
  operations: ['operations.cu15.confirmation.updated.v1', 'operations.cu15.confirmation.rejected.v1', 'operations.order.confirmed.v1'],
  employees: ['employees.cu15.assignment.reserved.v1', 'employees.cu15.assignment.confirmed.v1', 'employees.cu15.assignment.released.v1', 'employees.cu15.command.rejected.v1'],
  finance: ['finance.cu15.quote_link.authorized.v1', 'finance.cu15.quote_link.cancelled.v1', 'finance.cu15.command.rejected.v1'],
};
export const queues = [
  { name: 'cu15.operations.events.v1', bindings: ['employees.cu15.#', 'finance.cu15.#', 'operations.cu15.#'], owner: 'operations', deadKey: 'cu15.operations.dead' },
  { name: 'cu15.employees.order-confirmed.v1', bindings: ['operations.order.confirmed.v1'], owner: 'employees', deadKey: 'cu15.employees.dead' },
];
export function permissions(owner) {
  if (!Object.hasOwn(events, owner)) throw new Error('Unknown messaging owner');
  const read = owner === 'operations' ? '^cu15[.]operations[.](events|dlq)[.]v1$' : owner === 'employees' ? '^cu15[.]employees[.](order-confirmed|dlq)[.]v1$' : '^$';
  return { configure: '^$', write: '^autonexus[.]business[.]v1$', read };
}
export function topicPermissions(owner) {
  if (!Object.hasOwn(events, owner)) throw new Error('Unknown messaging owner');
  const read = owner === 'employees' ? '^operations[.]order[.]confirmed[.]v1$' : owner === 'operations' ? '^(employees[.]cu15[.]#|finance[.]cu15[.]#|operations[.]cu15[.]#)$' : '^$';
  return { exchange, write: '^(?:' + events[owner].map(key => key.replaceAll('.', '[.]')).join('|') + ')$', read };
}
export function queueArguments(queue) {
  return { 'x-dead-letter-exchange': deadExchange, 'x-dead-letter-routing-key': queue.deadKey };
}
