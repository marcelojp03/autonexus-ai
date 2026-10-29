import assert from 'node:assert/strict';
import test from 'node:test';
import { events, queues, exchange, deadExchange, permissions, topicPermissions, queueArguments } from './topology.mjs';
test('runtime identities cannot configure topology or publish another producer events', () => {
  for (const owner of Object.keys(events)) {
    assert.equal(permissions(owner).configure, '^$');
    assert.ok(new RegExp(permissions(owner).write).test(exchange));
    assert.equal(new RegExp(permissions(owner).write).test('amq.topic'), false);
    const scope = new RegExp(topicPermissions(owner).write);
    for (const [producer, keys] of Object.entries(events)) for (const key of keys) assert.equal(scope.test(key), owner === producer);
  }
});
test('read is restricted to the owner queues and Finance has no consumer', () => {
  assert.ok(new RegExp(permissions('operations').read).test(queues[0].name));
  assert.equal(new RegExp(permissions('operations').read).test(queues[1].name), false);
  assert.ok(new RegExp(permissions('employees').read).test(queues[1].name));
  assert.equal(new RegExp(permissions('finance').read).test(queues[0].name), false);
  assert.throws(() => permissions('unknown'));
});
test('all emitted business events have a durable destination binding', () => {
  for (const [producer, keys] of Object.entries(events)) {
    for (const key of keys) assert.ok(key === 'operations.order.confirmed.v1' ? queues[1].bindings.includes(key) : queues[0].bindings.some(binding => binding === producer + '.cu15.#'));
  }
});
test('poison messages have explicit per-consumer dead-letter routing', () => {
  for (const queue of queues) assert.deepEqual(queueArguments(queue), { 'x-dead-letter-exchange': deadExchange, 'x-dead-letter-routing-key': queue.deadKey });
});
