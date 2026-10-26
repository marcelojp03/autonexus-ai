/** Chromium lifecycle regression. Native BFCache by default; --synthetic-events
 * explicitly tests persisted PageTransition events when native caching is denied.
 * Anonymous pages only; no credentials, tokens, recordings or production hooks.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const shell = 'http://127.0.0.1:4200';
let browser, fixtureServer, stage = 'launch', restores = 0, notRestored = [];
const syntheticEvents = process.argv.includes('--synthetic-events');
try {
  assert.ok(process.argv.slice(2).every(arg => arg === '--synthetic-events'));
  const frontend = createRequire(new URL('../web/mf-employees/package.json', import.meta.url));
  const { chromium } = createRequire(frontend.resolve('@playwright/test/package.json'))('playwright');
  browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--disable-back-forward-cache'] });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    addEventListener('pageshow', event => {
      if (event.persisted && location.origin === 'http://127.0.0.1:4200') console.info('CU01_TEST_BFCACHE_RESTORED');
    });
  });
  const page = await context.newPage();
  page.on('console', message => { if (message.text() === 'CU01_TEST_BFCACHE_RESTORED') restores++; });
  stage = 'initial-anonymous-session';
  await page.goto(shell + '/');
  await page.locator('#session-login').waitFor({ state: 'visible' });
  const original = await page.evaluate(() => performance.timeOrigin);
  stage = 'leave-document-and-return';
  if (syntheticEvents) {
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  } else {
  fixtureServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'max-age=60' });
    response.end('<!doctype html><title>Local navigation fixture</title><p>BFCache round trip</p>');
  });
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  await page.goto('http://localhost:' + fixtureServer.address().port + '/');
  await page.goBack();
  }
  stage = syntheticEvents ? 'persisted-events-confirmation' : 'actual-bfcache-confirmation';
  const deadline = Date.now() + 5000;
  while (!restores && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (!restores) notRestored = await page.evaluate(() => {
    const reasons = [];
    function collect(value) { if (!value) return; for (const r of value.reasons ?? []) reasons.push(r.reason); for (const child of value.children ?? []) collect(child); }
    collect(performance.getEntriesByType('navigation')[0]?.notRestoredReasons);
    return reasons;
  });
  assert.ok(restores > 0, 'Browser did not restore from BFCache.');
  await page.locator('#session-login').waitFor({ state: 'visible' });
  stage = 'fresh-owner-after-cache-restore';
  const freshDeadline = Date.now() + 3000;
  while (Date.now() < freshDeadline) {
    try { if (await page.evaluate(() => performance.timeOrigin) !== original) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.notEqual(await page.evaluate(() => performance.timeOrigin), original, 'BFCache must recover the disposed owner through a fresh document.');
  stage = 'login-after-restoration';
  await page.locator('#session-login').click();
  await page.waitForURL(url => url.origin === 'http://127.0.0.1:8180' && url.pathname.startsWith('/realms/autonexus/'));
  await page.locator('#username').waitFor({ state: 'visible' });
  console.log(JSON.stringify({ pass: true, restores, freshDocument: true, loginReachedIdp: true, evidence: syntheticEvents ? 'synthetic-persisted-events-real-document-reload-and-IdP' : 'real-Chromium-BFCache-no-credentials' }));
} catch {
  console.error(JSON.stringify({ pass: false, stage, restores, notRestored, syntheticEvents, message: 'BFCache acceptance failed; sensitive browser diagnostics suppressed.' }));
  process.exitCode = 1;
} finally { if (browser) await browser.close(); if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve)); }
