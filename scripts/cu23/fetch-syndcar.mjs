/**
 * Download SYNDCAR (CC BY 4.0, Mendeley Data) from its public page.
 *
 * Downloading a public archive is not a request to a third party, so this is attempted with a real
 * browser: the page renders its file list with JavaScript, and the "Download All" control triggers
 * the archive. If the control cannot be reached, the script says so and the manual step stays.
 *
 * Usage: node scripts/cu23/fetch-syndcar.mjs [--out ml/data/raw]
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATASET = 'https://data.mendeley.com/datasets/hzpj48krdt/1';
const args = process.argv.slice(2);
const outDir = resolve(args.indexOf('--out') === -1 ? 'ml/data/raw' : args[args.indexOf('--out') + 1]);
mkdirSync(outDir, { recursive: true });

const requireApp = createRequire(resolve('web/mf-employees/package.json'));
const { chromium } = requireApp(resolve('web/mf-employees/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright'));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const report = { dataset: DATASET, steps: [], saved: null, error: null };

try {
  await page.goto(DATASET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  report.steps.push({ step: 'page-loaded', title: await page.title() });

  const candidates = [/download all/i, /descargar todo/i, /download/i];
  let clicked = null;
  for (const pattern of candidates) {
    const control = page.getByRole('button', { name: pattern }).first();
    if (await control.count()) {
      const downloadPromise = page.waitForEvent('download', { timeout: 180000 }).catch(() => null);
      await control.click({ timeout: 15000 }).catch(() => null);
      const download = await downloadPromise;
      if (download) {
        const target = resolve(outDir, download.suggestedFilename() || 'syndcar.zip');
        await download.saveAs(target);
        report.saved = target;
        report.steps.push({ step: 'downloaded', file: target, failure: download.failure() });
        clicked = true;
        break;
      }
      report.steps.push({ step: 'clicked-without-download', pattern: String(pattern) });
    }
  }
  if (!clicked) report.error = 'download-control-not-reachable';
} catch (error) {
  report.error = String(error?.message ?? error).slice(0, 300);
} finally {
  writeFileSync(resolve('output/cu23/syndcar-download.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify(report));
}
