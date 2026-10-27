/**
 * Bounded UI proof: access sync failure -> retry -> updated state.
 * Real Keycloak account is disabled/enabled through the technical backend client; the
 * employee data comes from the real Employees API and PostgreSQL.
 */
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
assert.equal(common.status, 0);
const primary = resolve(common.stdout.trim(), '..');
const accounts = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/test-accounts.json'), 'utf8'));
const admin = accounts.find(item => item.key === 'administrador');
const client = JSON.parse(readFileSync(resolve(primary, 'infra/keycloak/.local/employees-client.json'), 'utf8'));
const shell = process.env.CU03_SHELL_URL ?? 'http://127.0.0.1:4200';
const api = 'http://127.0.0.1:3002';
mkdirSync(resolve(root, 'output/playwright'), { recursive: true });
const stages = [];
let browser;
let stage = 'setup';
let employeeId;

const rest = async (path, method = 'GET', body, token) => {
  const response = await fetch(api + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

async function idpToggle(subject, enabled) {
  const tokenResponse = await fetch('http://127.0.0.1:8180/realms/autonexus/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: client.clientId, client_secret: client.clientSecret }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(tokenResponse.status, 200, 'Technical client token failed');
  const token = (await tokenResponse.json()).access_token;
  const response = await fetch(`http://127.0.0.1:8180/admin/realms/autonexus/users/${encodeURIComponent(subject)}`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 204, 'IdP account toggle failed');
}

const waitAccess = async (token, predicate, timeout = 40000) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = (await rest('/employees/' + employeeId, 'GET', undefined, token)).body;
    if (predicate(last.access)) return last;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Access state not reached; last=' + JSON.stringify(last?.access));
};

try {
  const adminToken = (await authorize(admin)).access_token;
  stage = 'create-with-access';
  const document = 'RT-' + randomUUID().slice(0, 12);
  const created = await rest('/employees', 'POST', {
    operationId: randomUUID(),
    firstName: 'Synthetic',
    lastName: 'RetryFlow',
    document,
    email: document.toLowerCase() + '@example.invalid',
    phone: '+591 70000000',
    jobTitle: 'Mecánico retry',
    startDate: '2020-01-01',
    specialties: [],
    access: { requested: true },
  }, adminToken);
  assert.equal(created.status, 201);
  employeeId = created.body.employee.id;
  const synced = await waitAccess(adminToken, access => access.status === 'synced');
  assert.ok(synced.access.subject, 'Linked subject expected');
  stages.push('employee-with-synced-account');

  stage = 'disable-account';
  await idpToggle(synced.access.subject, false);
  stages.push('idp-account-disabled-out-of-band');

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
  await page.goto(shell + '/employees/' + employeeId + '/edit', { waitUntil: 'domcontentloaded' });
  const login = page.locator('#session-login');
  if (await login.isVisible()) await login.click();
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#username').fill(admin.username);
  await page.locator('#password').fill(admin.password);
  await page.locator('#kc-login').click();
  await page.locator('#jobTitle').waitFor({ state: 'visible', timeout: 40000 });
  stages.push('login-admin-and-open-record');

  stage = 'failed-sync';
  // Setup through the owner API, not the UI under test: the profile change fails while the account is disabled.
  const profileChange = await rest('/employees/' + employeeId, 'PUT', {
    operationId: randomUUID(),
    expectedVersion: synced.version,
    firstName: 'SyntheticRetry',
    lastName: synced.lastName,
    document: synced.document,
    email: synced.email,
    phone: synced.phone,
    jobTitle: synced.jobTitle,
    startDate: synced.startDate,
    specialties: synced.specialties,
  }, adminToken);
  assert.equal(profileChange.status, 200);
  const failed = await waitAccess(adminToken, access => access.status === 'failed');
  assert.equal(failed.access.errorCode, 'IDP_ACCOUNT_DISABLED');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#employee-access-retry').waitFor({ state: 'visible', timeout: 40000 });
  stages.push('failed-state-shown-with-retry');

  stage = 'retry-while-disabled';
  const attemptsBefore = failed.access.attempts;
  await page.locator('#employee-access-retry').click();
  const retried = await waitAccess(adminToken, access => access.attempts > attemptsBefore);
  assert.equal(retried.access.status, 'failed');
  stages.push('retry-attempt-recorded');

  stage = 'retry-after-enable';
  await idpToggle(synced.access.subject, true);
  await page.locator('#employee-access-retry').click();
  const recovered = await waitAccess(adminToken, access => access.status === 'synced');
  assert.equal(recovered.access.subject, synced.access.subject, 'Stable subject after retry');
  // The view refreshes after the response; wait for the retry control to disappear.
  await page.locator('#employee-access-retry').waitFor({ state: 'detached', timeout: 30000 });
  stages.push('synced-after-authorized-retry');

  stage = 'console';
  assert.equal(problems.length, 0, 'Unexpected browser errors: ' + problems.join(' | '));
  stages.push('clean-console');
  console.log(JSON.stringify({ pass: true, stages, employeeId }));
} catch (error) {
  console.error(JSON.stringify({ pass: false, stage, message: String(error?.message ?? error).slice(0, 200) }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    const token = (await authorize(admin)).access_token;
    const current = (await rest('/employees/' + employeeId, 'GET', undefined, token)).body;
    if (current?.status === 'active') {
      await rest('/employees/' + employeeId + '/deactivate', 'POST', { operationId: randomUUID(), expectedVersion: current.version }, token);
    }
  } catch {
    console.error(JSON.stringify({ cleanup: 'pending; synthetic record retained' }));
    process.exitCode = 1;
  }
}
