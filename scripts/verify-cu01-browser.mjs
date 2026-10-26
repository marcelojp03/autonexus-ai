/** Real browser acceptance. CLI run-code cannot read the private fixture safely;
 * ordinary Playwright keeps credentials in Node RAM. No runner or recordings.
 */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
const shell = 'http://127.0.0.1:4200';
const idp = 'http://127.0.0.1:8180';
const apis = ['http://127.0.0.1:3002', 'http://127.0.0.1:8081'];
const contexts = new Set();
const observations = [];
let browser, currentStage = 'configuration', completedStages = 0;
const emit = result => console.log(JSON.stringify(result));
const check = value => { if (!value) throw new Error('Acceptance failed'); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (!await fn()) { check(Date.now() < deadline); await pause(100); }
}
async function stage(label, fn) {
  currentStage = label; await fn(); completedStages++; emit({ stage: label, pass: true });
}
async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  ctx.setDefaultTimeout(20000);
  contexts.add(ctx);
  const counts = { auth: 0, invalidAuth: 0, code200: 0, refresh200: 0, tokenFailures: 0, pageErrors: 0,
    unexpectedConsoleErrors: 0, expected403ConsoleErrors: 0, expected403Responses: 0,
    unexpectedResourceFailures: 0, navigationAborts: 0, bearerApiRequests: 0 };
  const clients = new Map(), expected403 = new Set();
  ctx.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === idp && u.pathname.endsWith('/protocol/openid-connect/auth')) {
      counts.auth++;
      const p = u.searchParams, client = p.get('client_id');
      clients.set(client, (clients.get(client) ?? 0) + 1);
      const ports = { 'autonexus-shell': 4200, 'autonexus-mf-employees': 4201, 'autonexus-mf-operations': 4202 };
      if (!(p.get('response_type') === 'code' && p.get('code_challenge_method') === 'S256'
        && /^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge') ?? '') && p.get('nonce') && p.get('state')
        && p.get('response_mode') === 'fragment' && ports[client]
        && p.get('redirect_uri') === 'http://127.0.0.1:' + ports[client] + '/auth/callback')) counts.invalidAuth++;
    }
    if (apis.includes(u.origin) && /^Bearer /i.test(req.headers().authorization ?? '')) counts.bearerApiRequests++;
  });
  ctx.on('response', res => {
    const u = new URL(res.url());
    if (u.origin === idp && u.pathname.endsWith('/protocol/openid-connect/token')) {
      // Never read token response bodies; retain only grant/status counters.
      const grant = new URLSearchParams(res.request().postData() ?? '').get('grant_type');
      if (res.status() === 200 && grant === 'authorization_code') counts.code200++;
      else if (res.status() === 200 && grant === 'refresh_token') counts.refresh200++;
      else counts.tokenFailures++;
    }
    if (res.status() >= 400) {
      if (res.status() === 403 && expected403.has(u.origin + u.pathname)) counts.expected403Responses++;
      else counts.unexpectedResourceFailures++;
    }
  });
  ctx.on('requestfailed', req => {
    if (req.isNavigationRequest() && /ERR_ABORTED/.test(req.failure()?.errorText ?? '')) counts.navigationAborts++;
    else counts.unexpectedResourceFailures++;
  });
  ctx.on('page', page => {
    page.on('pageerror', () => counts.pageErrors++);
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      if (expected403.has(msg.location().url) && /403/.test(msg.text())) counts.expected403ConsoleErrors++;
      else {
        counts.unexpectedConsoleErrors++;
        const text = msg.text();
        emit({ observation: 'unexpected-console', stage: currentStage,
          angularCodes: text.match(/NG[0-9]+/g) ?? [], typeError: text.includes('TypeError'),
          clearSiteData: text.includes('Clear-Site-Data'), csp: /Content Security|frame|refused/i.test(text),
          network: /fetch|resource|network/i.test(text), sourceIsShell: msg.location().url.startsWith(shell) });
      }
    });
  });
  const observed = { ctx, counts, clients, expected403 };
  observations.push(observed); return observed;
}
async function close(o) { await o.ctx.close(); contexts.delete(o.ctx); }
async function form(page) {
  await page.waitForURL(u => u.origin === idp && u.pathname.startsWith('/realms/autonexus/'));
  await page.locator('#username').waitFor({ state: 'visible' });
  await page.locator('#password').waitFor({ state: 'visible' });
}
async function login(page, account, wrong = false) {
  await form(page);
  await page.locator('#username').fill(account.username);
  await page.locator('#password').fill(wrong ? account.password + randomBytes(12).toString('hex') : account.password);
  await page.locator('#kc-login').click();
}
async function noModules(page) { check(await page.locator('anx-employees-root, anx-operations-root').count() === 0); }
async function mounted(page, module) {
  const root = page.locator('anx-' + module + '-root');
  await root.locator('.workspace').waitFor({ state: 'visible' });
  await root.locator('.ant-card').first().waitFor({ state: 'visible' });
  await until(() => root.evaluate(el => !!el.shadowRoot.querySelector('link[rel="stylesheet"]')?.sheet
    && getComputedStyle(el.shadowRoot.querySelector('.workspace')).paddingTop !== '0px'));
  check(await page.locator('header').count() === 1);
  check(await page.locator('anx-' + (module === 'employees' ? 'operations' : 'employees') + '-root').count() === 0);
  check(/demostración|ejemplo/i.test(await root.locator('.description').innerText()));
  const u = new URL(page.url());
  check(u.origin === shell && !u.hash && !/[?&](code|state|session_state|iss|access_token|id_token)=/.test(u.search));
}
async function storage(page) {
  check(await page.evaluate(async () => {
    const jwt = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
    const secretKey = /(?:^|[_.:-])(?:access_token|refresh_token|id_token|legacy_token|_token|token)(?:$|[_.:-])|kc-callback-/i;
    let violations = 0;
    const inspect = (k, v) => {
      if (secretKey.test(String(k)) || jwt.test(String(k)) || jwt.test(typeof v === 'string' ? v : JSON.stringify(v) ?? '')) violations++;
    };
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) { const k = store.key(i); inspect(k, store.getItem(k)); }
    }
    for (const info of await indexedDB.databases()) {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(info.name);
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('Storage failed'));
      });
      try {
        for (const name of db.objectStoreNames) await new Promise((resolve, reject) => {
          const tx = db.transaction(name, 'readonly'), req = tx.objectStore(name).openCursor();
          req.onsuccess = () => { const c = req.result; if (c) { inspect(c.key, c.value); c.continue(); } };
          tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(new Error('Storage failed'));
        });
      } finally { db.close(); }
    }
    return violations === 0;
  }));
}
async function diagnostic(page, o, service, resource, status) {
  const button = page.locator('[data-technical-service="' + service + '"][data-technical-resource="' + resource + '"]');
  check(await button.count() === 1);
  const endpoint = apis[service === 'employees' ? 0 : 1] + '/technical/' + resource;
  if (status === 403) o.expected403.add(endpoint);
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url() === endpoint && r.request().method() === 'GET'),
    button.click(),
  ]);
  check(response.status() === status);
  await until(() => button.isEnabled());
  check((status === 403 ? /403/ : /confirmad/).test(await page.locator('#technical-result').innerText()));
}
async function screenshots(page, accounts) {
  const selector = '#session-identity, #technical-result, anx-session-controls';
  currentStage = 'capture-required-masks';
  const mask = page.locator(selector); check(await mask.count() >= 3);
  // Refuse capture if any fixture identity appears outside the approved masks.
  currentStage = 'capture-private-identity-boundary';
  check(await page.evaluate(({ names, selector }) => {
    function safe(root) {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot && !safe(el.shadowRoot)) return false;
        for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE
          && names.some(name => node.textContent.includes(name)) && !el.closest(selector)) return false;
      }
      return true;
    }
    return safe(document);
  }, { names: accounts.map(a => a.username), selector }));
  await mkdir(new URL('../output/playwright/', import.meta.url), { recursive: true });
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    currentStage = 'capture-' + name + '-layout';
    await page.setViewportSize({ width, height });
    await until(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(await page.locator('header').count() === 1);
    currentStage = 'capture-' + name + '-sanitized-image';
    await page.screenshot({ path: fileURLToPath(new URL('../output/playwright/cu01-' + name + '.png', import.meta.url)), fullPage: true, mask: [mask] });
  }
}
try {
  const args = process.argv.slice(2);
  const reuseCaptures = args.includes('--reuse-captures');
  const rest = args.filter(arg => arg !== '--reuse-captures');
  check(rest.length === 0 || (rest.length === 2 && rest[0] === '--demo-url' && rest[1] === 'http://127.0.0.1:4203'));
  const demoUrl = rest[1];
  currentStage = 'private-fixture';
  const accounts = JSON.parse(await readFile(new URL('../infra/keycloak/.local/test-accounts.json', import.meta.url), 'utf8'));
  check(Array.isArray(accounts));
  const account = key => {
    const a = accounts.find(a => a.key === key);
    check(a && typeof a.username === 'string' && a.username.length && typeof a.password === 'string' && a.password.length);
    return a;
  };
  for (const key of ['mecanico', 'administrador', 'sin_rol', 'deshabilitado']) account(key);
  currentStage = 'playwright-launch';
  const angularRequire = createRequire(new URL('../web/mf-employees/package.json', import.meta.url));
  const { chromium } = createRequire(angularRequire.resolve('@playwright/test/package.json'))('playwright');
  browser = await chromium.launch({ headless: true });
  for (const [label, key, wrong] of [['wrong-credentials', 'mecanico', true], ['disabled-account', 'deshabilitado', false]]) {
    await stage(label, async () => {
      const o = await context(), page = await o.ctx.newPage();
      await page.goto(shell + '/employees/widgets?entry=cu01'); await login(page, account(key), wrong);
      await page.locator('#input-error-username, #input-error, .pf-v5-c-alert, .pf-v6-c-alert, .alert-error').first().waitFor({ state: 'visible' });
      await form(page); check(o.counts.auth === 1 && o.counts.invalidAuth === 0 && o.counts.code200 === 0);
      await close(o);
    });
  }
  const o = await context(), page = await o.ctx.newPage();
  await stage('code-pkce-exact-return-shadow-css', async () => {
    await page.goto(shell + '/employees/widgets?entry=cu01'); await login(page, account('mecanico'));
    await page.waitForURL(u => u.origin === shell && u.pathname === '/employees/widgets' && u.search === '?entry=cu01' && !u.hash);
    await mounted(page, 'employees'); check(o.counts.auth === 1 && o.counts.code200 === 1 && o.counts.invalidAuth === 0); await storage(page);
  });
  await stage('integrated-navigation-single-document-session', async () => {
    const origin = await page.evaluate(() => performance.timeOrigin), auth = o.counts.auth;
    for (const module of ['operations', 'employees']) {
      await page.locator('[data-module="' + module + '"]').click();
      await page.locator('[data-page="widgets"]').click(); await mounted(page, module);
      check(await page.evaluate(() => performance.timeOrigin) === origin); check(o.counts.auth === auth);
    }
  });
  await stage('deep-link-reload-cookie-sso', async () => {
    for (const reload of [false, true]) {
      const auth = o.counts.auth, code = o.counts.code200;
      if (reload) await page.reload(); else await page.goto(shell + '/operations/widgets?entry=cu01');
      await mounted(page, 'operations');
      check(new URL(page.url()).pathname + new URL(page.url()).search === '/operations/widgets?entry=cu01');
      check(o.counts.auth === auth + 1 && o.counts.code200 === code + 1); await storage(page);
    }
  });
  await stage('timer-refresh-real-token-endpoint', async () => {
    const refresh = o.counts.refresh200;
    await until(() => o.counts.refresh200 > refresh, 50000);
    await mounted(page, 'operations'); check(o.counts.tokenFailures === 0); await storage(page);
  });
  await stage('ui-session200-admin403', async () => {
    await page.locator('#technical-controls summary').click();
    for (const service of ['employees', 'operations']) {
      await diagnostic(page, o, service, 'session', 200); await diagnostic(page, o, service, 'admin', 403);
    }
    check(o.counts.expected403Responses === 2);
  });
  if (reuseCaptures) {
    currentStage = 'reuse-existing-captures';
    for (const name of ['desktop', 'mobile']) {
      const png = await readFile(new URL('../output/playwright/cu01-' + name + '.png', import.meta.url));
      check(png.length > 8 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    }
    emit({ stage: 'sanitized-desktop-mobile', result: 'previousVerifiedCapturesReused' });
  } else await stage('sanitized-desktop-mobile', () => screenshots(page, accounts));
  await stage('standalone-clients-sso-layout-storage', async () => {
    for (const [port, module] of [[4201, 'employees'], [4202, 'operations']]) {
      const standalone = await o.ctx.newPage(), code = o.counts.code200;
      await standalone.goto('http://127.0.0.1:' + port + '/#/widgets');
      await standalone.locator('.alain-default__header').waitFor({ state: 'visible' });
      await standalone.locator('.ant-card').first().waitFor({ state: 'visible' });
      check(new URL(standalone.url()).hash === '#/widgets'); check(await standalone.locator('.alain-default__header').count() === 1);
      check(await standalone.locator('.shell-header').count() === 0);
      check(o.counts.code200 === code + 1 && o.clients.get('autonexus-mf-' + module) === 1);
      await storage(standalone); await standalone.close();
    }
  });
  await stage('logout-anonymous-then-protected-login', async () => {
    const auth = o.counts.auth;
    await page.locator('#session-logout').click();
    await page.waitForURL(u => u.origin === shell && u.pathname === '/' && !u.hash && !u.search);
    await page.locator('#session-login').waitFor({ state: 'visible' }); await noModules(page); await storage(page);
    check(o.counts.auth === auth);
    await page.locator('[data-module="employees"]').click(); await form(page); check(o.counts.auth === auth + 1);
  });
  await close(o);
  await stage('unrecognized-role-forbidden-no-loop', async () => {
    const denied = await context(), page = await denied.ctx.newPage();
    await page.goto(shell + '/employees/widgets?entry=cu01'); await login(page, account('sin_rol'));
    await page.locator('#session-status').filter({ hasText: 'Acceso insuficiente' }).waitFor(); await noModules(page);
    await page.locator('[data-module="operations"]').click(); await pause(1500); await noModules(page);
    check(denied.counts.auth === 1 && denied.counts.code200 === 1); await storage(page); await close(denied);
  });
  if (demoUrl) await stage('explicit-demo-no-bearer-api', async () => {
    const demo = await context(), page = await demo.ctx.newPage();
    await page.goto(demoUrl + '/#/widgets');
    await page.getByRole('status').filter({ hasText: 'DEMO explícito' }).waitFor(); await pause(1500);
    check(demo.counts.bearerApiRequests === 0 && demo.counts.auth === 0); await storage(page); await close(demo);
  });
  else emit({ stage: 'explicit-demo-no-bearer-api', result: 'demoVerificationSkipped' });
  await stage('browser-errors-resource-counts', async () => {
    for (const { counts: c } of observations) check(c.pageErrors === 0 && c.unexpectedConsoleErrors === 0
      && c.unexpectedResourceFailures === 0 && c.invalidAuth === 0 && c.tokenFailures === 0);
  });
  const counts = Object.fromEntries(Object.keys(observations[0].counts).map(k => [k, observations.reduce((sum, o) => sum + o.counts[k], 0)]));
  emit({ pass: true, completedStages, counts, result: demoUrl ? 'realBrowserWithDemo' : 'realBrowserDemoSkipped' });
} catch {
  emit({ stage: currentStage, pass: false, completedStages, counts: observations.map(({ counts }) => counts), result: 'acceptanceFailedSensitiveDetailsSuppressed' }); process.exitCode = 1;
} finally {
  for (const ctx of contexts) { try { await ctx.close(); } catch { process.exitCode = 1; } }
  if (browser) { try { await browser.close(); } catch { process.exitCode = 1; } }
}
