import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, request } from './runtime.mjs';
import { graphql } from './probes.mjs';

export async function consistencyProbes(c, session, f, store, stage) {
  assert.ok(process.env.CU05_COORDINATOR_CLIENT_FILE, 'Technical CU15 client file required for owned participant test sagas');
  const credential = JSON.parse(readFileSync(process.env.CU05_COORDINATOR_CLIENT_FILE, 'utf8'));
  const response = await fetch(c.issuer + '/protocol/openid-connect/token', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credential.clientId, client_secret: credential.clientSecret }) });
  assert.equal(response.status, 200, 'CU15 technical credential unavailable');
  const technical = (await response.json()).access_token;
  const human = await session.token(session.admin), initiatedBy = JSON.parse(Buffer.from(human.split('.')[1], 'base64url')).sub;
  const flow = await f.createFlow(f.a, '22', true, false), sagaId = randomUUID();
  const path = '/internal/cu15/assignments/' + sagaId;
  const metadata = { initiatedBy, authorizedAt: new Date().toISOString() };
  const reserve = { operationId: randomUUID(), expectedVersion: 0, orderId: flow.orderId, employeeId: flow.employeeId, employeeVersion: flow.command.employeeVersion, requiredSpecialty: flow.command.requiredSpecialty, startsAt: flow.startsAt, endsAt: flow.endsAt, ...metadata };
  const owned = { owner: 'employees', sagaId, orderId: flow.orderId, marker: flow.marker, kind: 'CU05-participant-only-no-global-O-Saga', reserve, releaseOperationId: randomUUID(), releaseReason: 'SAGA_REJECTED' };
  store.state.ownedResources.push(owned); store.save();
  const technicalCall = (suffix = '', method = 'GET', body) => request(c.employees + path + suffix, technical, method, body);
  const gql = graphql(c, session);
  async function excluded(resource, status) {
    assert.equal(resource.status, status); assert.equal(resource.sagaId, sagaId); assert.equal(resource.orderId, flow.orderId);
    const check = expect(await session.api('employees', '/agenda/assignments/check', 'POST', { scope: 'self', assignmentIds: [resource.id] }, f.a.account), 200);
    assert.equal(check.items[0].status, status, 'Real owner state must be observable');
    const list = expect(await session.api('operations', '/agenda/me?from=' + f.date + '&to=' + f.date, 'GET', undefined, f.a.account), 200);
    assert.ok(!list.items.some(w => w.assignmentId === resource.id || w.orderId === flow.orderId)); assert.equal(list.total, 1);
    expect(await session.api('operations', '/agenda/me/' + resource.id, 'GET', undefined, f.a.account), 404, 'AGENDA_WORK_NOT_FOUND');
    const graph = await gql(f.a.account, 'query($d:Date!){myAgenda(from:$d,to:$d){total items {assignmentId orderId}}}', { d: f.date });
    assert.ok(!graph.body.errors); assert.equal(graph.body.data.myAgenda.total, 1);
    assert.ok(!graph.body.data.myAgenda.items.some(w => w.assignmentId === resource.id || w.orderId === flow.orderId));
  }
  let resource;
  try {
    await stage('consistency-owned-reserved-is-not-job', async () => {
      const result = expect(await technicalCall('/reserve', 'POST', reserve), 200); assert.equal(result.outcome, 'applied');
      resource = result.resource; owned.assignmentId = resource.id; store.save(); await excluded(resource, 'reserved');
    });
    await stage('consistency-owned-confirmed-local-no-global-proof-is-not-job', async () => {
      const command = { operationId: randomUUID(), expectedVersion: resource.version, ...metadata };
      owned.confirm = command; store.save();
      const result = expect(await technicalCall('/confirm', 'POST', command), 200); assert.equal(result.outcome, 'applied'); resource = result.resource;
      await excluded(resource, 'confirmed');
    });
  } finally {
    await stage('consistency-idempotent-release-owned-resource-only', async () => {
      const current = await technicalCall();
      if (current.status === 404) { owned.cleanup = 'absent-no-command-issued'; store.save(); return; }
      resource = expect(current, 200);
      const command = { operationId: owned.releaseOperationId, expectedVersion: resource.version, reasonCode: owned.releaseReason, ...metadata };
      owned.release = command; store.save();
      const result = expect(await technicalCall('/release', 'POST', command), 200); assert.equal(result.outcome, 'applied');
      expect(await technicalCall('/release', 'POST', command), 200);
      owned.cleanup = 'released-preserved-history'; store.save();
      await excluded(expect(await technicalCall(), 200), 'released');
    });
  }
}
