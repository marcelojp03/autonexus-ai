/**
 * CU16 real browser evidence journey: preflight, direct presigned upload, GraphQL
 * confirmation, authorized download and overwrite rejection, all from the web origin.
 * Synthetic 1x1 PNG only; no credentials or signed URLs are printed.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const origin = process.env.CU16_PUBLIC_ORIGIN || 'http://127.0.0.1:4286';
const accountsFile = process.env.CU16_ACCOUNTS_FILE || 'output/stack/cu16-fresh-proof.accounts.private.json';
const account = JSON.parse(readFileSync(resolve(accountsFile), 'utf8')).accounts.mechanicA;

const requireApp = createRequire(resolve('web/mf-employees/package.json'));
const { chromium } = requireApp(resolve('web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
writeFileSync('output/stack/cu16-synthetic-evidence.png', png);

const report = {
  origin,
  stages: [],
  consoleErrors: 0,
  pageErrors: 0,
  serverErrors: 0,
  preflights: [],
  uploads: [],
  pass: false,
};
const pass = (name, ok) => { assert.ok(ok, name); report.stages.push({ name, status: 'PASS' }); };

let browser;
let context;
try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/La_Paz' });
  const page = await context.newPage();

  // Capture the browser-side transfer facts without exposing URLs or credentials.
  await page.addInitScript(() => {
    window.__cu16S3 = [];
    window.__cu16Open = [];
    const originalOpen = window.open;
    window.open = (url, ...rest) => { window.__cu16Open.push(String(url)); return originalOpen.call(window, url, ...rest); };
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url ?? '';
      const method = (init?.method ?? 'GET').toUpperCase();
      const response = await originalFetch(input, init);
      const record = { url, method, status: response.status, ok: response.ok, headers: init?.headers ?? null };
      if (url.includes('amazonaws.com') || /\.s3\./.test(url)) window.__cu16S3.push(record);
      return response;
    };
  });

  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  let authorizedDownload = null;
  page.on('response', async (response) => {
    if (response.request().method() !== 'POST' || !response.url().endsWith('/graphql')) return;
    try {
      const body = await response.json();
      const url = body?.data?.myEvidenceDownload?.url;
      if (typeof url === 'string') authorizedDownload = url;
    } catch { /* non-JSON responses are irrelevant here */ }
  });
  page.on('pageerror', () => report.pageErrors++);
  page.on('response', (response) => {
    const request = response.request();
    const url = response.url();
    const isS3 = url.includes('amazonaws.com') || /\.s3\./.test(url);
    if (request.method() === 'OPTIONS' && isS3) {
      report.preflights.push({ status: response.status(), allowOrigin: response.headers()['access-control-allow-origin'] ?? null });
    }
    if (response.status() >= 500 && !isS3) report.serverErrors++;
  });

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#session-login').click();
  await page.locator('#username').fill(account.username);
  await page.locator('#password').fill(account.password);
  await page.locator('#kc-login').click();
  await page.waitForFunction(() => document.querySelector('#session-status')?.textContent?.includes('Sesión iniciada'), null, { timeout: 30000 });
  pass('real PKCE sign-in as the assigned mechanic', true);

  await page.goto(origin + '/employees/agenda', { waitUntil: 'domcontentloaded' });
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2026-11-01');
  await dates.nth(1).fill('2026-11-30');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await page.locator('tbody tr a').first().waitFor({ state: 'visible', timeout: 30000 });
  const inProgressRow = page.locator('tbody tr', { hasText: 'En ejecución' }).first();
  const rowLink = (await inProgressRow.count()) ? inProgressRow.locator('a') : page.locator('tbody tr a').first();
  await rowLink.click();
  await page.getByRole('link', { name: 'Abrir ejecución' }).click();
  await page.locator('#execution-work').waitFor({ state: 'visible', timeout: 30000 });
  pass('CU05 detail opens the selected CU16 execution', true);

  const description = page.locator('#execution-description');
  const startButton = page.locator('#execution-start');
  const ready = await Promise.race([
    startButton.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'not-started').catch(() => null),
    description.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'in-progress').catch(() => null),
  ]);
  if (ready === 'not-started') {
    // The component refreshes after selecting a work, so the node can be replaced mid-click.
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await page.locator('#execution-start').click({ timeout: 5000 }); break; } catch { await page.waitForTimeout(500); }
    }
  }
  await description.waitFor({ state: 'visible', timeout: 20000 });
  await description.fill('Evidencia real desde navegador (sintética)');
  await page.locator('#execution-minutes input').fill('7');
  await page.locator('#execution-advance').click();
  await page.getByText('Avance registrado.', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
  pass('advance recorded through the real BFF and Operations API', true);

  const uploadButton = page.locator('button[id^="evidence-upload-"]').last();
  const uploadId = await uploadButton.getAttribute('id');
  const advanceId = uploadId.slice('evidence-upload-'.length);
  await page.locator('#evidence-' + advanceId).setInputFiles(resolve('output/stack/cu16-synthetic-evidence.png'));
  await uploadButton.click();
  await page.getByText('Evidencia confirmada.', { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
  pass('browser upload confirmed as available by the owner', true);

  const s3 = await page.evaluate(() => window.__cu16S3);
  const put = s3.find((entry) => entry.method === 'PUT' && entry.ok);
  pass('bytes travelled directly from the browser to the presigned S3 URL', Boolean(put));

  // Explicit CORS behaviour from the page origin: allowed methods reach S3 and an unlisted
  // header is blocked by the browser's preflight. Exposed headers are checked on the
  // authorized download below, because an unauthenticated GET returns no object metadata.
  const cors = await page.evaluate(async (url) => {
    const head = await fetch(url, { method: 'HEAD' }).then((r) => ({ status: r.status })).catch((e) => ({ error: e.name }));
    const blocked = await fetch(url, { method: 'PUT', headers: { 'x-cu16-not-allowed': '1' }, body: new Uint8Array([1]) })
      .then((r) => ({ status: r.status })).catch((e) => ({ error: e.name }));
    return { head, blocked };
  }, put.url);
  report.cors = cors;
  pass('exact web origin may call S3 HEAD from the browser', typeof cors.head.status === 'number');
  pass('preflight blocks a header outside the allowlist', cors.blocked.error === 'TypeError');

  const confirmedTag = page.locator('nz-tag', { hasText: 'Confirmada' }).last();
  pass('evidence is shown as confirmed, not pending', await confirmedTag.count() > 0);

  await page.evaluate(() => { window.__cu16Open = []; });
  await page.getByRole('button', { name: 'Descargar evidencia' }).last().click();
  for (let attempt = 0; attempt < 20 && !authorizedDownload; attempt++) await page.waitForTimeout(250);
  const downloadUrl = authorizedDownload ?? await page.evaluate(() => window.__cu16Open[window.__cu16Open.length - 1]);
  const downloaded = await page.evaluate(async (url) => {
    if (!url) return { status: 0, length: -1, etag: null, reason: 'no-url-captured' };
    const response = await fetch(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, length: bytes.length, etag: response.headers.get('etag') };
  }, downloadUrl);
  report.download = { captured: Boolean(downloadUrl), status: downloaded.status, length: downloaded.length, reason: downloaded.reason ?? null };
  pass('authorized download returns the stored bytes from the browser', downloaded.status === 200 && downloaded.length === png.length);
  pass('download exposes the recorded ETag to the browser', typeof downloaded.etag === 'string' && downloaded.etag.length > 0);

  const overwrite = await page.evaluate(async ({ url, headers, base64 }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const response = await fetch(url, { method: 'PUT', headers, body: bytes });
    return { status: response.status, ok: response.ok };
  }, { url: put.url, headers: put.headers, base64: png.toString('base64') }).catch(() => null);
  report.overwriteAttempt = overwrite;
  pass('overwriting the confirmed object from the browser is rejected', overwrite !== null && overwrite.ok === false);

  await page.screenshot({ path: 'output/stack/cu16-evidence-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  pass('execution stays visible at mobile viewport', await page.locator('#execution-work').isVisible());
  await page.screenshot({ path: 'output/stack/cu16-evidence-mobile.png', fullPage: true });

  // Expected negative results: the intentional 412 overwrite, the blocked preflight, and the
  // deliberate unsigned HEAD probe that S3 answers with 403. Anything else is a real error.
  const expected = /412|Precondition Failed|ERR_FAILED|CORS|Access-Control|403 \(Forbidden\)/i;
  report.consoleErrors = consoleErrors.filter((text) => !expected.test(text)).length;
  report.unexpectedConsole = consoleErrors.filter((text) => !expected.test(text)).map((text) => text.slice(0, 200));
  report.expectedConsoleErrors = consoleErrors.length - report.consoleErrors;
  report.note = 'Expected console entries come only from the deliberate negative probes (unsigned HEAD 403, blocked header, 412 overwrite).';
  report.pass = report.consoleErrors === 0 && report.pageErrors === 0 && report.serverErrors === 0;
} catch (error) {
  report.errorName = error?.name || 'Error';
  report.errorMessage = error?.message;
  throw error;
} finally {
  await context?.close();
  await browser?.close();
  writeFileSync('output/stack/cu16-evidence-web-result.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ pass: report.pass, stages: report.stages.length, preflights: report.preflights.length, uploads: report.uploads.length }));
