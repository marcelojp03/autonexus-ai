import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

async function run() {
  assert.equal(process.versions.node, '22.22.3', 'Use Node 22.22.3');
  const { workspace, accounts, ownerDatabase, sanitize } = await import('./runtime.mjs');
  const { createFlow, api } = await import('./fixtures.mjs');
  const requireApp = createRequire(resolve(workspace, 'web/mf-employees/package.json'));
  const { chromium } = requireApp(resolve(workspace, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
  const shell = 'http://127.0.0.1:4200', graphql = 'http://127.0.0.1:3004/graphql';
  const id = 'recovery-web-real-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const out = resolve(workspace, 'output/cu15'), shots = resolve(workspace, 'output/playwright');
  mkdirSync(out, { recursive: true }); mkdirSync(shots, { recursive: true });
  const log = resolve(out, id + '.log'); writeFileSync(log, '', { flag: 'wx' });
  const privateAccounts = accounts();
  const redact = value => sanitize(String(value).replace(/([?&#](?:code|state|session_state|session_code|access_token|id_token|refresh_token)=)[^&#\s]+/gi, '$1[REDACTED]'), privateAccounts.map(account => account.password));
  const report = { pass: false, id, synthetic: true, stages: [], evidence: {}, injected: [], expectedFailed: [], expectedConsole: [], unexpectedFailed: [], unexpectedErrors: [], httpFailures: [], reads: [] };
  const emit = entry => { const text = redact(JSON.stringify(entry)); appendFileSync(log, text + '\n'); console.log(text); };
  const stage = name => { report.stages.push(name); emit({ stage: name }); };
  const databases = [], starts = [], aborted = new Set(), consoleAllowances = [];
  let browser, page, injection, replayAllowed = false;
  const bodyOf = request => request.url() === graphql && request.method() === 'POST' ? request.postDataJSON() : null;
  const isStart = request => /\bstartServiceConfirmation\s*\(/.test(bodyOf(request)?.query ?? '');
  const screenshot = async name => {
    for (const [size, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: resolve(shots, id + '-' + name + '-' + size + '.png'), fullPage: true, mask: [page.locator('#session-identity')] });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  };
  const safeStorage = async () => assert.ok(await page.evaluate(() => [localStorage, sessionStorage].every(storage => Object.values(storage).every(value => !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)))), 'No JWT in local/session storage');
  const metadata = async () => {
    const entries = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('cu15:pending:')));
    assert.equal(entries.length, 1, 'One subject-scoped CU15 recovery key');
    const [key, raw] = entries[0]; assert.ok(raw.length <= 2048);
    const value = JSON.parse(raw); assert.equal(key, 'cu15:pending:' + value.subject);
    return { key, raw, value };
  };
  const waitEnabled = async selector => page.locator(selector + ':enabled').waitFor({ state: 'visible' });
  const choose = async fixture => {
    await page.locator('#confirmation-order').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('#confirmation-loading').waitFor({ state: 'hidden' });
    const option = page.locator('#confirmation-order option[value="' + fixture.order.id + '"]');
    while (await option.count() === 0) {
      const more = page.getByRole('button', { name: 'Más órdenes', exact: true });
      assert.ok(await more.isEnabled(), 'Fixture order must be reachable through real pagination');
      const before = await page.locator('#confirmation-order').innerHTML(); await more.click();
      const deadline = Date.now() + 45000;
      while (await page.locator('#confirmation-order').innerHTML() === before && Date.now() < deadline) await pause(100);
      assert.notEqual(await page.locator('#confirmation-order').innerHTML(), before, 'Real pagination must render the next page');
      await page.locator('#confirmation-loading').waitFor({ state: 'hidden' });
    }
    await page.locator('#confirmation-order').selectOption(fixture.order.id);
    const quoteKey = fixture.quote.id + ':' + fixture.quote.version;
    await page.locator('#confirmation-quote option[value="' + quoteKey + '"]').waitFor({ state: 'attached' });
    await page.locator('#confirmation-quote').selectOption(quoteKey);
    await page.locator('#confirmation-mechanic-search').fill(fixture.marker); await page.locator('#confirmation-search-mechanics').click();
    await page.locator('#confirmation-mechanic option[value="' + fixture.employee.id + '"]').waitFor({ state: 'attached' });
    await page.locator('#confirmation-mechanic').selectOption(fixture.employee.id);
    await page.locator('#confirmation-mechanic-profile').waitFor({ state: 'visible' });
    await page.locator('#confirmation-specialty').selectOption(fixture.requiredSpecialty);
    await page.locator('#confirmation-starts-at').fill(fixture.date + 'T10:00'); await page.locator('#confirmation-ends-at').fill(fixture.date + 'T11:00');
    await page.locator('#confirmation-availability').waitFor({ state: 'visible' });
  };
  try {
    const operations = await ownerDatabase('operations'); databases.push(operations);
    const employees = await ownerDatabase('employees'); databases.push(employees);
    const finance = await ownerDatabase('finance'); databases.push(finance);
    const absent = async (fixture, input, label) => {
      const path = '/confirmations/operations/' + input.operationId;
      const response = await api('operations', path, 'GET', undefined, 'jefe_taller');
      report.reads.push({ label, path, status: response.status, code: response.body.code });
      assert.equal(response.status, 404, 'Real operation GET must remain absent before explicit replay');
      assert.equal(Number((await operations.query('SELECT count(*) AS n FROM operations.cu15_sagas WHERE order_id=$1', [fixture.order.id])).rows[0].n), 0);
      assert.equal(Number((await operations.query('SELECT count(*) AS n FROM operations.cu15_ledger WHERE operation_id=$1', [input.operationId])).rows[0].n), 0);
      assert.equal(Number((await employees.query('SELECT count(*) AS n FROM employees.employee_assignments WHERE order_id=$1', [fixture.order.id])).rows[0].n), 0);
      assert.equal(Number((await finance.query('SELECT count(*) AS n FROM quote_confirmation_links WHERE order_id=$1', [fixture.order.id])).rows[0].n), 0);
      const order = (await operations.query('SELECT status,confirmation_saga_id FROM operations.work_orders WHERE id=$1', [fixture.order.id])).rows[0];
      assert.equal(order.status, 'pending_quote'); assert.equal(order.confirmation_saga_id, null);
      report.reads.at(-1).sql = { sagas: 0, startLedger: 0, assignments: 0, quoteLinks: 0, orderStatus: order.status };
    };
    browser = await chromium.launch();
    page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/La_Paz' })).newPage(); page.setDefaultTimeout(45000);
    page.on('pageerror', error => report.unexpectedErrors.push({ type: 'pageerror', message: redact(error.stack ?? error.message), path: new URL(page.url()).pathname }));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const location = message.location();
      const item = { type: 'console', message: redact(message.text()), location: { path: location.url ? new URL(location.url).pathname : '', line: location.lineNumber, column: location.columnNumber } };
      const allowance = consoleAllowances.find(entry => !entry.used && Date.now() - entry.at < 5000);
      if (allowance && location.url === graphql && message.text() === 'Failed to load resource: net::ERR_FAILED') {
        allowance.used = true; report.expectedConsole.push({ ...item, injection: allowance.label });
      } else report.unexpectedErrors.push(item);
    });
    page.on('requestfailed', request => {
      const item = { path: new URL(request.url()).pathname, method: request.method(), reason: request.failure()?.errorText };
      if (aborted.has(request) && item.reason === 'net::ERR_FAILED') report.expectedFailed.push({ ...item, injection: starts.find(start => start.request === request)?.label });
      else report.unexpectedFailed.push(item);
    });
    page.on('response', response => { if (response.status() >= 400) report.httpFailures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    await page.route(graphql, async route => {
      const request = route.request(); if (!isStart(request)) return route.continue();
      const body = bodyOf(request);
      const entry = { request, target: request.url(), orderId: body.variables.orderId, input: structuredClone(body.variables.input), label: injection?.label ?? 'manual-replay' }; starts.push(entry);
      if (injection) {
        assert.equal(injection.count, 0, 'Exactly one start is aborted per scenario');
        injection.count++; injection.entry = entry; aborted.add(request); consoleAllowances.push({ label: injection.label, at: Date.now(), used: false });
        report.injected.push({ label: injection.label, path: '/graphql', operationId: entry.input.operationId, orderId: entry.orderId, mode: 'INJECTED abort before upstream; no fabricated response or ledger' });
        return route.abort('failed');
      }
      if (!replayAllowed) {
        report.unexpectedErrors.push({ type: 'unexpected-start', path: '/graphql', operationId: entry.input.operationId });
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await page.goto(shell + '/', { waitUntil: 'domcontentloaded' }); await page.locator('#session-login').waitFor({ state: 'visible' }); await page.locator('#session-login').click();
    const head = privateAccounts.find(account => account.key === 'jefe_taller');
    await page.locator('#username').waitFor({ state: 'visible' }); await page.locator('#username').fill(head.username); await page.locator('#password').fill(head.password); await page.locator('#kc-login').click();
    await page.locator('#session-logout').waitFor({ state: 'visible', timeout: 60000 }); await safeStorage();
    stage('real-head-login-at-shell-before-wizard');
    const first = await createFlow({ prefix: 'C2RECOVERY', mechanicEnabled: true, quoteApproved: true });
    report.evidence.first = { marker: first.marker, orderId: first.order.id, employeeId: first.employee.id, quoteId: first.quote.id };
    await page.goto(shell + '/operations/confirmations', { waitUntil: 'domcontentloaded' }); await choose(first);
    injection = { label: 'C2', count: 0 }; await page.locator('#confirmation-submit').click();
    await page.locator('#confirmation-resend').waitFor({ state: 'visible' }); await waitEnabled('#confirmation-resend'); assert.equal(injection.count, 1);
    const original = injection.entry; injection = null;
    assert.deepEqual(original.input, { ...first.command, operationId: original.input.operationId }); assert.equal(original.orderId, first.order.id);
    const pending = await metadata(); assert.deepEqual(pending.value.input, original.input); assert.equal(pending.value.orderId, first.order.id);
    await absent(first, original.input, 'C2-before-reload'); await safeStorage(); stage('C2-injected-before-upstream-real-404-zero-saga-and-effects');
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#session-logout').waitFor({ state: 'visible' });
    await page.locator('#confirmation-resend').waitFor({ state: 'visible', timeout: 60000 }); await waitEnabled('#confirmation-resend');
    for (let poll = 0; poll < 4; poll++) {
      await absent(first, original.input, 'C2-reloaded-no-replay-' + poll); assert.equal(starts.length, 1, 'Reload/poll must never auto-start');
      assert.ok(await page.locator('#confirmation-resend').isVisible()); await pause(2100);
    }
    assert.equal((await metadata()).raw, pending.raw); await screenshot('unknown');
    stage('C2-reload-preserves-frozen-command-and-permanent-real-404-until-manual-replay');
    await absent(first, original.input, 'C2-immediately-before-manual-replay'); assert.equal(starts.length, 1);
    const accepted = page.waitForResponse(response => isStart(response.request())); replayAllowed = true; await page.locator('#confirmation-resend').click();
    const acceptedResponse = await accepted; assert.equal(acceptedResponse.status(), 200);
    const acceptedBody = await acceptedResponse.json(); assert.equal(acceptedBody.errors, undefined); const saga = acceptedBody.data.startServiceConfirmation; replayAllowed = false;
    assert.equal(starts.length, 2); assert.deepEqual(starts[1].input, original.input); assert.equal(starts[1].target, original.target); assert.equal(starts[1].orderId, original.orderId);
    assert.equal(saga.operationId, original.input.operationId); assert.equal(saga.orderId, first.order.id); assert.notEqual(saga.status, 'confirmed', 'Acceptance alone is not business success');
    await page.locator('#confirmation-success').waitFor({ state: 'visible', timeout: 150000 });
    const real = await api('operations', '/confirmations/operations/' + original.input.operationId, 'GET', undefined, 'jefe_taller');
    assert.equal(real.status, 200); assert.equal(real.body.status, 'confirmed'); assert.equal(real.body.sagaId, saga.sagaId);
    const sagas = (await operations.query('SELECT id,status FROM operations.cu15_sagas WHERE order_id=$1', [first.order.id])).rows;
    assert.equal(sagas.length, 1); assert.equal(sagas[0].id, saga.sagaId); assert.equal(sagas[0].status, 'confirmed');
    assert.equal(Number((await operations.query('SELECT count(*) AS n FROM operations.cu15_ledger WHERE operation_id=$1 AND saga_id=$2', [original.input.operationId, saga.sagaId])).rows[0].n), 1);
    const order = (await operations.query('SELECT status,confirmation_saga_id,assignment_id,quote_link_id,quote_id,quote_version,employee_id,starts_at,ends_at FROM operations.work_orders WHERE id=$1', [first.order.id])).rows[0];
    const assignments = (await employees.query('SELECT id,saga_id,status,employee_id FROM employees.employee_assignments WHERE order_id=$1', [first.order.id])).rows;
    const links = (await finance.query('SELECT id,saga_id,status,quote_id,quote_version FROM quote_confirmation_links WHERE order_id=$1', [first.order.id])).rows;
    assert.equal(assignments.length, 1); assert.equal(links.length, 1); assert.equal(order.status, 'confirmed'); assert.equal(order.confirmation_saga_id, saga.sagaId);
    assert.equal(assignments[0].status, 'confirmed'); assert.equal(assignments[0].saga_id, saga.sagaId); assert.equal(links[0].status, 'active'); assert.equal(links[0].saga_id, saga.sagaId);
    assert.equal(order.assignment_id, assignments[0].id); assert.equal(order.quote_link_id, links[0].id); assert.equal(order.employee_id, first.employee.id); assert.equal(assignments[0].employee_id, first.employee.id);
    assert.equal(order.quote_id, first.quote.id); assert.equal(links[0].quote_id, first.quote.id); assert.equal(order.quote_version, first.quote.version); assert.equal(links[0].quote_version, first.quote.version);
    assert.equal(order.starts_at.toISOString(), new Date(first.startsAt).toISOString()); assert.equal(order.ends_at.toISOString(), new Date(first.endsAt).toISOString());
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), pending.key), null);
    Object.assign(report.evidence.first, { sagaId: saga.sagaId, sagaCount: sagas.length, assignmentCount: assignments.length, quoteLinkCount: links.length, order, assignment: assignments[0], quoteLink: links[0], startLedgerCount: 1, identicalReplay: true });
    await safeStorage(); await screenshot('confirmed'); stage('C2-manual-identical-replay-one-saga-three-real-owner-effects-terminal-clears-metadata');
    const second = await createFlow({ prefix: 'C3LOGOUT', mechanicEnabled: true, quoteApproved: true });
    report.evidence.second = { marker: second.marker, orderId: second.order.id, employeeId: second.employee.id, quoteId: second.quote.id };
    await page.locator('#confirmation-new-selection').click(); await choose(second);
    injection = { label: 'C3', count: 0 }; await page.locator('#confirmation-submit').click(); await page.locator('#confirmation-resend').waitFor({ state: 'visible' }); await waitEnabled('#confirmation-resend'); assert.equal(injection.count, 1);
    const secondStart = injection.entry; injection = null;
    const secondPending = await metadata(); assert.deepEqual(secondPending.value.input, secondStart.input);
    await absent(second, secondStart.input, 'C3-before-unmount'); await safeStorage();
    await page.locator('a[data-shell-link][href="/operations/orders"]').click(); await page.waitForURL(shell + '/operations/orders'); await page.locator('#order-table').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#confirmation-resend').count(), 0, 'Wizard is unmounted'); assert.ok(await page.locator('#session-logout').isVisible(), 'Normal navigation is not logout');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), secondPending.key), secondPending.raw); assert.equal(starts.length, 3);
    await absent(second, secondStart.input, 'C3-unmounted'); await screenshot('unmounted-pending'); await safeStorage(); stage('C3-shell-orders-navigation-unmount-preserves-unknown-metadata-no-start');
    await page.locator('#session-logout').click(); await page.waitForURL(shell + '/', { timeout: 60000 }); await page.locator('#session-login').waitFor({ state: 'visible', timeout: 60000 });
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), secondPending.key), null, 'Real logout clears metadata after wizard unmount');
    await safeStorage(); await absent(second, secondStart.input, 'C3-after-logout'); assert.equal(starts.length, 3);
    assert.equal(report.injected.length, 2); assert.equal(report.expectedFailed.length, 2); assert.deepEqual(report.unexpectedFailed, []); assert.deepEqual(report.unexpectedErrors, []); assert.deepEqual(report.httpFailures, []);
    report.evidence.terminalRecoveryAbsent = true; report.evidence.unmountedLogoutRecoveryAbsent = true; stage('C3-real-logout-clears-unmounted-recovery-no-jwt-no-unexpected-errors'); report.pass = true;
  } catch (error) { report.error = redact(error?.stack ?? error); process.exitCode = 1; }
  finally {
    report.starts = starts.map(({ label, orderId, input }) => ({ label, orderId, operationId: input.operationId }));
    try { await browser?.close(); } catch (error) { report.pass = false; report.cleanupError = redact(error); process.exitCode = 1; }
    for (const db of databases) { try { await db.end(); } catch (error) { report.pass = false; report.databaseCleanupError = redact(error); process.exitCode = 1; } }
    if (report.unexpectedFailed.length || report.unexpectedErrors.length || report.httpFailures.length) { report.pass = false; process.exitCode = 1; }
    writeFileSync(resolve(out, id + '.json'), redact(JSON.stringify(report, null, 2)), { flag: 'wx' }); emit(report);
  }
  return report;
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  if (!process.argv.includes('--run')) { console.error('Explicit --run required. Main must authorize browser/API execution first.'); process.exitCode = 2; }
  else await run();
}
