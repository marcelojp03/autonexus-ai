/** CU04 browser smoke: jefe_taller plans a shift and checks availability through the BFF. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const requireApp = createRequire(resolve(root, 'web/mf-employees/package.json'));
const { chromium } = requireApp(resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
const primary = resolve(common.stdout.trim(), '..');
const accounts = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8'));
const admin = accounts.find(item => item.key === 'administrador');
const head = accounts.find(item => item.key === 'jefe_taller');
const shell = process.env.CU04_SHELL_URL ?? 'http://127.0.0.1:4200';
mkdirSync(resolve(root, 'output/playwright'), { recursive: true });

const api = async (path, method = 'GET', body, token) => {
  const response = await fetch('http://127.0.0.1:3002' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const stages = [];
let browser;
let stage = 'setup';
let employeeId;
try {
  const adminToken = (await authorize(admin)).access_token;
  const document = 'WEB04-' + randomUUID().slice(0, 8);
  const created = await api('/employees', 'POST', {
    operationId: randomUUID(), firstName: 'Synthetic', lastName: 'Planner', document,
    email: document.toLowerCase() + '@example.invalid', phone: '+591 70000000',
    jobTitle: 'Mecánico', startDate: '2020-01-01', specialties: [],
  }, adminToken);
  assert.equal(created.status, 201);
  employeeId = created.body.employee.id;
  stages.push('synthetic-active-employee');

  stage = 'login';
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push('pageerror:' + error.name));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.text().includes('403')) return;
    problems.push('console:' + message.text().slice(0, 120));
  });
  await page.goto(shell + '/employees/schedules', { waitUntil: 'domcontentloaded' });
  const login = page.locator('#session-login');
  if (await login.isVisible()) await login.click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#username').fill(head.username);
  await page.locator('#password').fill(head.password);
  await page.locator('#kc-login').click();
  await page.locator('#schedule-employee').waitFor({ state: 'visible', timeout: 40000 });
  stages.push('head-login-and-open-schedules');

  stage = 'select-employee';
  await page.locator('#schedule-search').fill(document);
  await page.locator('#schedule-search-button').click();
  await page.locator('#shift-add').waitFor({ state: 'visible', timeout: 20000 });
  stages.push('head-selects-employee');

  stage = 'create-shift';
  await page.locator('#shift-start').fill('09:00');
  await page.locator('#shift-end').fill('17:00');
  await page.locator('#shift-break-start').fill('12:00');
  await page.locator('#shift-break-end').fill('13:00');
  await page.locator('#shift-add').click();
  await page.locator('#schedule-notice').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#schedule-shifts tbody tr').first().waitFor({ state: 'visible', timeout: 20000 });
  stages.push('shift-created-from-ui');

  stage = 'availability';
  await page.locator('#schedule-date').fill('2026-11-02');
  await page.locator('#schedule-date').dispatchEvent('change');
  await page.locator('#availability-slots').waitFor({ state: 'visible', timeout: 20000 });
  const slots = await page.locator('#availability-slots').innerText();
  assert.ok(slots.includes('09:00') && slots.includes('17:00'), 'Availability must show the planned shift');
  assert.ok(!slots.includes('12:00–13:00'), 'Break must be excluded');
  stages.push('availability-from-ui');

  stage = 'absence';
  await page.locator('#absence-start').fill('2026-11-04');
  await page.locator('#absence-end').fill('2026-11-05');
  await page.locator('#absence-add').click();
  await page.locator('#schedule-absences tbody tr').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#schedule-date').fill('2026-11-04');
  await page.locator('#schedule-date').dispatchEvent('change');
  await page.locator('#availability-absent').waitFor({ state: 'visible', timeout: 20000 });
  stages.push('absence-blocks-day');

  stage = 'cu03-restriction';
  await page.goto(shell + '/employees/list', { waitUntil: 'domcontentloaded' });
  await page.locator('#employee-forbidden').waitFor({ state: 'visible', timeout: 40000 });
  stages.push('head-cannot-manage-employees');

  stage = 'console';
  assert.equal(problems.length, 0, 'Unexpected browser errors: ' + problems.join(' | '));
  stages.push('clean-console');
  await page.screenshot({ path: resolve(root, 'output/playwright/cu04-schedules.png'), fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ pass: true, stages }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage, message: String(error?.message ?? error).slice(0, 200) }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    const token = (await authorize(admin)).access_token;
    const current = (await api('/employees/' + employeeId, 'GET', undefined, token)).body;
    if (current?.status === 'active') {
      await api('/employees/' + employeeId + '/deactivate', 'POST', { operationId: randomUUID(), expectedVersion: current.version }, token);
    }
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}
