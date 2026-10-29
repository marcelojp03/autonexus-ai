/** CU15 browser acceptance against the real Shell/BFF/three owner databases. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { workspace, accounts, ownerDatabase, sanitize } from './runtime.mjs';
import { createFlow } from './fixtures.mjs';
const requireApp = createRequire(resolve(workspace, 'web/mf-employees/package.json'));
const { chromium } = requireApp(resolve(workspace, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const shell = 'http://127.0.0.1:4200';
const stages = [], errors = [], failed = [], starts = [], pages = [];
const evidence = {};
const privateAccounts = accounts();
const redacted = text => sanitize(String(text).replace(/([?&#](?:code|state|session_state|session_code|access_token|id_token|refresh_token)=)[^&# ]+/gi, '$1[REDACTED]'), privateAccounts.flatMap(account => [account.password]));
let browser, fixture;
const databases = [];
async function pageFor(role, path) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/La_Paz' })).newPage(); pages.push(page);
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: redacted(error.stack ?? error.message) }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', message: redacted(message.text()) }); });
  page.on('requestfailed', request => failed.push({ path: new URL(request.url()).pathname, reason: request.failure()?.errorText }));
  page.on('request', request => {
    if (!request.url().endsWith('/graphql') || request.method() !== 'POST') return;
    const body = request.postDataJSON();
    if (body?.query.includes('startServiceConfirmation')) starts.push(body.variables.input.operationId);
  });
  await page.goto(shell + path, { waitUntil: 'domcontentloaded' });
  if (await page.locator('#session-login').isVisible()) await page.locator('#session-login').click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 45000 });
  const account = privateAccounts.find(item => item.key === role);
  await page.locator('#username').fill(account.username); await page.locator('#password').fill(account.password); await page.locator('#kc-login').click();
  return page;
}
async function choose(page) {
  await page.locator('#confirmation-order').waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('#confirmation-order option[value="' + fixture.order.id + '"]').waitFor({ state: 'attached', timeout: 30000 });
  await page.locator('#confirmation-order').selectOption(fixture.order.id);
  const quoteKey = fixture.quote.id + ':' + fixture.quote.version;
  await page.locator('#confirmation-quote option[value="' + quoteKey + '"]').waitFor({ state: 'attached' });
  await page.locator('#confirmation-quote').selectOption(quoteKey);
  await page.locator('#confirmation-mechanic-search').fill(fixture.marker); await page.locator('#confirmation-search-mechanics').click();
  await page.locator('#confirmation-mechanic option[value="' + fixture.employee.id + '"]').waitFor({ state: 'attached' });
  await page.locator('#confirmation-mechanic').selectOption(fixture.employee.id);
  await page.locator('#confirmation-mechanic-profile').waitFor({ state: 'visible' });
}
try {
  mkdirSync(resolve(workspace, 'output/playwright'), { recursive: true });
  for (const endpoint of ['http://127.0.0.1:3002/health/ready', 'http://127.0.0.1:3004/health/ready', 'http://127.0.0.1:8081/actuator/health/readiness', 'http://127.0.0.1:8000/health']) {
    let ready = false;
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      try { if ((await fetch(endpoint, { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch { /* Cold startup is not application readiness. */ }
      await pause(500);
    }
    assert.ok(ready, 'API must be ready before browser acceptance: ' + new URL(endpoint).port);
  }
  fixture = await createFlow({ prefix: 'WEB', mechanicEnabled: false });
  Object.assign(evidence, { marker: fixture.marker, orderId: fixture.order.id, quoteId: fixture.quote.id, employeeId: fixture.employee.id });
  assert.equal(fixture.employee.mechanicEnabled, false);
  browser = await chromium.launch();
  const admin = await pageFor('administrador', '/operations/confirmations');
  await choose(admin);
  await admin.locator('#confirmation-ineligible').waitFor({ state: 'visible' });
  assert.match(await admin.locator('#confirmation-ineligible').innerText(), /habilit/i);
  assert.ok(await admin.locator('#confirmation-submit').isDisabled());
  stages.push('not-enabled-mechanic-explained-and-submit-blocked');
  await admin.locator('#confirmation-edit-employee').click();
  await admin.locator('#employee-mechanic-status').waitFor({ state: 'visible', timeout: 60000 });
  assert.equal((await admin.locator('#employee-mechanic-status').innerText()).trim(), 'No habilitado');
  const checkbox = admin.locator('#employee-mechanic-enabled input[type=checkbox]');
  assert.equal(await checkbox.isChecked(), false);
  await checkbox.check();
  const saved = admin.waitForResponse(response => response.url().endsWith('/graphql') && response.request().postDataJSON()?.query.includes('updateEmployee'));
  await admin.locator('#employee-submit').click();
  const savedBody = await (await saved).json(); assert.equal(savedBody.errors, undefined, JSON.stringify(savedBody.errors));
  assert.equal(savedBody.data.updateEmployee.employee.mechanicEnabled, true);
  await admin.reload({ waitUntil: 'domcontentloaded' });
  await admin.locator('#employee-mechanic-status').waitFor({ state: 'visible', timeout: 60000 });
  assert.equal((await admin.locator('#employee-mechanic-status').innerText()).trim(), 'Habilitado');
  assert.equal(await admin.locator('#username').count(), 0, 'profile navigation/reload reuses SSO');
  const employees = await ownerDatabase('employees'); databases.push(employees);
  const labour = (await employees.query("SELECT record->>'mechanicEnabled' AS enabled,subject,(SELECT count(*) FROM employees.identity_intents i WHERE i.employee_id=r.id) AS intents FROM employees.employee_records r WHERE id=$1", [fixture.employee.id])).rows[0];
  assert.equal(labour.enabled, 'true'); assert.equal(labour.subject, null); assert.equal(Number(labour.intents), 0);
  stages.push('explicit-labour-enable-from-existing-profile-persists-without-identity-roles');
  const head = await pageFor('jefe_taller', '/operations/confirmations');
  await choose(head);
  assert.equal(await head.locator('#confirmation-ineligible').count(), 0);
  await head.locator('#confirmation-specialty').selectOption(fixture.requiredSpecialty);
  await head.locator('#confirmation-starts-at').fill(fixture.date + 'T10:00'); await head.locator('#confirmation-ends-at').fill(fixture.date + 'T11:00');
  await head.locator('#confirmation-availability').waitFor({ state: 'visible' });
  assert.match(await head.locator('#confirmation-duration').innerText(), /orientativa/);
  const accepted = head.waitForResponse(response => response.url().endsWith('/graphql') && response.request().postDataJSON()?.query.includes('startServiceConfirmation'));
  await head.locator('#confirmation-submit').click();
  const acceptedBody = await (await accepted).json(); assert.equal(acceptedBody.errors, undefined, JSON.stringify(acceptedBody.errors));
  const saga = acceptedBody.data.startServiceConfirmation;
  assert.notEqual(saga.status, 'confirmed', 'an accepted request is not service success');
  evidence.sagaId = saga.sagaId;
  stages.push('head-starts-versioned-intent-not-premature-confirmation');
  await head.locator('#confirmation-success').waitFor({ state: 'visible', timeout: 150000 });
  await head.reload({ waitUntil: 'domcontentloaded' });
  await head.locator('#confirmation-success').waitFor({ state: 'visible', timeout: 60000 });
  assert.match(await head.locator('#confirmation-saga-id').innerText(), new RegExp(saga.sagaId));
  assert.equal(starts.length, 1, 'reload/poll must not create another start');
  assert.equal(new Set(starts).size, 1);
  stages.push('confirmed-progress-survives-reload-without-new-effects');
  const operations = await ownerDatabase('operations'), finance = await ownerDatabase('finance'); databases.push(operations, finance);
  const order = (await operations.query('SELECT status,confirmation_saga_id,assignment_id,quote_link_id,quote_id,quote_version,employee_id FROM operations.work_orders WHERE id=$1', [fixture.order.id])).rows[0];
  const assignment = (await employees.query('SELECT id,status,version,order_id,employee_id,order_confirmed_observed FROM employees.employee_assignments WHERE saga_id=$1', [saga.sagaId])).rows[0];
  const link = (await finance.query('SELECT id,status,quote_id,quote_version,order_id FROM quote_confirmation_links WHERE saga_id=$1', [saga.sagaId])).rows[0];
  assert.equal(order.status, 'confirmed'); assert.equal(assignment.status, 'confirmed'); assert.equal(link.status, 'active');
  assert.equal(order.assignment_id, assignment.id); assert.equal(order.quote_link_id, link.id); assert.equal(order.quote_id, fixture.quote.id);
  assert.equal(assignment.employee_id, fixture.employee.id); assert.equal(link.quote_version, fixture.quote.version);
  const deadline = Date.now() + 40000; let notifications = 0;
  do {
    notifications = Number((await employees.query('SELECT count(*) AS n FROM employees.cu15_notifications WHERE saga_id=$1', [saga.sagaId])).rows[0].n);
    if (notifications === 1) break; await pause(500);
  } while (Date.now() < deadline);
  assert.equal(notifications, 1, 'actual order.confirmed must reach the employee Inbox');
  assert.equal((await employees.query('SELECT order_confirmed_observed FROM employees.employee_assignments WHERE saga_id=$1', [saga.sagaId])).rows[0].order_confirmed_observed, true);
  assert.equal((await finance.query('SELECT status FROM quotes WHERE id=$1', [fixture.quote.id])).rows[0].status, 'approved');
  stages.push('three-real-owners-and-outbox-inbox-confirmed-references');
  await head.screenshot({ path: resolve(workspace, 'output/playwright/cu15-confirmed-desktop.png'), fullPage: true });
  await head.setViewportSize({ width: 390, height: 844 }); await head.screenshot({ path: resolve(workspace, 'output/playwright/cu15-confirmed-mobile.png'), fullPage: true });
  const storageSafe = await head.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].every(value => !/eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.]/.test(value)));
  assert.ok(storageSafe, 'no persisted browser tokens');
  assert.deepEqual(errors, []); assert.ok(failed.every(item => item.reason === 'net::ERR_ABORTED'));
  stages.push('desktop-mobile-evidence-clean-console-and-ram-only-token');
  console.log(JSON.stringify({ pass: true, stages, evidence }));
} catch (error) { process.exitCode = 1; console.error(JSON.stringify({ pass: false, stages, evidence, error: redacted(error?.stack ?? error) })); }
finally {
  const state = await Promise.all(pages.map(async page => ({ path: new URL(page.url()).pathname, errors: await page.locator('#confirmation-error,#confirmation-reason').allTextContents().catch(() => []) })));
  mkdirSync(resolve(workspace, 'output/cu15'), { recursive: true });
  writeFileSync(resolve(workspace, 'output/cu15/browser-real.json'), JSON.stringify({ pass: !process.exitCode, stages, evidence, errors, failed, starts, state }, null, 2));
  await browser?.close(); await Promise.all(databases.map(db => db.end()));
}
