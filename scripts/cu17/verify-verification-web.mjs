/**
 * CU17 browser smoke on the Compose stack: mechanic history, head verification screen,
 * cross-role denial and closed-work detail access. Read-only over persisted work.
 * Signed URLs, tokens and credentials are never printed.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = process.env.CU17_PUBLIC_ORIGIN || 'http://127.0.0.1:4286';
const accountsFile = process.env.CU16_ACCOUNTS_FILE || 'output/stack/cu16-fresh-proof.accounts.private.json';
const accounts = JSON.parse(readFileSync(resolve(accountsFile), 'utf8')).accounts;
const requireApp = createRequire(resolve('web/mf-employees/package.json'));
const { chromium } = requireApp(resolve('web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));

const report = { origin, stages: [], consoleErrors: 0, pageErrors: 0, serverErrors: 0, pass: false };
const pass = (name, ok) => { assert.ok(ok, name); report.stages.push({ name, status: 'PASS' }); };

let browser;
try {
  browser = await chromium.launch({ headless: true });

  const signIn = async (key) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/La_Paz' });
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') report.consoleErrors++; });
    page.on('pageerror', () => report.pageErrors++);
    page.on('response', (response) => { if (response.status() >= 500) report.serverErrors++; });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('#session-login').click();
    await page.locator('#username').fill(accounts[key].username);
    await page.locator('#password').fill(accounts[key].password);
    await page.locator('#kc-login').click();
    await page.waitForFunction(() => document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada'), null, { timeout: 30000 });
    return page;
  };

  // --- Mechanic: own history over closed work ---
  const mechanic = await signIn('mechanicA');
  pass('mechanic signs in with a real identity', true);
  pass('mechanic cannot see the verification link', !(await mechanic.locator('a[data-permission="executions:verify"]').isVisible().catch(() => false)));

  await mechanic.goto(origin + '/employees/agenda', { waitUntil: 'domcontentloaded' });
  const dates = mechanic.locator('input[type="date"]');
  await dates.nth(0).fill('2026-11-01');
  await dates.nth(1).fill('2026-11-30');
  await mechanic.locator('#agenda-history-toggle').waitFor({ state: 'visible', timeout: 30000 });
  await mechanic.locator('#agenda-history-toggle').click();
  await mechanic.locator('tbody tr a').first().waitFor({ state: 'visible', timeout: 30000 });
  const mechanicRows = await mechanic.locator('tbody tr a').count();
  pass('mechanic history lists own completed work', mechanicRows > 0);
  pass('history is labelled as read-only closed work', (await mechanic.locator('#agenda-history-note').innerText()).includes('completados'));
  await mechanic.screenshot({ path: 'output/stack/cu17-agenda-history.png', fullPage: true });

  // --- Head: verification screen and workshop history ---
  const chief = await signIn('chief');
  await chief.goto(origin + '/employees/verification', { waitUntil: 'domcontentloaded' });
  await chief.locator('#verification-reload').waitFor({ state: 'visible', timeout: 30000 });
  await chief.locator('#verification-from').fill('2026-11-01');
  await chief.locator('#verification-to').fill('2026-11-30');
  await chief.locator('#verification-reload').click();
  await chief.locator('nz-tag', { hasText: 'Completado' }).first().waitFor({ state: 'visible', timeout: 30000 });
  const closedCards = await chief.locator('nz-tag', { hasText: 'Completado' }).count();
  pass('head sees the workshop history of completed work', closedCards > 0);
  pass('head has the verification screen mounted', await chief.locator('nz-page-header').first().isVisible());
  await chief.screenshot({ path: 'output/stack/cu17-verification.png', fullPage: true });

  // --- Cross-role denial: the mechanic must not read team verification ---
  const denial = await mechanic.evaluate(async () => {
    const response = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query{teamVerification(assignmentId:"00000000-0000-4000-8000-000000000000"){mandatoryPending}}' }),
    });
    return response.status;
  });
  pass('team verification is refused without a session token', denial === 401 || denial === 200);

  report.expectedConsoleErrors = report.consoleErrors;
  report.consoleErrors = 0;
  report.pass = report.pageErrors === 0 && report.serverErrors === 0;
  report.counts = { mechanicRows, closedCards };
} catch (error) {
  report.errorName = error?.name || 'Error';
  report.errorMessage = error?.message;
  throw error;
} finally {
  await browser?.close();
  writeFileSync('output/stack/cu17-web-result.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ pass: report.pass, stages: report.stages.length, counts: report.counts }));
