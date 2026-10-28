/** Proves the React microfrontend mounts inside the Shell with the shared session. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const requireApp = createRequire(resolve(root, 'web/mf-employees/package.json'));
const { chromium } = requireApp(resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const accounts = JSON.parse(readFileSync('C:/UAGRM/Ingenieria de Software 2/segundo parcial/autonexus-ai/infra/keycloak/.local/test-accounts.json', 'utf8'));
const reception = accounts.find(item => item.key === 'recepcionista');
const stages = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.name + ':' + error.message.slice(0, 120)));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('403')) errors.push('console:' + message.text().slice(0, 120)); });

  await page.goto('http://127.0.0.1:4200/finance', { waitUntil: 'domcontentloaded' });
  const login = page.locator('#session-login');
  if (await login.isVisible()) await login.click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#username').fill(reception.username);
  await page.locator('#password').fill(reception.password);
  await page.locator('#kc-login').click();
  await page.locator('[data-mf="finance"]', { hasText: 'Cotizaciones' }).waitFor({ state: 'visible', timeout: 45000 });
  stages.push('react-mounted-at-finance');

  await page.locator('#quote-scope-notice').waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.locator('#signin, #login, #kc-login').count(), 0, 'no second login inside the microfrontend');
  stages.push('no-second-login-and-scope-notice');

  await page.locator('a[data-operations-link]', { hasText: 'Clientes' }).click();
  await page.locator('#customer-table').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await page.locator('[data-mf="finance"]').isVisible(), false, 'finance unmounts when leaving');
  stages.push('angular-mount-after-react-unmount');

  await page.locator('a[data-finance-link]', { hasText: 'Finanzas' }).click();
  await page.locator('[data-mf="finance"]', { hasText: 'Cotizaciones' }).waitFor({ state: 'visible', timeout: 45000 });
  stages.push('react-remount');

  await page.goBack();
  await page.locator('#customer-table').waitFor({ state: 'visible', timeout: 30000 });
  await page.goForward();
  await page.locator('[data-mf="finance"]', { hasText: 'Cotizaciones' }).waitFor({ state: 'visible', timeout: 45000 });
  stages.push('history-back-forward');

  assert.deepEqual(errors, [], 'console must stay clean: ' + errors.join(' | '));
  stages.push('no-console-errors');
  console.log(JSON.stringify({ pass: true, stages }));
} catch (error) {
  console.error(JSON.stringify({ diag: { errors: typeof errors !== 'undefined' ? errors : null, html: typeof page !== 'undefined' ? (await page.locator('#mf-finance').innerHTML().catch(() => '')).slice(0, 300) : null, status: typeof page !== 'undefined' ? await page.locator('#load-status').textContent().catch(() => null) : null } }));
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 300) }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
setImmediate(() => process.exit(process.exitCode ?? 0));
