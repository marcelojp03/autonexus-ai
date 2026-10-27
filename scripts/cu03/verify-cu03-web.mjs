/**
 * CU03 web acceptance: Angular screen -> BFF GraphQL -> Employees REST -> PostgreSQL.
 * Real Keycloak login; credentials stay in this process and are never logged.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const requireApp = createRequire(resolve(root, 'web/mf-employees/package.json'));
/** Playwright resolves from the lockfile-pinned transitive package; no global install or upgrade. */
const playwrightEntry = resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright');
const { chromium } = requireApp(playwrightEntry);
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
assert.equal(common.status, 0);
const primary = resolve(common.stdout.trim(), '..');
const accounts = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8'));
const admin = accounts.find(item => item.key === 'administrador');
assert.ok(admin?.username && admin?.password, 'Private administrator fixture missing');

const shell = process.env.CU03_SHELL_URL ?? 'http://127.0.0.1:4200';
const shots = resolve(root, 'output/playwright');
mkdirSync(shots, { recursive: true });
const stages = [];
const problems = [];
let browser;
let stage = 'launch';
const check = (value, message = 'Acceptance failed') => assert.ok(value, message);

async function login(page) {
  await page.goto(shell + '/employees/list', { waitUntil: 'domcontentloaded' });
  const login = page.locator('#session-login');
  if (await login.isVisible()) await login.click();
  const username = page.locator('#username');
  await username.waitFor({ state: 'visible', timeout: 30000 });
  await username.fill(admin.username);
  await page.locator('#password').fill(admin.password);
  await page.locator('#kc-login').click();
  await page.locator('#employee-create').waitFor({ state: 'visible', timeout: 40000 });
}

function employeeFields(document) {
  return {
    firstName: 'Synthetic',
    lastName: 'WebDelivery',
    document,
    email: document.toLowerCase() + '@example.invalid',
    phone: '+591 70000000',
    jobTitle: 'Mecánico web',
  };
}

try {
  browser = await chromium.launch();
  const timezoneId = process.env.CU03_TZ;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(timezoneId ? { timezoneId } : {}) });
  const page = await context.newPage();
  context.on('page', p => {
    p.on('pageerror', error => problems.push('pageerror:' + error.name));
    p.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Expected diagnostics: the technical 403 probe is deliberately triggered by CU01.
      if (text.includes('403')) return;
      problems.push('console:' + text.slice(0, 120));
    });
  });

  stage = 'login';
  await login(page);
  stages.push('login-administrator');

  stage = 'create';
  const document = 'WEB-' + randomUUID();
  const fields = employeeFields(document);
  await page.locator('#employee-create').click();
  await page.locator('#firstName').fill(fields.firstName);
  await page.locator('#lastName').fill(fields.lastName);
  await page.locator('#document').fill(fields.document);
  await page.locator('#email').fill(fields.email);
  await page.locator('#phone').fill(fields.phone);
  await page.locator('#jobTitle').fill(fields.jobTitle);
  await page.locator('#startDate input').click();
  await page.locator('#startDate input').pressSequentially('01/01/2020', { delay: 40 });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await page.locator('#access-requested input').check();
  const invalidBeforeSubmit = await page.locator('#employee-form .ng-invalid[formcontrolname]').count();
  check(invalidBeforeSubmit === 0, 'Form must be valid before submit; invalid controls: ' + invalidBeforeSubmit);
  await page.locator('#employee-submit').click();
  await page.locator('#employee-saved').waitFor({ state: 'visible', timeout: 40000 });
  stages.push('create-with-access-request');

  stage = 'access-state';
  const savedText = await page.locator('#employee-saved').innerText();
  check(/guardad/i.test(savedText), 'Saving must be confirmed independently from access sync');
  const statusText = await page.locator('nz-descriptions').innerText();
  check(/sincroniz|pendiente|conflicto|sin acceso/i.test(statusText), 'Access status must be visible');
  stages.push('access-status-visible');

  stage = 'reload-persistence';
  await page.goto(shell + '/employees/list', { waitUntil: 'domcontentloaded' });
  await page.locator('#employee-search').waitFor({ state: 'visible', timeout: 40000 });
  await page.locator('#employee-search').fill(document);
  await page.locator('#employee-filter').click();
  const row = page.locator('tr[data-employee-id]', { hasText: document }).first();
  await row.waitFor({ state: 'visible', timeout: 30000 });
  check((await row.innerText()).includes(fields.lastName), 'Employee must persist after reload');
  stages.push('persistence-after-reload');

  stage = 'edit';
  await row.getByRole('button', { name: 'Editar' }).click();
  await page.locator('#jobTitle').waitFor({ state: 'visible', timeout: 30000 });
  const employeeUrl = page.url();
  await page.locator('#jobTitle').fill('Jefe de taller web');
  await page.locator('#employee-submit').click();
  await page.locator('#employee-saved').waitFor({ state: 'visible', timeout: 40000 });
  stages.push('edit-saved');

  stage = 'edit-date';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#jobTitle').waitFor({ state: 'visible', timeout: 40000 });
  const dateInput = page.locator('#startDate input');
  await dateInput.waitFor({ state: 'visible', timeout: 20000 });
  let dateValue = '';
  for (let attempt = 0; attempt < 40 && !dateValue; attempt += 1) {
    dateValue = await dateInput.inputValue();
    if (!dateValue) await page.waitForTimeout(250);
  }
  check(dateValue === '01/01/2020', 'Start date must keep the stored calendar day; got ' + dateValue);
  stages.push('edit-date-roundtrip');

  stage = 'conflict';
  const stale = await context.newPage();
  await stale.goto(employeeUrl, { waitUntil: 'domcontentloaded' });
  await stale.locator('#jobTitle').waitFor({ state: 'visible', timeout: 30000 });
  await page.goto(employeeUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#jobTitle').waitFor({ state: 'visible', timeout: 30000 });
  await stale.locator('#jobTitle').fill('Cambio desde otra pestaña');
  await stale.locator('#employee-submit').click();
  await stale.locator('#employee-saved').waitFor({ state: 'visible', timeout: 40000 });
  await page.locator('#employee-submit').click();
  await page.locator('#employee-form-error').waitFor({ state: 'visible', timeout: 30000 });
  const conflictText = await page.locator('#employee-form-error').innerText();
  check(/versión cambió/i.test(conflictText), 'Stale version must surface a conflict');
  await page.locator('#employee-reload').click();
  await page.locator('#jobTitle').waitFor({ state: 'visible', timeout: 30000 });
  stages.push('version-conflict-and-reload');
  await stale.close();

  stage = 'history';
  await page.goto(shell + '/employees/list', { waitUntil: 'domcontentloaded' });
  await page.locator('#employee-search').waitFor({ state: 'visible', timeout: 40000 });
  await page.locator('#employee-search').fill(document);
  await page.locator('#employee-filter').click();
  const updatedRow = page.locator('tr[data-employee-id]', { hasText: document }).first();
  await updatedRow.waitFor({ state: 'visible', timeout: 30000 });
  await updatedRow.getByRole('button', { name: 'Historial' }).click();
  await page.locator('#history-table tbody tr').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#history-table tr[data-history-version="2"]').first().waitFor({ state: 'visible', timeout: 20000 });
  const versions = await page.locator('#history-table tr[data-history-version]').count();
  check(versions >= 2, 'History must keep created and updated snapshots; rows: ' + versions);
  const historyText = await page.locator('#history-table').innerText();
  check(/Alta/.test(historyText) && /Modificación/.test(historyText), 'History must label the recorded actions');
  stages.push('history-snapshots');

  stage = 'deactivate';
  await page.goto(shell + '/employees/list', { waitUntil: 'domcontentloaded' });
  await page.locator('#employee-search').waitFor({ state: 'visible', timeout: 40000 });
  await page.locator('#employee-search').fill(document);
  await page.locator('#employee-filter').click();
  const finalRow = page.locator('tr[data-employee-id]', { hasText: document }).first();
  await finalRow.waitFor({ state: 'visible', timeout: 30000 });
  await finalRow.getByRole('button', { name: 'Desactivar' }).click();
  const confirm = page.locator('.ant-popover:visible .ant-btn-primary').first();
  await confirm.waitFor({ state: 'visible', timeout: 10000 });
  await confirm.click();
  await page.locator('nz-alert').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#employee-search').fill(document);
  await page.locator('#employee-filter').click();
  const inactiveRow = page.locator('tr[data-employee-id]', { hasText: document }).first();
  await inactiveRow.waitFor({ state: 'visible', timeout: 30000 });
  check(/Inactivo/.test(await inactiveRow.innerText()), 'Employee must be deactivated without deletion');
  await page.screenshot({ path: resolve(shots, 'cu03-web-list.png'), fullPage: true });
  stages.push('deactivated-history-retained');

  stage = 'console';
  check(problems.length === 0, 'Unexpected browser errors: ' + problems.join(' | '));
  stages.push('clean-console');
  stage = 'permission';
  const mechanic = accounts.find(item => item.key === 'mecanico');
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const limited = await fresh.newPage();
  await limited.goto(shell + '/employees/list', { waitUntil: 'domcontentloaded' });
  const limitedLogin = limited.locator('#session-login');
  if (await limitedLogin.isVisible()) await limitedLogin.click();
  await limited.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await limited.locator('#username').fill(mechanic.username);
  await limited.locator('#password').fill(mechanic.password);
  await limited.locator('#kc-login').click();
  await limited.waitForTimeout(9000);
  const forbidden = await limited.locator('#employee-forbidden').isVisible().catch(() => false);
  const routeError = await limited.locator('#route-error').isVisible().catch(() => false);
  const status = await limited.locator('#session-status').innerText().catch(() => '');
  check(
    forbidden || routeError || /Acceso insuficiente/i.test(status),
    'A non-administrator must not reach employee management: ' + JSON.stringify({ forbidden, routeError, status: status.slice(0, 120) }),
  );
  stages.push('insufficient-permission-blocked');
  await fresh.close();

  console.log(JSON.stringify({ pass: true, stages, document, timezone: timezoneId ?? 'system' }));
} catch (error) {
  try {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: resolve(shots, 'cu03-web-failure.png'), fullPage: true }).catch(() => {});
      const alerts = await page.locator('#employee-form-error, #employee-error, nz-alert').allInnerTexts().catch(() => []);
      const invalid = await page.locator('.ng-invalid[formcontrolname], .ng-invalid.ant-input').count().catch(() => 0);
      const bodyText = await page.locator('main').innerText().catch(() => '');
      console.error(JSON.stringify({ diagnostics: { invalidFields: invalid, alerts: alerts.map(text => text.replace(/\s+/g, ' ').slice(0, 200)), problems: problems.slice(0, 5), mainText: bodyText.replace(/\s+/g, ' ').slice(0, 300) } }));
    }
  } catch {}
  console.error(JSON.stringify({ pass: false, stage, actual: typeof error?.actual === 'string' ? error.actual.slice(0, 180) : undefined, message: String(error?.message ?? error).slice(0, 180) }));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
