/** Focused F1/G1 evidence: custom-only identity, then remove team authority only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { config, createSession, expect, privateStore } from './runtime.mjs';
import { createIdentityFixture } from './identity-fixtures.mjs';
import { graphql } from './probes.mjs';

export async function main(args = process.argv.slice(2)) {
  assert.ok(args.includes('--run'), 'Explicit execution required');
  const fixtureFile = args.find(a => a.startsWith('--fixture-file='))?.slice('--fixture-file='.length);
  assert.ok(fixtureFile);
  const original = JSON.parse(readFileSync(fixtureFile, 'utf8'));
  assert.equal(original.synthetic, true);
  const f = original.fixture;
  assert.ok(f?.jobs?.[0]?.assignmentId);
  const c = config(), session = createSession(c), store = privateStore(randomUUID());
  const report = { runId: store.state.runId, synthetic: true, pass: false, sourceRunId: original.runId, zeroNewJobs: true, stages: [] };
  const save = () => writeFileSync(resolve(store.dir, 'result.json'), JSON.stringify(report, null, 2));
  const stage = async (name, action) => {
    const entry = { name, status: 'RUNNING' }; report.stages.push(entry); save();
    try { await action(); entry.status = 'PASS'; }
    catch (error) { entry.status = 'FAIL'; entry.category = error?.name; entry.locations = String(error?.stack ?? '').match(/[a-zA-Z0-9-]+[.]mjs:[0-9]+:[0-9]+/g) ?? []; throw error; }
    finally { save(); }
  };
  let control, browser;
  try {
    const roleName = 'agenda_review_' + store.state.runId.replaceAll('-', '').slice(0, 12);
    const retained = ['agenda:read:self', 'employees:read', 'schedules:read', 'orders:read'];
    await stage('create-owned-custom-only-role-and-active-linked-control', async () => {
      const role = expect(await session.api('employees', '/security/roles', 'POST', {
        operationId: randomUUID(), name: roleName, description: 'CU05 TEST review control', permissions: [...retained, 'agenda:read:team'],
      }), 201).role;
      assert.equal(role.syncStatus, 'synced');
      store.state.ownedResources.push({ kind: 'CU05-owned-role-control', name: roleName }); store.save();
      control = await createIdentityFixture(session, store, { key: 'CUSTOM', roleName });
      store.state.control = control; store.save();
      const token = await session.token(control.account, true);
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      assert.ok(claims.realm_access.roles.includes(roleName));
      assert.ok(!claims.realm_access.roles.some(r => ['administrador', 'mecanico', 'jefe_taller', 'recepcionista', 'responsable_financiero'].includes(r)));
    });
    const gql = graphql(c, session), range = '?from=' + f.date + '&to=' + f.date;
    const teamQueries = ['query($date:Date!){teamAgenda(from:$date,to:$date){total}}', 'query($id:UUID!){teamAgendaWork(assignmentId:$id){assignmentId}}', '{agendaTeamEmployees {total}}'];
    const variables = { date: f.date, id: f.jobs[0].assignmentId };
    await stage('custom-only-real-owners-and-BFF-team-before-withdrawal', async () => {
      expect(await session.api('employees', '/agenda/context?scope=team', 'GET', undefined, control.account), 200);
      const team = expect(await session.api('operations', '/agenda/team' + range, 'GET', undefined, control.account), 200);
      assert.ok(team.items.some(item => item.assignmentId === f.jobs[0].assignmentId));
      for (const query of teamQueries) { const result = await gql(control.account, query, variables); assert.equal(result.status, 200); assert.ok(!result.body.errors); assert.ok(result.body.data); }
    });
    await stage('custom-only-real-browser-team-mount-reload-keyboard', async () => {
      assert.ok(c.playwrightModule);
      const { chromium } = createRequire(import.meta.url)(c.playwrightModule);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(45000);
      await page.goto(c.shell, { waitUntil: 'domcontentloaded' });
      await page.locator('#session-login').click(); await page.locator('#username').waitFor();
      assert.equal(new URL(page.url()).origin, new URL(c.issuer).origin);
      await page.locator('#username').fill(control.account.username); await page.locator('#password').fill(control.account.password); await page.locator('#kc-login').click();
      await page.locator('#session-logout').waitFor({ state: 'visible' });
      await page.goto(c.shell + '/employees/agenda/team', { waitUntil: 'domcontentloaded' });
      await page.locator('input[name=from]').fill(f.date); await page.locator('input[name=to]').fill(f.date);
      await page.locator('form.toolbar:has(input[name=from]) button[type=submit]').click();
      await page.locator('nz-table tbody tr').filter({ hasText: f.jobs[0].orderNumber }).waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('input[name=from]').waitFor();
      await page.locator('input[name=from]').focus();
      // Native date controls have multiple keyboard segments; one Tab is not a whole field.
      const focus = []; let reachedTo = false;
      for (let i = 0; i < 12 && !reachedTo; i++) {
        await page.keyboard.press('Tab');
        focus.push(await page.locator('input[name=from]').evaluate(el => {
          const active = el.getRootNode().activeElement;
          return { tag: active?.tagName, name: active?.getAttribute('name'), type: active?.getAttribute('type') };
        }));
        reachedTo = await page.locator('input[name=to]').evaluate(el => el === el.getRootNode().activeElement);
      }
      report.keyboard = { fromToTraversal: reachedTo, focus, visualFocusReview: 'PENDING_PIXEL_CHANNEL' }; save();
      assert.equal(reachedTo, true);
      await page.locator('#session-logout').click(); await page.locator('#session-login').waitFor({ state: 'visible' });
      assert.equal(await page.locator('nz-table tbody tr').count(), 0);
      await browser.close(); browser = null;
    });
    await stage('withdraw-only-team-retain-active-link-and-general-self', async () => {
      const stale = await session.token(control.account, true);
      const role = expect(await session.api('employees', '/security/roles/' + roleName), 200);
      const updated = expect(await session.api('employees', '/security/roles/' + roleName, 'PUT', {
        operationId: randomUUID(), expectedVersion: role.version, description: role.description, permissions: retained,
      }), 200).role;
      assert.deepEqual([...updated.permissions].sort(), [...retained].sort());
      for (const token of [stale, await session.token(control.account, true)]) {
        const permissions = expect(await session.api('employees', '/security/permissions', 'GET', undefined, token), 200);
        assert.ok(retained.every(p => permissions.effective.includes(p))); assert.ok(!permissions.effective.includes('agenda:read:team'));
        const own = expect(await session.api('employees', '/agenda/context?scope=self', 'GET', undefined, token), 200);
        assert.equal(own.actor.employeeId, control.employee.id);
        expect(await session.api('operations', '/agenda/me' + range, 'GET', undefined, token), 200);
        for (const [owner, path, method, body] of [
          ['employees', '/agenda/context?scope=team'], ['employees', '/agenda/team/employees'],
          ['employees', '/agenda/assignments/check', 'POST', { scope: 'team', assignmentIds: [f.jobs[0].assignmentId] }],
          ['operations', '/agenda/team' + range], ['operations', '/agenda/team/' + f.jobs[0].assignmentId],
        ]) expect(await session.api(owner, path, method ?? 'GET', body, token), 403, 'AGENDA_ACCESS_DENIED');
        for (const query of teamQueries) {
          const result = await gql(token, query, variables);
          assert.ok(result.body?.data == null); assert.ok(result.body?.errors?.some(e => e.extensions?.statusCode === 403));
        }
        const ownGraph = await gql(token, 'query($date:Date!){myAgenda(from:$date,to:$date){total}}', { date: f.date });
        assert.ok(!ownGraph.body.errors); assert.ok(ownGraph.body.data);
      }
    });
    report.pass = true;
  } catch { report.pass = false; process.exitCode = 1; }
  finally {
    await browser?.close();
    if (control) {
      try {
        const employee = expect(await session.api('employees', '/employees/' + control.employee.id), 200);
        assert.equal(employee.document, control.employee.document);
        if (employee.status === 'active') expect(await session.api('employees', '/employees/' + employee.id + '/deactivate', 'POST', { operationId: randomUUID(), expectedVersion: employee.version }), 200);
        report.cleanup = 'owned-control-inactive-history-preserved';
      } catch { report.cleanup = 'FAILED'; report.pass = false; process.exitCode = 1; }
    }
    store.save(); save(); writeFileSync(resolve(store.dir, 'run.exit'), String(report.pass ? 0 : 1));
    console.log(JSON.stringify(report));
  }
  return report;
}
