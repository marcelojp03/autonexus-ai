import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const requireApp = createRequire(new URL('mf-employees/package.json', root));
const { chromium } = requireApp(fileURLToPath(new URL('mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright', root)));
const { transpileModule, ModuleKind, ScriptTarget } = createRequire(new URL('shell/package.json', root))('typescript');

test('CU22 rejected replacement preserves the entire reviewed photo; accepted replacement needs a new review', { timeout: 60000 }, async () => {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<main id="host"></main><script type="module">' +
        'import { OfflineWorkspace } from "/shell/src/offline/workspace.ts";' +
        'window.workspace = new OfflineWorkspace(document.querySelector("#host"), {' +
        'snapshot: () => ({authenticated: false}), subscribe: () => () => {}});' +
        'await workspace.start(); window.ready = true;</script>');
    } else if (path.startsWith('/shell/src/offline/') && /^[a-z]+[.]ts$/.test(path.slice('/shell/src/offline/'.length))) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(transpileModule(readFileSync(new URL(path.slice(1), root), 'utf8'), {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 }
      }).outputText);
    } else response.writeHead(404).end();
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.ready);
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      canvas.getContext('2d').fillRect(0, 0, 64, 64);
      return canvas.toDataURL().split(',')[1];
    });
    const select = async (name, mimeType, buffer) => {
      await page.locator('#offline-photo').setInputFiles({ name, mimeType, buffer });
      await page.waitForFunction(() => document.querySelector('#host').getAttribute('aria-busy') === 'false');
    };
    await select('a.png', 'image/png', Buffer.from(png, 'base64'));
    await page.locator('#offline-description').fill('Revisión humana del panel A');
    await page.locator('#offline-minutes').fill('37');
    await page.locator('#offline-review').check();
    await page.locator('input[value="dent"]').check();
    await page.evaluate(() => {
      workspace.reviewReason = 'below_thresholds';
      workspace.prediction = { runId: 'synthetic-run', modelVersion: 'synthetic-model', labels: [{name:'dent', score:0.1}] };
      document.querySelector('#offline-scores').textContent = 'dent: 10%';
      window.photoA = workspace.image; window.predictionA = workspace.prediction;
    });
    const snapshot = () => page.evaluate(() => ({
      samePhoto: workspace.image === window.photoA, samePrediction: workspace.prediction === window.predictionA,
      revision: workspace.revision, reason: workspace.reviewReason,
      checked: document.querySelector('#offline-review').checked,
      labels: [...document.querySelectorAll('input[name="human-label"]:checked')].map(input => input.value),
      hidden: document.querySelector('#offline-labels').hidden,
      preview: document.querySelector('#offline-preview').src,
      scores: document.querySelector('#offline-scores').textContent,
      text: document.querySelector('#offline-description').value,
      limit: document.querySelector('#offline-description').maxLength,
      minutes: document.querySelector('#offline-minutes').value
    }));
    const reviewedA = await snapshot();
    for (const [name, type, bytes] of [
      ['b.txt', 'text/plain', Buffer.from('bad')],
      ['b.png', 'image/png', Buffer.from('not a PNG')]
    ]) {
      await select(name, type, bytes);
      assert.deepEqual(await snapshot(), reviewedA, name + ' must not mutate review A');
    }
    await select('b-valid.png', 'image/png', Buffer.from(png, 'base64'));
    const adoptedB = await snapshot();
    assert.equal(adoptedB.samePhoto, false); assert.equal(adoptedB.samePrediction, false);
    assert.equal(adoptedB.revision, false); assert.equal(adoptedB.checked, false);
    assert.deepEqual(adoptedB.labels, []); assert.equal(adoptedB.hidden, true);
    assert.equal(adoptedB.reason, 'operator_manual'); assert.equal(adoptedB.scores, '');
    assert.equal(adoptedB.limit, 2000); assert.notEqual(adoptedB.preview, reviewedA.preview);
    assert.equal(adoptedB.text, reviewedA.text); assert.equal(adoptedB.minutes, reviewedA.minutes);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
