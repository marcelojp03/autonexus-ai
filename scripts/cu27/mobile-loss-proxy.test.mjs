import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedAdvance, ownerConfirmed, registration, forwardHeaders, isUuid } from './mobile-loss-proxy.mjs';

const operationId = '11111111-1111-4111-8111-111111111111';
const assignmentId = '22222222-2222-4222-8222-222222222222';
const advanceId = '33333333-3333-4333-8333-333333333333';
const overlayId = '44444444-4444-4444-8444-444444444444';
const fixture = () => ({ overlayId, results: [{ operationId, status: 201, code: 'APPLIED', body: { advance: { id: advanceId } } }],
  applied: [operationId], pending: [], failed: [], operations: [{ operationId, state: 'applied' }] });

test('UUID configuration accepts only an exact UUID without whitespace or coercion', () => {
  assert.equal(isUuid(operationId), true);
  for (const value of [undefined, null, {}, ' ' + operationId, operationId + String.fromCharCode(10), operationId + ' ']) {
    assert.equal(isUuid(value), false);
  }
});

test('real-shaped summary requires HTTP success, result success, applied ID and actual advance ID', () => {
  assert.equal(acceptedAdvance(201, fixture(), operationId), advanceId);
  assert.equal(acceptedAdvance(503, fixture(), operationId), null);
  for (const change of [b => { b.applied = []; }, b => { b.results[0].status = 409; },
    b => { b.results[0].body = {}; }, b => { b.results[0].operationId = assignmentId; },
    b => { b.results[0].body.advance.id = 'not-an-id'; }, b => { b.results.push(b.results[0]); },
    b => { b.results[0].status = '201'; }]) {
    const body = fixture(); change(body); assert.equal(acceptedAdvance(200, body, operationId), null);
  }
  for (const body of [null, {}, { operations: [{ operationId, state: 'applied' }] }]) {
    assert.equal(acceptedAdvance(200, body, operationId), null);
  }
});

test('owner requires the exact advance and exactly one exact description', () => {
  const body = { advances: [{ id: advanceId, description: 'test marker' }] };
  assert.equal(ownerConfirmed(200, body, advanceId, 'test marker'), true);
  assert.equal(ownerConfirmed(403, body, advanceId, 'test marker'), false);
  assert.equal(ownerConfirmed(200, body, assignmentId, 'test marker'), false);
  assert.equal(ownerConfirmed(200, body, advanceId, 'test'), false);
  assert.equal(ownerConfirmed(200, { advances: [...body.advances, { id: assignmentId, description: 'test marker' }] }, advanceId, 'test marker'), false);
  assert.equal(ownerConfirmed(200, null, advanceId, 'test marker'), false);
});

test('registration observes only target advance without modifying owner input', () => {
  const body = { overlayId, operations: [{ operationId, entity: 'advance', target: { assignmentId },
    payload: { operationId, description: 'test marker', expectedVersion: 8, minutesWorked: 15 } }] };
  const before = JSON.stringify(body);
  assert.deepEqual(registration(body, operationId), { overlayId, assignmentId, description: 'test marker' });
  assert.equal(JSON.stringify(body), before);
  assert.equal(registration(body, assignmentId), null);
  body.operations[0].payload.operationId = assignmentId;
  assert.equal(registration(body, operationId), null);
});

test('forwarding strips hop-by-hop and connection-nominated headers only', () => {
  assert.deepEqual(forwardHeaders({ connection: 'keep-alive, x-local', 'x-local': 'remove',
    'transfer-encoding': 'chunked', authorization: 'Bearer synthetic', 'content-length': '12', 'content-type': 'application/json' }),
  { authorization: 'Bearer synthetic', 'content-length': '12', 'content-type': 'application/json' });
});
