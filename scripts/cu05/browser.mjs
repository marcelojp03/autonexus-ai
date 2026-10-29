import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function browserProbes(c, f, store, stage, report, options = {}) {
  assert.ok(c.playwrightModule && process.env.CU05_UI_TARGETS_FILE, 'Main must confirm actor41 target manifest and Playwright module before browser execution');
  const targets = JSON.parse(readFileSync(process.env.CU05_UI_TARGETS_FILE, 'utf8'));
  assert.equal(targets.confirmedByMain, true, 'Do not use provisional selectors as runtime evidence');
  for (const name of ['selfPath', 'teamPath', 'detailPath', 'from', 'to', 'priority', 'consult', 'rows', 'clock', 'empty', 'error', 'detailNotes', 'login', 'logout', 'identity', 'dateSummary', 'staffSummary', 'staffSearch', 'staffConsult', 'employeeId']) assert.ok(targets[name], 'Missing UI target ' + name);
  const require = createRequire(import.meta.url), { chromium } = require(c.playwrightModule);
  const browser = await chromium.launch({ headless: true });
  const contexts = [];
  report.browser = { expectedFailed: [], unexpectedFailed: [], consoleErrors: 0, pageErrors: 0, timezone: 'Pacific/Auckland', views: [] };
  const evidence = report.browser;
  const trace = action => { evidence.action = action; (evidence.actions ??= []).push(action); };
  async function pageFor(account) {
    const context = await browser.newContext({ timezoneId: 'Pacific/Auckland', locale: 'en-NZ', viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    let authenticating = true, offline = false;
    page.on('console', message => { if (message.type() === 'error' && !offline) evidence.consoleErrors++; });
    page.on('pageerror', () => evidence.pageErrors++);
    page.on('requestfailed', req => {
      const failure = req.failure()?.errorText;
      const safe = { kind: req.resourceType(), action: evidence.action, category: req.url() === c.graphql ? 'graphql' : new URL(req.url()).origin === new URL(c.issuer).origin ? 'issuer' : 'shell-resource', networkCode: /^net::[A-Z_]+$/.test(failure ?? '') ? failure : 'withheld', reason: offline ? 'INJECTED-offline' : authenticating && failure === 'net::ERR_ABORTED' ? 'OIDC-navigation-abort' : 'unexpected-network-failure' };
      (safe.reason === 'unexpected-network-failure' ? evidence.unexpectedFailed : evidence.expectedFailed).push(safe);
    });
    page.on('response', response => { if (response.status() >= 400) (evidence.httpFailures ??= []).push({ action: evidence.action, category: response.url() === c.graphql ? 'graphql' : new URL(response.url()).origin === new URL(c.issuer).origin ? 'issuer' : 'shell-resource', status: response.status() }); });
    await page.goto(c.shell, { waitUntil: 'domcontentloaded' });
    await page.locator(targets.login).waitFor({ state: 'visible' }); await page.locator(targets.login).click();
    await page.locator('#username').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).origin, new URL(c.issuer).origin, 'Never send credential outside IdP');
    await page.locator('#username').fill(account.username); await page.locator('#password').fill(account.password); await page.locator('#kc-login').click();
    await page.locator(targets.logout).waitFor({ state: 'visible' }); authenticating = false;
    async function switchAccount(next) {
      authenticating = true;
      await page.locator(targets.logout).click(); await page.locator(targets.login).waitFor({ state: 'visible' });
      assert.equal(await page.locator(targets.rows).count(), 0, 'Old account rows must unmount before next login');
      await page.locator(targets.login).click(); await page.locator('#username').waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).origin, new URL(c.issuer).origin);
      await page.locator('#username').fill(next.username); await page.locator('#password').fill(next.password); await page.locator('#kc-login').click();
      await page.locator(targets.logout).waitFor({ state: 'visible' }); authenticating = false;
    }
    return { page, context, switchAccount, offline: value => { offline = value; } };
  }
  async function consult(page, path, priority = '') {
    trace('consult:navigate:' + priority);
    if (new URL(page.url()).pathname !== path) await page.goto(c.shell + path, { waitUntil: 'domcontentloaded' });
    trace('consult:fill-dates:' + priority);
    await page.locator(targets.from).fill(f.date); await page.locator(targets.to).fill(f.date);
    await page.locator(targets.priority).selectOption(priority);
    if (path === targets.teamPath) await page.locator(targets.employeeId).selectOption('');
    const response = page.waitForResponse(r => r.url() === c.graphql && r.request().method() === 'POST' && /(?:myAgenda|teamAgenda)\s*\(/.test(r.request().postDataJSON()?.query ?? ''));
    trace('consult:submit:' + priority);
    await page.locator(targets.consult).click(); const result = await response;
    const body = await result.json(); assert.ok(!body.errors, 'Real BFF response must succeed');
    await page.locator(targets.dateSummary).filter({ hasText: f.date }).waitFor({ state: 'visible' });
  }
  async function capture(page, key) {
    if (options.noScreenshots) return;
    for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: resolve(store.dir, key + '-' + name + '.png'), fullPage: true, mask: [page.locator(targets.identity)] });
      evidence.views.push({ key, name });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  try {
    if (options.only !== 'chief') await stage('browser-own-A-B-detail-reload-LaPaz-desktop-mobile', async () => {
      let first;
      for (const [i, actor] of [f.a, f.b].entries()) {
        const handle = await pageFor(actor.account), { page } = handle, own = f.jobs[i], other = f.jobs[1 - i];
        if (i === 0) first = handle;
        await consult(page, targets.selfPath);
        const row = page.locator(targets.rows).filter({ hasText: own.orderNumber }); await row.waitFor({ state: 'visible' });
        assert.equal(await page.locator(targets.rows).filter({ hasText: other.orderNumber }).count(), 0);
        const expected = new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(own.startsAt));
        const expectedEnd = new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(own.endsAt));
        const browserExpected = await page.evaluate(startsAt => ({ stamp: new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(startsAt)), zone: new Intl.DateTimeFormat().resolvedOptions().timeZone }), own.startsAt);
        assert.equal(browserExpected.zone, 'Pacific/Auckland');
        assert.equal(browserExpected.stamp.replace(/\s+/gu, ' '), expected.replace(/\s+/gu, ' '));
        assert.notEqual(new Date(own.startsAt).toISOString().slice(0, 10), f.date, 'Fixture must cross UTC day, not La Paz day');
        const clock = await row.locator(targets.clock).innerText();
        (evidence.clockChecks ??= []).push({ actor: actor.account.key, rendered: clock, expectedStart: expected, browserExpectedStart: browserExpected.stamp, browserZone: browserExpected.zone, expectedEnd, civilDate: f.date, utcStartsAt: new Date(own.startsAt).toISOString() });
        assert.ok(clock.replace(/\s+/gu, ' ').includes(expected.replace(/\s+/gu, ' ')), 'Rendered civil date must be La Paz, not Auckland or UTC');
        assert.ok(clock.includes(expectedEnd), 'Rendered end time must match the real La Paz interval');
        await capture(page, actor.account.key + '-list');
        await row.getByRole('link', { name: 'Ver trabajo ' + own.orderNumber, exact: true }).click();
        await page.locator(targets.detailNotes).filter({ hasText: own.marker }).waitFor({ state: 'visible' });
        assert.equal(await page.locator(targets.detailNotes + ' b').count(), 0, 'Notes must remain text, not HTML');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator(targets.detailNotes).filter({ hasText: own.marker }).waitFor({ state: 'visible' });
        await capture(page, actor.account.key + '-detail');
        await page.goto(c.shell + targets.detailPath.replace(':assignmentId', other.assignmentId), { waitUntil: 'domcontentloaded' });
        await page.locator('anx-agenda').locator(targets.error).waitFor({ state: 'visible' });
        assert.equal(await page.locator(targets.detailNotes).count(), 0, 'Deep-linked IDOR must not render stale work');
      }
      await first.switchAccount(f.b.account); await consult(first.page, targets.selfPath);
      await first.page.locator(targets.rows).filter({ hasText: f.jobs[1].orderNumber }).waitFor({ state: 'visible' });
      assert.equal(await first.page.locator(targets.rows).filter({ hasText: f.jobs[0].orderNumber }).count(), 0, 'Same-context subject switch must not retain A data');
    });
    await stage('browser-chief-both-and-filters-empty-offline-logout', async () => {
      trace('chief:login');
      const handle = await pageFor(f.chief.account), { page, context } = handle;
      await consult(page, targets.teamPath);
      for (const job of f.jobs) await page.locator(targets.rows).filter({ hasText: job.orderNumber }).waitFor({ state: 'visible' });
      await capture(page, 'CHIEF-list');
      if (options.observeStaff) {
        const global = page.locator(targets.staffSummary), local = page.locator('anx-agenda').locator(targets.staffSummary);
        evidence.staffSelectorObservation = { globalMatches: await global.count(), agendaMatches: await local.count(), matchIsStaffLabel: (await global.allTextContents()).map(text => text.trim() === 'Buscar personal del equipo') };
        evidence.diagnosticOnly = true; return;
      }
      trace('chief:open-staff'); await page.locator('anx-agenda').locator(targets.staffSummary).click();
      trace('chief:fill-staff-search'); await page.locator(targets.staffSearch).fill(f.marker);
      const staffResponse = page.waitForResponse(r => r.url() === c.graphql && /agendaTeamEmployees/.test(r.request().postDataJSON()?.query ?? ''));
      trace('chief:submit-staff-search'); await page.locator(targets.staffConsult).click(); assert.ok(!(await (await staffResponse).json()).errors);
      trace('chief:wait-employee-option');
      await page.locator(targets.employeeId + ' option[value="' + f.jobs[0].employeeId + '"]').waitFor({ state: 'attached' });
      trace('chief:select-employee'); await page.locator(targets.employeeId).selectOption(f.jobs[0].employeeId);
      const filtered = page.waitForResponse(r => r.url() === c.graphql && /teamAgenda\s*\(/.test(r.request().postDataJSON()?.query ?? ''));
      trace('chief:submit-employee-filter'); await page.locator(targets.consult).click(); const filteredBody = await (await filtered).json();
      assert.ok(!filteredBody.errors); assert.equal(filteredBody.data.teamAgenda.total, 1);
      assert.equal(filteredBody.data.teamAgenda.items[0].employee.id, f.jobs[0].employeeId);
      await page.locator(targets.rows).filter({ hasText: f.jobs[0].orderNumber }).waitFor({ state: 'visible' });
      assert.equal(await page.locator(targets.rows).filter({ hasText: f.jobs[1].orderNumber }).count(), 0);
      await consult(page, targets.teamPath, 'alta');
      assert.equal(await page.locator(targets.rows).filter({ hasText: f.jobs[1].orderNumber }).count(), 0);
      await consult(page, targets.teamPath, 'urgente');
      evidence.emptySelectorObservation = { globalMatches: await page.locator(targets.empty).count(), agendaMatches: await page.locator('anx-agenda').locator(targets.empty).count() };
      await page.locator('anx-agenda').locator(targets.empty).waitFor({ state: 'visible' });
      await consult(page, targets.teamPath); trace('chief:set-offline'); handle.offline(true); await context.setOffline(true);
      trace('chief:wait-offline-error');
      await page.locator('anx-agenda').locator(targets.error).filter({ hasText: 'Sin conexión' }).waitFor({ state: 'visible' });
      assert.equal(await page.locator(targets.rows).count(), 0); assert.equal(await page.locator('anx-agenda').locator(targets.empty).count(), 0);
      trace('chief:restore-online'); await context.setOffline(false); handle.offline(false); await consult(page, targets.teamPath);
      trace('chief:logout');
      await page.locator(targets.logout).click(); await page.locator(targets.login).waitFor({ state: 'visible' });
      assert.equal(await page.locator(targets.rows).count(), 0, 'Logout must remove business data');
      assert.equal(await page.locator(targets.detailNotes).count(), 0);
    });
    assert.equal(evidence.unexpectedFailed.length, 0, 'Unexpected failed requests retained');
    assert.equal(evidence.consoleErrors, 0, 'Unexpected console errors counted without logging secret-bearing text');
    assert.equal(evidence.pageErrors, 0);
  } catch (error) {
    const firstLine = String(error?.message ?? '').split('\n')[0];
    evidence.failure = { name: error?.name, action: evidence.action, operation: firstLine.match(/^(?:locator|page|browserContext|browser)\.[A-Za-z]+/)?.[0], strictModeViolation: firstLine.includes('strict mode violation'), timeoutMs: Number(firstLine.match(/Timeout (\d+)ms/)?.[1]) || undefined, locations: [...new Set(String(error?.stack ?? '').match(/[a-zA-Z-]+\.mjs:\d+:\d+/g) ?? [])] };
    throw error;
  } finally { trace('cleanup:close-contexts'); await Promise.all(contexts.map(context => context.close())); await browser.close(); evidence.closed = true; }
}
