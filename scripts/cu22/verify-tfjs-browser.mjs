/**
 * CU22 — run the converted TensorFlow.js model inside a real browser and compare it with Python.
 *
 * Serves the artefacts on a loopback port, opens Chromium, waits for the page to finish inference
 * and records the measured delta. This is the browser evidence; the Node run is a separate one.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve('output/cu23/browser-check');
const pageName = process.env.CU22_PAGE ?? 'index.html';
const resultKey = pageName === 'photo.html' ? '__cu22photo' : '__cu22';
const outputFile = pageName === 'photo.html' ? 'output/cu23/tfjs-photo-browser.json' : 'output/cu23/tfjs-browser.json';
const port = Number(process.env.CU22_PORT ?? 4291);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.bin': 'application/octet-stream' };

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const target = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!target.startsWith(root) || !existsSync(target)) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream' });
  createReadStream(target).pipe(response);
});
await new Promise(done => server.listen(port, '127.0.0.1', done));

const requireApp = createRequire(resolve('web/mf-employees/package.json'));
const { chromium } = requireApp(resolve('web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));

const report = { origin: 'http://127.0.0.1:' + port, pass: false };
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)); });
  await page.goto(report.origin + '/' + pageName, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(key => Boolean(window[key]), resultKey, { timeout: 180000 });
  const result = await page.evaluate(key => window[key], resultKey);
  report.result = result;
  report.consoleErrors = consoleErrors;
  report.pass = Boolean(result?.equivalent) && consoleErrors.length === 0;
} catch (error) {
  report.error = String(error?.message ?? error).slice(0, 300);
} finally {
  writeFileSync(resolve(outputFile), JSON.stringify(report, null, 2));
  await browser?.close();
  server.close();
  console.log(JSON.stringify({ pass: report.pass, maxAbsDelta: report.result?.maxAbsDelta, backend: report.result?.runtime, error: report.error }));
  process.exit(report.pass ? 0 : 1);
}
