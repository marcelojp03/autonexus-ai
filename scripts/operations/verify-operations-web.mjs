/** Operations browser smoke: CU06, CU07, CU09 and CU10 through the Shell. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const requireApp = createRequire(resolve(root, 'web/mf-operations/package.json'));
const { chromium } = requireApp(resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const { Client } = createRequire(resolve(root, 'services/employees/package.json'))('pg');
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
const primary = resolve(common.stdout.trim(), '..');
const accounts = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8'));
const env = {};
for (const line of readFileSync(resolve(primary, 'services/operations/.env'), 'utf8').split(/\r?\n/)) {
  const at = line.indexOf('=');
  if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1);
}
const shell = process.env.CU06_SHELL_URL ?? 'http://127.0.0.1:4200';
const suffix = randomUUID().slice(0, 6).toUpperCase();
const document = 'W6' + suffix;
const plate = 'W7' + suffix;
const serviceName = 'Smoke ' + suffix;
mkdirSync(resolve(root, 'output/playwright'), { recursive: true });

const stages = [];
const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });
const ids = { customer: null, vehicle: null, service: null, appointment: null };
let browser;

const login = async (page, account) => {
  const button = page.locator('#session-login');
  if (await button.isVisible()) await button.click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#username').fill(account.username);
  await page.locator('#password').fill(account.password);
  await page.locator('#kc-login').click();
};

const selectOption = async (page, selectId, text) => {
  await page.locator(`#${selectId} .ant-select-selector`).click();
  const option = page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: text }).first();
  await option.waitFor({ state: 'visible', timeout: 15000 });
  await option.click();
};

try {
  await db.connect();
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push('pageerror:' + error.name));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.text().includes('403')) return;
    problems.push('console:' + message.text().slice(0, 140));
  });

  await page.goto(shell + '/operations/customers', { waitUntil: 'domcontentloaded' });
  await login(page, accounts.find(item => item.key === 'recepcionista'));
  await page.locator('#customer-table').waitFor({ state: 'visible', timeout: 40000 });
  stages.push('reception-opens-customers');

  await page.locator('#customer-first-name').fill('Smoke');
  await page.locator('#customer-last-name').fill('Cliente' + suffix);
  await page.locator('#customer-document').fill(document);
  await page.locator('#customer-phone').fill('+591 70000099');
  await page.locator('#customer-save').click();
  await page.locator('#customer-notice').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#customer-search').fill(document);
  await page.locator('#customer-search-button').click();
  const customerRow = page.locator(`[data-customer-document="${document}"]`);
  await customerRow.waitFor({ state: 'visible', timeout: 20000 });
  ids.customer = await db.query("SELECT id FROM operations.customers WHERE document=$1", [document]).then(result => result.rows[0].id);
  stages.push('customer-registered-from-ui');

  await page.goto(shell + '/operations/vehicles', { waitUntil: 'domcontentloaded' });
  await page.locator('#vehicle-table').waitFor({ state: 'visible', timeout: 30000 });
  await selectOption(page, 'vehicle-owner', 'Smoke Cliente' + suffix);
  await page.locator('#vehicle-plate').fill(plate);
  await page.locator('#vehicle-make').fill('Chevrolet');
  await page.locator('#vehicle-model').fill('Onix');
  await page.locator('#vehicle-year').fill('2023');
  await page.locator('#vehicle-save').click();
  await page.locator('#vehicle-notice').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#vehicle-search').fill(plate);
  await page.locator('#vehicle-search-button').click();
  await page.locator(`[data-vehicle-plate="${plate}"]`).waitFor({ state: 'visible', timeout: 20000 });
  ids.vehicle = await db.query('SELECT id FROM operations.vehicles WHERE plate=$1', [plate]).then(result => result.rows[0].id);
  stages.push('vehicle-associated-to-customer');

  const headContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const headPage = await headContext.newPage();
  await headPage.goto(shell + '/operations/catalog', { waitUntil: 'domcontentloaded' });
  await login(headPage, accounts.find(item => item.key === 'jefe_taller'));
  await headPage.locator('#catalog-table').waitFor({ state: 'visible', timeout: 40000 });
  await headPage.locator('#catalog-name').fill(serviceName);
  await headPage.locator('#catalog-description').fill('Servicio creado por jefatura');
  await headPage.locator('#catalog-minutes').fill('30');
  await headPage.locator('#catalog-rate').fill('75.50');
  await headPage.locator('#catalog-save').click();
  await headPage.locator('#catalog-notice').waitFor({ state: 'visible', timeout: 30000 });
  await headPage.locator('#catalog-search').fill(serviceName);
  await headPage.locator('#catalog-search-button').click();
  await headPage.locator(`[data-service-name="${serviceName}"]`).waitFor({ state: 'visible', timeout: 20000 });
  ids.service = await db.query('SELECT id FROM operations.service_catalog WHERE name=$1', [serviceName]).then(result => result.rows[0].id);
  await headContext.close();
  stages.push('service-created-by-head');

  await page.goto(shell + '/operations/appointments', { waitUntil: 'domcontentloaded' });
  await page.locator('#appointment-table').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#appointment-from').fill('2026-12-01');
  await page.locator('#appointment-to').fill('2026-12-31');
  await page.locator('#appointment-search-button').click();
  await selectOption(page, 'appointment-customer', 'Smoke Cliente' + suffix);
  await selectOption(page, 'appointment-vehicle', plate);
  await selectOption(page, 'appointment-service', serviceName);
  await page.locator('#appointment-starts-at').fill('2026-12-20T09:00');
  await page.locator('#appointment-notes').fill('Cita de smoke');
  await page.locator('#appointment-save').click();
  await page.locator('#appointment-notice').waitFor({ state: 'visible', timeout: 30000 });
  const appointmentRow = page.locator('[data-appointment-status="scheduled"]', { hasText: plate }).first();
  await appointmentRow.waitFor({ state: 'visible', timeout: 20000 });
  ids.appointment = await db.query('SELECT id FROM operations.appointments WHERE vehicle_id=$1 ORDER BY created_at DESC', [ids.vehicle]).then(result => result.rows[0].id);
  stages.push('appointment-scheduled-from-ui');

  await page.locator(`[data-appointment-reschedule="${ids.appointment}"]`).click();
  await page.locator('#appointment-reschedule-at').fill('2026-12-20T11:00');
  await page.locator('#appointment-reschedule-save').click();
  await page.locator('#appointment-notice', { hasText: 'reprogramada' }).waitFor({ state: 'visible', timeout: 30000 });
  const rescheduled = await db.query('SELECT version, starts_at FROM operations.appointments WHERE id=$1', [ids.appointment]);
  assert.equal(rescheduled.rows[0].version, 2);
  stages.push('appointment-rescheduled-from-ui');

  await page.locator('#appointment-cancel-reason').fill('El cliente reprogramó por viaje');
  await page.locator(`[data-appointment-cancel="${ids.appointment}"]`).click();
  const confirm = page.locator('.ant-popover:visible .ant-btn-primary');
  await confirm.waitFor({ state: 'visible', timeout: 15000 });
  await confirm.click();
  await page.locator('#appointment-notice', { hasText: 'cancelada' }).waitFor({ state: 'visible', timeout: 30000 });
  const cancelled = await db.query('SELECT status, cancel_reason FROM operations.appointments WHERE id=$1', [ids.appointment]);
  assert.equal(cancelled.rows[0].status, 'cancelled');
  assert.equal(cancelled.rows[0].cancel_reason, 'El cliente reprogramó por viaje');
  stages.push('appointment-cancelled-with-reason');

  const deniedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const deniedPage = await deniedContext.newPage();
  await deniedPage.goto(shell + '/operations/customers', { waitUntil: 'domcontentloaded' });
  await login(deniedPage, accounts.find(item => item.key === 'mecanico'));
  await deniedPage.locator('#customer-error').waitFor({ state: 'visible', timeout: 40000 });
  assert.ok((await deniedPage.locator('#customer-error').textContent()).includes('permiso'));
  await deniedContext.close();
  stages.push('mechanic-denied-by-server-policy');

  assert.deepEqual(problems, [], 'browser console must stay clean');
  stages.push('no-console-errors');
  await page.screenshot({ path: resolve(root, 'output/playwright/cu06-operations.png'), fullPage: true });

  console.log(JSON.stringify({ pass: true, stages, ids, document, plate, serviceName }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 320) }));
  process.exitCode = 1;
} finally {
  try {
    await browser?.close();
    if (ids.appointment) await db.query("UPDATE operations.appointments SET status='cancelled', cancel_reason=coalesce(cancel_reason,'cleanup') WHERE id=$1", [ids.appointment]);
    if (ids.vehicle) await db.query("UPDATE operations.vehicles SET status='inactive' WHERE id=$1", [ids.vehicle]);
    if (ids.customer) await db.query("UPDATE operations.customers SET status='inactive' WHERE id=$1", [ids.customer]);
    if (ids.service) await db.query('UPDATE operations.service_catalog SET active=false WHERE id=$1', [ids.service]);
    await db.end();
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}
