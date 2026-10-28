/** CU02 browser verification: administrator manages roles, permissions and assignments from the UI. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const requireApp = createRequire(resolve(root, 'web/mf-employees/package.json'));
const { chromium } = requireApp(resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const { Client } = createRequire(resolve(root, 'services/employees/package.json'))('pg');
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
const primary = resolve(common.stdout.trim(), '..');
const accounts = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8'));
const technical = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/employees-client.json'), 'utf8'));
const env = {};
for (const line of readFileSync(resolve(primary, 'services/employees/.env'), 'utf8').split(/\r?\n/)) {
  const at = line.indexOf('=');
  if (at > 0) env[line.slice(0, at).trim()] = line.slice(at + 1);
}
const admin = accounts.find(item => item.key === 'administrador');
const head = accounts.find(item => item.key === 'jefe_taller');
const shellUrl = process.env.CU02_SHELL_URL ?? 'http://127.0.0.1:4200';
const apiBase = 'http://127.0.0.1:3002';
const idp = 'http://127.0.0.1:8180';
mkdirSync(resolve(root, 'output/playwright'), { recursive: true });

const suffix = randomUUID().slice(0, 8);
const roleName = 'web_' + suffix;
const document = 'WB-' + suffix;
const db = new Client({ host: env.DB_HOST, port: Number(env.DB_PORT), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });
let employeeId;
const stages = [];
let browser;

const api = async (path, method = 'GET', body, token) => {
  const response = await fetch(apiBase + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};
const idpHeaders = async () => {
  const response = await fetch(idp + '/realms/autonexus/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: technical.clientId, client_secret: technical.clientSecret }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  return { Authorization: 'Bearer ' + (await response.json()).access_token };
};
const selectOption = async (page, selectId, text) => {
  await page.locator(`#${selectId} .ant-select-selector`).click();
  const option = page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: text }).first();
  await option.waitFor({ state: 'visible', timeout: 15000 });
  await option.click();
};

try {
  await db.connect();
  const adminToken = (await authorize(admin)).access_token;
  const created = await api('/employees', 'POST', {
    operationId: randomUUID(), firstName: 'Synthetic', lastName: 'Security', document,
    email: document.toLowerCase() + '@example.invalid', phone: '+591 70000003',
    jobTitle: 'Supervisor', startDate: '2020-01-01', specialties: [], access: { requested: true },
  }, adminToken);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  employeeId = created.body.employee.id;
  let employee = created.body.employee;
  for (let attempt = 0; attempt < 20 && employee.access.status !== 'synced'; attempt += 1) {
    await new Promise(done => setTimeout(done, 500));
    employee = (await api('/employees/' + employeeId, 'GET', undefined, adminToken)).body;
  }
  assert.equal(employee.access.status, 'synced', 'linked identity required for assignment');
  stages.push('synthetic-employee-with-identity');

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
  await page.goto(shellUrl + '/employees/security', { waitUntil: 'domcontentloaded' });
  const login = page.locator('#session-login');
  if (await login.isVisible()) await login.click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#username').fill(admin.username);
  await page.locator('#password').fill(admin.password);
  await page.locator('#kc-login').click();
  await page.locator('#security-validity').waitFor({ state: 'visible', timeout: 40000 });
  await page.locator('[data-role-name="administrador"]').waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await page.locator('#security-forbidden').count(), 0);
  const initialRoles = await page.locator('#security-roles tbody tr[data-role-name]').count();
  assert.ok(initialRoles >= 5, 'initial roles must be listed');
  stages.push('administrator-opens-security-section');

  await page.locator('#security-role-name').fill(roleName);
  await page.locator('#security-role-description').fill('Verificación CU02');
  await page.locator('[data-permission="schedules:read"]').click();
  await page.locator('#security-save').waitFor({ state: 'visible' });
  await page.locator('#security-save').click();
  await page.locator('#security-notice').waitFor({ state: 'visible', timeout: 30000 });
  const row = page.locator(`[data-role-name="${roleName}"]`);
  await row.waitFor({ state: 'visible', timeout: 20000 });
  assert.equal(await row.locator('[data-role-sync]').getAttribute('data-role-sync'), 'synced');
  assert.ok((await row.locator('[data-role-permission]').allTextContents()).includes('schedules:read'));
  stages.push('role-created-and-synced-from-ui');

  await page.locator('#security-employee-search').fill(document);
  await page.locator('#security-employee-search-button').click();
  const pick = page.locator(`[data-select-employee="${employeeId}"]`);
  await pick.waitFor({ state: 'visible', timeout: 20000 });
  await pick.click();
  await page.locator('#security-assignments').waitFor({ state: 'visible', timeout: 20000 });
  await selectOption(page, 'security-assign-role', roleName);
  await page.locator('#security-assign-button').click();
  const assignment = page.locator(`[data-assignment-role="${roleName}"]`);
  await assignment.waitFor({ state: 'visible', timeout: 30000 });
  stages.push('role-assigned-from-ui');

  await page.locator('#security-employee-search').fill(document);
  await page.locator('#security-employee-search-button').click();
  await page.locator(`[data-select-employee="${employeeId}"]`).click();
  await page.locator(`[data-assignment-role="${roleName}"]`).waitFor({ state: 'visible', timeout: 20000 });
  await page.locator(`[data-revoke-role="${roleName}"]`).click();
  const confirm = page.locator('.ant-popover:visible .ant-btn-primary');
  await confirm.waitFor({ state: 'visible', timeout: 15000 });
  await confirm.click();
  await page.locator(`[data-assignment-role="${roleName}"]`).waitFor({ state: 'detached', timeout: 30000 });
  await page.locator('#security-notice').waitFor({ state: 'visible', timeout: 20000 });
  stages.push('role-revoked-from-ui');

  const employeeRoles = await api(`/security/employees/${employeeId}/roles`, 'GET', undefined, adminToken);
  assert.equal(employeeRoles.body.items.filter(item => item.status === 'active').length, 0);
  const history = await api('/security/history?roleName=' + roleName, 'GET', undefined, adminToken);
  const actions = history.body.items.map(item => item.action);
  for (const action of ['role-created', 'role-assigned', 'role-revoked']) {
    assert.ok(actions.includes(action), 'REST audit action expected: ' + action);
  }
  stages.push('audit-persisted-in-owner');

  const deniedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const deniedPage = await deniedContext.newPage();
  await deniedPage.goto(shellUrl + '/employees/security', { waitUntil: 'domcontentloaded' });
  const deniedLogin = deniedPage.locator('#session-login');
  if (await deniedLogin.isVisible()) await deniedLogin.click();
  await deniedPage.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await deniedPage.locator('#username').fill(head.username);
  await deniedPage.locator('#password').fill(head.password);
  await deniedPage.locator('#kc-login').click();
  await deniedPage.locator('#security-forbidden').waitFor({ state: 'visible', timeout: 40000 });
  assert.equal(await deniedPage.locator('#security-roles').count(), 0);
  await deniedContext.close();
  stages.push('head-denied-by-server-policy');

  assert.deepEqual(problems, [], 'browser console must stay clean');
  stages.push('no-console-errors');

  await page.screenshot({ path: resolve(root, 'output/playwright/cu02-security.png'), fullPage: true });
  const current = (await api('/employees/' + employeeId, 'GET', undefined, adminToken)).body;
  const deactivated = await api('/employees/' + employeeId + '/deactivate', 'POST', {
    operationId: randomUUID(), expectedVersion: current.version,
  }, adminToken);
  assert.equal(deactivated.status, 200);
  stages.push('synthetic-employee-deactivated');

  console.log(JSON.stringify({ pass: true, stages, employeeId, roleName }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage: stages.length, message: String(error?.message ?? error).slice(0, 320) }));
  process.exitCode = 1;
} finally {
  try {
    await browser?.close();
    if (employeeId) {
      await db.query('DELETE FROM employees.security_history WHERE employee_id=$1', [employeeId]);
      await db.query('DELETE FROM employees.security_role_assignments WHERE employee_id=$1', [employeeId]);
    }
    await db.query('DELETE FROM employees.security_history WHERE role_name=$1 AND employee_id IS NULL', [roleName]);
    await db.query('DELETE FROM employees.security_roles WHERE name=$1 AND system=false', [roleName]);
    const headers = await idpHeaders().catch(() => null);
    if (headers) {
      await fetch(idp + '/admin/realms/autonexus/roles/' + encodeURIComponent(roleName), { method: 'DELETE', headers, signal: AbortSignal.timeout(8000) });
    }
    await db.end();
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending' }));
  }
}
