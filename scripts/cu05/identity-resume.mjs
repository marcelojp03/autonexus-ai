import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, createSession, privateStore, expect } from './runtime.mjs';
import { createIdentityFixture } from './identity-fixtures.mjs';
import { graphql, graphAccessDenied, identityMutations } from './probes.mjs';

export async function main(args = process.argv.slice(2)) {
  assert.ok(args.includes('--run'), 'Explicit execution authorization required');
  const option = name => args.find(value => value.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
  const mode = option('mode'); assert.ok(['red', 'green'].includes(mode), 'Choose red or green explicitly');
  const fixtureFile = option('fixture-file'); assert.ok(fixtureFile, 'Original API fixture reference required');
  const c = config(), store = privateStore(randomUUID());
  const report = { runId: store.state.runId, mode, synthetic: true, zeroNewJobs: true, pass: false, stages: [], graphql: [] };
  const save = () => writeFileSync(resolve(store.dir, 'result.json'), JSON.stringify(report, null, 2));
  const stage = async (name, action) => {
    const entry = { name, status: 'RUNNING' }; report.stages.push(entry); save();
    try { await action(); entry.status = 'PASS'; }
    catch (error) { entry.status = 'FAIL'; entry.category = error?.name; if (/^[A-Z0-9_]+$/.test(error?.cause?.code ?? '')) entry.networkCode = error.cause.code; if (typeof error?.actual === 'number') entry.actual = error.actual; if (typeof error?.expected === 'number') entry.expected = error.expected; entry.locations = String(error?.stack ?? '').match(/[a-zA-Z0-9-]+\.mjs:\d+:\d+/g) ?? []; throw error; }
    finally { save(); appendFileSync(resolve(store.dir, 'run.log'), JSON.stringify({ name, status: entry.status }) + '\n'); }
  };
  try {
    const original = JSON.parse(readFileSync(fixtureFile, 'utf8')); assert.equal(original.synthetic, true); assert.ok(original.fixture?.a && original.fixture?.b && original.fixture?.chief);
    store.state.sourceRunId = original.runId;
    const session = createSession(c); session.observeGraphql = value => { report.graphql.push(value); save(); };
    const api = session.api;
    session.api = async (...input) => {
      const result = await api(...input);
      (report.ownerRequests ??= []).push({ owner: input[0], path: input[1].split('?')[0], method: input[2] ?? 'GET', status: result.status, code: /^[A-Z_]+$/.test(result.body?.code ?? '') ? result.body.code : undefined }); save(); return result;
    };
    if (mode === 'red') {
      let control;
      await stage('one-new-linked-active-mechanic-control-no-jobs', async () => { control = await createIdentityFixture(session, store, { key: 'REDINACTIVE', roleName: 'mecanico' }); });
      const stale = await session.token(control.account, true);
      const current = expect(await session.api('employees', '/employees/' + control.employee.id), 200);
      assert.equal(current.document, control.employee.document); assert.equal(current.access.subject, control.account.subject); assert.equal(current.version, control.employee.version);
      const command = { operationId: randomUUID(), expectedVersion: current.version };
      store.state.deactivation = { employeeId: current.id, marker: current.document, subject: control.account.subject, command }; store.save();
      expect(await session.api('employees', '/employees/' + current.id + '/deactivate', 'POST', command), 200);
      report.control = { employeeId: current.id, marker: current.document, leftInactive: true };
      const result = await graphql(c, session)(stale, '{myAgenda{total}}');
      report.firstBFFRequestWasAfterDeactivation = true;
      report.actualDenial = { http: result.status, hasData: result.body?.data != null, errors: result.body?.errors?.map(error => ({ code: /^[A-Z_]+$/.test(error.extensions?.code ?? '') ? error.extensions.code : 'WITHHELD', statusCode: error.extensions?.statusCode })) }; save();
      const e = await session.api('employees', '/agenda/context?scope=self', 'GET', undefined, stale);
      const o = await session.api('operations', '/agenda/me', 'GET', undefined, stale);
      report.ownerDenials = { employees: { http: e.status, code: e.body?.code }, operations: { http: o.status, code: o.body?.code } };
      expect(e, 403, 'AGENDA_ACCESS_DENIED'); expect(o, 403, 'AGENDA_ACCESS_DENIED');
      assert.equal(result.status, 200); assert.ok(result.body.data == null);
      assert.ok(result.body.errors?.some(error => error.extensions?.code === 'SERVICE_UNAVAILABLE' && error.extensions?.statusCode === 503), 'Old BFF cache-miss defect must be captured exactly, not tolerated as a passing authorization test');
      report.redReproduced = true; report.productContract = 'FAIL_EXPECTED_FORBIDDEN_403_GOT_SERVICE_UNAVAILABLE_503'; process.exitCode = 1;
    } else {
      const controls = { ...original.fixture };
      await stage('new-INACTIVE-and-REVOKED-controls-only-no-cohort-or-Saga', async () => {
        controls.inactive = await createIdentityFixture(session, store, { key: 'INACTIVE', roleName: 'mecanico' });
        controls.revoked = await createIdentityFixture(session, store, { key: 'REVOKED', roleName: 'jefe_taller' });
        store.state.controls = { inactive: controls.inactive, revoked: controls.revoked }; store.save();
      });
      await stage('original-noperm-unlinked-and-self-token-without-team-scope-denied', async () => {
        const gql = graphql(c, session);
        for (const account of [controls.noPermission.account, session.unlinked]) {
          const token = await session.token(account, true);
          expect(await session.api('employees', '/agenda/context?scope=self', 'GET', undefined, token), 403, 'AGENDA_ACCESS_DENIED');
          expect(await session.api('operations', '/agenda/me', 'GET', undefined, token), 403, 'AGENDA_ACCESS_DENIED');
          graphAccessDenied(await gql(token, '{myAgenda{total}}'));
        }
        const selfToken = await session.token(controls.a.account, true);
        expect(await session.api('employees', '/agenda/context?scope=team', 'GET', undefined, selfToken), 403, 'AGENDA_ACCESS_DENIED');
        expect(await session.api('operations', '/agenda/team', 'GET', undefined, selfToken), 403, 'AGENDA_ACCESS_DENIED');
        graphAccessDenied(await gql(selfToken, '{teamAgenda{total}}'));
      });
      await identityMutations(c, session, controls, stage); report.pass = true;
    }
  } catch { process.exitCode = 1; report.pass = false; report.executionError = true; }
  finally { store.save(); save(); writeFileSync(resolve(store.dir, 'run.exit'), report.pass ? '0\n' : '1\n'); console.log(JSON.stringify({ runId: report.runId, mode, pass: report.pass, redReproduced: report.redReproduced, actualDenial: report.actualDenial, ownerDenials: report.ownerDenials })); }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv.includes('--run')) main().catch(() => { process.exitCode = 1; console.error('CU05 identity resume preflight failed; private diagnostics withheld'); });
