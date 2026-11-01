/**
 * CU23 real browser journey: the mechanic opens Inteligencia, analyses an evidence of their own
 * work, reads the result, reloads the page and finds the same analysis persisted.
 *
 * The microfrontend renders inside a shadow root; Playwright CSS locators pierce it. No credential,
 * signed URL or image payload is printed.
 *
 * Usage: node scripts/cu23/verify-vision-web.mjs
 * Env: CU23_PUBLIC_ORIGIN (default http://127.0.0.1:4286), CU23_ACCOUNTS_FILE, CU23_EVIDENCE_WAIT_MS
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = process.env.CU23_PUBLIC_ORIGIN || 'http://127.0.0.1:4286';
const accountsFile = process.env.CU23_ACCOUNTS_FILE || 'output/stack/cu16-fresh-proof.accounts.private.json';
const account = JSON.parse(readFileSync(resolve(accountsFile), 'utf8')).accounts.mechanicA;

const requireApp = createRequire(resolve('web/mf-employees/package.json'));
const { chromium } = requireApp(resolve('web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));

mkdirSync('output/cu23', { recursive: true });
const report = { origin, stages: [], consoleErrors: 0, pageErrors: 0, serverErrors: 0, pass: false };
const pass = (name, detail) => { report.stages.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }); };

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/La_Paz' });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors++; });
  page.on('pageerror', () => { report.pageErrors++; });
  page.on('response', response => { if (response.status() >= 500) report.serverErrors++; });

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  // The Shell decides when to start PKCE; if it stays on the session panel, press its button.
  await page.waitForTimeout(1500);
  if (await page.locator('#session-login').isVisible().catch(() => false)) await page.locator('#session-login').click();
  await page.locator('#username').fill(account.username);
  await page.locator('#username').waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('#password').fill(account.password);
  await page.locator('#kc-login').click();
  await page.waitForFunction(() => document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada'), null, { timeout: 60000 });
  pass('sesión PKCE iniciada desde el Shell');

  await page.goto(origin + '/intelligence', { waitUntil: 'domcontentloaded' });
  await page.locator('#mf-intelligence').waitFor({ state: 'visible', timeout: 30000 });

  // Model banner or the "no model" warning must be explicit before any inference.
  const app = page.locator('[data-testid="intelligence-app"]');
  await app.waitFor({ state: 'visible', timeout: 30000 });
  const notice = await page.getByText('Señal para revisión humana', { exact: false }).first().textContent();
  assert.ok(notice && notice.includes('No es un diagnóstico'), 'signal notice');
  pass('el microfrontend monta y declara que la salida es una señal para revisión humana');

  const modelText = await page.locator('[data-testid="intelligence-app"]').innerText();
  assert.ok(!modelText.includes('MODEL_NOT_READY'), 'model artefact expected in this run');

  const assignmentId = process.env.CU23_ASSIGNMENT_ID;
  if (assignmentId) {
    await page.goto(origin + '/intelligence?assignmentId=' + encodeURIComponent(assignmentId), { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="intelligence-app"]').waitFor({ state: 'visible', timeout: 40000 });
    pass('el enlace profundo desde la ejecución abre el trabajo indicado', { assignmentId });
  } else {
    const work = page.locator('[data-testid^="work-"]').first();
    await work.waitFor({ state: 'visible', timeout: 40000 });
    await work.click();
    pass('el mecánico ve sus trabajos con evidencia');
  }

  let analyze = page.locator('[data-testid^="analyze-"]').first();
  const deadline = Date.now() + Number(process.env.CU23_EVIDENCE_WAIT_MS ?? 20000);
  while (Date.now() < deadline && (await analyze.count()) === 0) await page.waitForTimeout(500);
  if ((await analyze.count()) === 0) throw new Error('no evidence was available for this work in the UI');
  await analyze.click();

  await page.getByText('Resultado del último análisis', { exact: false }).first().waitFor({ state: 'visible', timeout: 90000 });
  const result = page.locator('table').first();
  await result.waitFor({ state: 'visible', timeout: 30000 });
  const rows = await result.locator('tbody tr').count();
  assert.ok(rows >= 1, 'label rows rendered');
  pass('el análisis se ejecuta desde la interfaz y muestra etiquetas con puntaje', { labelRows: rows });

  const panelText = await page.locator('[data-testid="intelligence-app"]').innerText();
  assert.ok(/Modelo automotive-damage-mobilenetv2/.test(panelText), 'model version visible');
  assert.ok(/%/.test(panelText), 'percentages visible');
  pass('la versión del modelo y los puntajes quedan visibles en el panel');

  // Reload: the analysis must come from MongoDB, not from component state.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="intelligence-app"]').waitFor({ state: 'visible', timeout: 40000 });
  if (!assignmentId) {
    const reopened = page.locator('[data-testid^="work-"]').first();
    await reopened.waitFor({ state: 'visible', timeout: 40000 });
    await reopened.click();
  } else {
    await page.goto(origin + '/intelligence?assignmentId=' + encodeURIComponent(assignmentId), { waitUntil: 'domcontentloaded' });
  }
  await page.getByText('Historial del trabajo', { exact: false }).first().waitFor({ state: 'visible', timeout: 40000 });
  await page.waitForTimeout(1500);
  const history = await page.locator('[data-testid="intelligence-app"]').innerText();
  assert.ok(/Historial del trabajo \([1-9]/.test(history), 'history persisted after reload');
  pass('tras recargar, el historial del trabajo conserva el análisis persistido');

  assert.equal(report.consoleErrors, 0, 'console errors');
  assert.equal(report.pageErrors, 0, 'page errors');
  assert.equal(report.serverErrors, 0, 'server errors');
  pass('sin errores de consola, de página ni respuestas 5xx');

  report.pass = true;
} catch (error) {
  report.error = { name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 400) };
  throw error;
} finally {
  writeFileSync(resolve('output/cu23/vision-web.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  console.log(JSON.stringify({ pass: report.pass, stages: report.stages.length, consoleErrors: report.consoleErrors, pageErrors: report.pageErrors, serverErrors: report.serverErrors }));
}
