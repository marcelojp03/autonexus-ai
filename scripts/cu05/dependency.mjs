import assert from 'node:assert/strict';
import { expect } from './runtime.mjs';
import { graphql } from './probes.mjs';
import { withOwnedEmployeesFailure } from './employees-proxy.mjs';

export async function dependencyProbes(c, session, fixture, hooks, stage, browserProbe) {
  const account = fixture.a.account;
  const path = '/agenda/me?from=' + fixture.date + '&to=' + fixture.date;
  const gql = graphql(c, session);
  await withOwnedEmployeesFailure(c, hooks, async proxy => {
    await stage('dependency-proxy-forwarding-baseline', async () => {
      const baseline = expect(await session.api('operations', path, 'GET', undefined, account), 200);
      assert.equal(baseline.total, 1); assert.equal(baseline.items[0].assignmentId, fixture.jobs[0].assignmentId);
    });
    proxy.arm();
    try {
      await stage('INJECTED-E-agenda-owner-error-not-false-empty-REST-BFF', async () => {
        expect(await session.api('operations', path, 'GET', undefined, account), 503, 'AGENDA_DEPENDENCY_UNAVAILABLE');
        const result = await gql(account, 'query($d:Date!){myAgenda(from:$d,to:$d){items {assignmentId} total}}', { d: fixture.date });
        assert.ok(result.body.data == null);
        assert.ok(result.body.errors?.some(e => e.extensions?.code === 'AGENDA_DEPENDENCY_UNAVAILABLE' && e.extensions?.statusCode === 503));
        assert.ok(proxy.snapshot().injected > 0, 'Target must actually reach E proxy, in addition to business assertions');
        if (browserProbe) await browserProbe({ expected: 'dependency-error-not-empty', fixture });
      });
    } finally { proxy.disarm(); }
    await stage('dependency-restored-proxy-forwarding-real-work', async () => {
      const recovered = expect(await session.api('operations', path, 'GET', undefined, account), 200);
      assert.equal(recovered.total, 1); assert.equal(recovered.items[0].assignmentId, fixture.jobs[0].assignmentId);
      if (browserProbe) await browserProbe({ expected: 'work-restored', fixture });
    });
  });
}
