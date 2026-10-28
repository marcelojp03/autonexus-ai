/** Real standalone Finance document, shared SessionPort helper and Keycloak SSO. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = process.cwd();
const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const accounts = JSON.parse(readFileSync(resolve(common, '../infra/keycloak/.local/test-accounts.json'), 'utf8'));
const account = accounts.find(item => item.key === 'responsable_financiero');
const { chromium } = createRequire(resolve(root, 'web/mf-employees/package.json'))(resolve(root, 'web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));
const browser = await chromium.launch();
const stages = [], errors = [], auth = [], business = [], failedRequests = [];
const claims = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, reason: request.failure()?.errorText }));
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ type: 'console', message: message.text() }); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/protocol/openid-connect/auth')) auth.push({ client: url.searchParams.get('client_id'), method: url.searchParams.get('code_challenge_method'), redirect: url.searchParams.get('redirect_uri') });
  });
  page.on('response', async response => {
    if (response.url().endsWith('/protocol/openid-connect/token')) {
      const body = await response.json().catch(() => ({}));
      const token = body.access_token;
      if (token) {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        claims.push({ status: response.status(), hasSubject: typeof payload.sub === 'string', hasUsername: typeof payload.preferred_username === 'string', audiences: payload.aud, roles: payload.realm_access?.roles });
      } else claims.push({ status: response.status() });
    }
    if (response.url().endsWith('/graphql') && response.request().method() === 'POST') {
      const result = await response.json().catch(() => ({}));
      business.push({ fields: Object.keys(result.data ?? {}), errors: result.errors?.map(error => error.extensions?.code) ?? [] });
    }
  });
  await page.goto('http://127.0.0.1:4204/finance', { waitUntil: 'domcontentloaded' });
  await page.locator('#username').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#username').fill(account.username);
  await page.locator('#password').fill(account.password);
  await page.locator('#kc-login').click();
  await page.locator('[data-mf="finance"]').waitFor({ state: 'visible', timeout: 45000 });
  await page.locator('#quotes-reload:not([disabled])').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('mf-finance')?.shadowRoot?.querySelectorAll('[data-testid^="quote-select-"]').length > 0);
  assert.ok(auth.some(item => item.client === 'autonexus-mf-finance' && item.method === 'S256' && item.redirect === 'http://127.0.0.1:4204/auth/callback'));
  assert.ok(claims.some(item => item.hasSubject && item.hasUsername), 'standalone token carries the required OIDC identity');
  assert.equal(new URL(page.url()).pathname, '/finance');
  assert.equal(await page.locator('iframe').count(), 0);
  stages.push('standalone-pkce-own-client-and-real-graphql');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-mf="finance"]').waitFor({ state: 'visible', timeout: 45000 });
  assert.equal(await page.locator('#kc-login').count(), 0);
  const persisted = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)]);
  assert.ok(persisted.every(value => !/eyJ[A-Za-z0-9_-]+\./.test(value)));
  stages.push('standalone-reload-sso-no-persisted-token');
  await page.goto('http://127.0.0.1:4200/finance', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-mf="finance"]').waitFor({ state: 'visible', timeout: 45000 });
  assert.equal(await page.locator('#kc-login').count(), 0);
  stages.push('shell-reuses-provider-sso-without-second-login');
  await page.goto('http://127.0.0.1:4204/finance', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-mf="finance"]').waitFor({ state: 'visible', timeout: 45000 });
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await page.getByRole('button', { name: 'Ingresar', exact: true }).waitFor({ state: 'visible', timeout: 45000 });
  assert.equal(await page.locator('[data-mf="finance"]').count(), 0);
  stages.push('logout-unmounts-business-and-leaves-anonymous-root');
  assert.deepEqual(errors, []);
  assert.ok(business.some(result => result.fields.includes('quotes')));
  assert.ok(business.every(result => result.errors.length === 0), JSON.stringify(business));
  console.log(JSON.stringify({ pass: true, stages, auth }));
} catch (error) {
  process.exitCode = 1;
  console.error(JSON.stringify({ pass: false, stages, error: String(error?.stack ?? error) }));
} finally {
  mkdirSync(resolve(root, 'output/playwright'), { recursive: true });
  const state = page ? await page.evaluate(() => ({ text: document.body.innerText.slice(0, 1800), host: { hidden: document.getElementById('mf-finance')?.hidden, shadowChildren: document.getElementById('mf-finance')?.shadowRoot?.childElementCount } })).catch(() => null) : null;
  writeFileSync(resolve(root, 'output/playwright/t21-standalone-diagnostic.json'), JSON.stringify({ stages, errors, auth, claims, business, failedRequests, state, path: page ? new URL(page.url()).pathname : null }, null, 2));
  await browser.close();
}
