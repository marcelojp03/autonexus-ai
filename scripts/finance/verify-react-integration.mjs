/** Proves the React microfrontend mounts inside the Shell with the shared session. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const requireApp = createRequire(resolve(root, 'web/mf-employees/package.json'));
const { chromium } = requireApp(resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const accounts = JSON.parse(readFileSync(resolve(common, '../infra/keycloak/.local/test-accounts.json'), 'utf8'));
const account = accounts.find(item => item.key === 'administrador');
const stages = [];
const browser = await chromium.launch();
let page;
const errors = [];
const failedRequests = [];
const responses = [];
const observations = [];
const observe = async label => {
  const state = await page.evaluate(() => ({ events: window.__integrationEvents, financeHost: { hidden: document.getElementById('mf-finance')?.hidden, shadowChildren: document.getElementById('mf-finance')?.shadowRoot?.childElementCount }, externalPortals: document.querySelectorAll('body > .ant-select-dropdown, body > .ant-message').length }));
  observations.push({ label, ...state });
  return state;
};
const pathOnly = value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return '[invalid URL]'; } };
const redact = value => String(value).replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted]').replace(/([?&#](?:code|state|session_state|session_code|token|access_token|refresh_token|id_token)=)[^&#\s]+/gi, '$1[redacted]');
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  await page.addInitScript(() => {
    window.__integrationEvents = [];
    for (const name of ['autonexus:lifecycle', 'single-spa:routing-event']) {
      window.addEventListener(name, event => window.__integrationEvents.push({ name, detail: name === 'single-spa:routing-event' ? event.detail?.newAppStatuses : event.detail }));
    }
  });
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: redact(error.stack ?? error.message) }));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push({ type: message.type(), message: redact(message.text()) }); });
  page.on('requestfailed', request => failedRequests.push({ url: pathOnly(request.url()), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) responses.push({ url: pathOnly(response.url()), status: response.status() }); });

  await page.goto('http://127.0.0.1:4200/finance', { waitUntil: 'domcontentloaded' });
  const login = page.locator('#session-login');
  if (await login.isVisible()) await login.click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#username').fill(account.username);
  await page.locator('#password').fill(account.password);
  await page.locator('#kc-login').click();
  await page.waitForURL(url => url.origin === 'http://127.0.0.1:4200' && url.pathname !== '/auth/callback', { timeout: 30000 });
  const exports = await page.evaluate(async () => Object.keys(await import('/mfs/finance/main.js')));
  assert.ok(['bootstrap', 'mount', 'unmount'].every(name => exports.includes(name)), 'served ESM lifecycle exports: ' + exports.join(','));
  stages.push('served-esm-exports');
  await page.locator('[data-mf="finance"]', { hasText: 'Cotizaciones' }).waitFor({ state: 'visible', timeout: 45000 });
  stages.push('react-mounted-at-finance');
  const mounted = await observe('first-mount');
  assert.ok(mounted.events.some(event => event.detail?.['@autonexus/finance'] === 'MOUNTED'), 'single-spa reports MOUNTED');
  assert.ok(mounted.events.some(event => event.detail?.phase === 'mount:start' && event.detail.host === 'mf-finance' && event.detail.connected && event.detail.basePath === '/finance'), 'mount receives the connected finance host and own base path');
  assert.equal(mounted.externalPortals, 0);

  await page.locator('#quote-scope-notice').waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.locator('#signin, #login, #kc-login').count(), 0, 'no second login inside the microfrontend');
  stages.push('no-second-login-and-scope-notice');

  await page.locator('a[data-module="operations"]').click();
  await page.locator('a[data-operations-link]', { hasText: 'Clientes' }).click();
  await page.locator('#customer-table').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await page.locator('[data-mf="finance"]').isVisible(), false, 'finance unmounts when leaving');
  const left = await observe('after-unmount');
  assert.equal(left.financeHost.shadowChildren, 0, 'unmount destroys the React tree and styles');
  assert.ok(left.events.some(event => event.detail?.app === '@autonexus/finance' && event.detail.phase === 'unmount:end'));
  stages.push('angular-mount-after-react-unmount');
  for (const [label, marker] of [['Vehículos', '#vehicle-table'], ['Catálogo', '#catalog-table'], ['Citas', '#appointment-table'], ['Clientes', '#customer-table']]) {
    await page.locator('a[data-operations-link]', { hasText: label }).click();
    await page.locator(marker).waitFor({ state: 'visible', timeout: 30000 });
  }
  stages.push('operations-existing-routes-readonly-smoke');
  await page.goBack();
  await page.locator('#appointment-table').waitFor({ state: 'visible', timeout: 30000 });
  await page.goForward();
  await page.locator('#customer-table').waitFor({ state: 'visible', timeout: 30000 });
  stages.push('angular-own-routes-history-back-forward');

  await page.locator('a[data-module="finance"]').click();
  await page.locator('[data-mf="finance"]', { hasText: 'Cotizaciones' }).waitFor({ state: 'visible', timeout: 45000 });
  stages.push('react-remount');

  await page.goBack();
  await page.locator('#customer-table').waitFor({ state: 'visible', timeout: 30000 });
  await page.goForward();
  await page.locator('[data-mf="finance"]', { hasText: 'Cotizaciones' }).waitFor({ state: 'visible', timeout: 45000 });
  stages.push('history-back-forward');
  await observe('history-roundtrip');
  await page.locator('a[data-module="employees"]').click();
  await page.locator('#employee-create').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('a[data-employee-link]', { hasText: 'Horarios' }).click();
  await page.locator('#schedule-employee').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('a[data-employee-link]', { hasText: 'Seguridad' }).click();
  await page.locator('#security-roles').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('a[data-module="finance"]').click();
  await page.locator('[data-mf="finance"]').waitFor({ state: 'visible', timeout: 30000 });
  stages.push('employees-angular-and-return-without-login');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-mf="finance"]').waitFor({ state: 'visible', timeout: 45000 });
  assert.equal(new URL(page.url()).pathname, '/finance', 'reload retains finance route with SSO');
  stages.push('direct-link-and-reload');
  await observe('reloaded-mount');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.evaluate(() => ({ viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, headStyles: document.querySelectorAll('head style[data-css-hash]').length, headerColor: getComputedStyle(document.querySelector('.shell-header')).backgroundColor }));
    observations.push({ label: 'layout-' + width, ...layout });
    assert.ok(layout.pageWidth <= layout.viewport + 1, 'no page-level horizontal overflow at ' + width);
    assert.equal(layout.headStyles, 0, 'AntD styles stay inside the React shadow root');
    assert.equal(layout.headerColor, 'rgb(0, 21, 41)', 'template CSS does not recolor the Shell');
  }
  stages.push('desktop-mobile-layout-and-css-isolation');
  assert.deepEqual(responses, [], 'all resources return successful HTTP responses');
  assert.ok(failedRequests.every(request => request.error === 'net::ERR_ABORTED'), 'only navigation cancellations are expected');
  assert.deepEqual(errors.filter(error => error.type !== 'warning'), [], 'console must stay clean');
  stages.push('no-console-errors');
  console.log(JSON.stringify({ pass: true, stages }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 300) }));
  process.exitCode = 1;
} finally {
  const diag = { stages, errors, failedRequests, responses, observations, url: page ? pathOnly(page.url()) : null,
    state: page ? await page.evaluate(() => ({ events: window.__integrationEvents, angularIds: [...(document.querySelector('anx-operations-root')?.shadowRoot?.querySelectorAll('[id]') ?? [])].map(element => element.id), host: document.getElementById('mf-finance') ? { hidden: document.getElementById('mf-finance').hidden, children: document.getElementById('mf-finance').childElementCount, shadowChildren: document.getElementById('mf-finance').shadowRoot?.childElementCount } : null, status: document.getElementById('load-status')?.textContent })).catch(error => ({ error: redact(error.message) })) : null };
  mkdirSync(resolve(root, 'output/playwright'), { recursive: true });
  writeFileSync(resolve(root, 'output/playwright/react-integration-diagnostic.json'), JSON.stringify(diag, null, 2));
  console.log(JSON.stringify({ diagnostic: 'output/playwright/react-integration-diagnostic.json', errors, failedRequests, responses }));
  await browser.close();
}
setImmediate(() => process.exit(process.exitCode ?? 0));
