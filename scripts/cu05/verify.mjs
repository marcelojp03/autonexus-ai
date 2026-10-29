import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, privateStore, createSession } from './runtime.mjs';
import { createFixtures } from './fixtures.mjs';
import { apiProbes, bffProbes, identityMutations } from './probes.mjs';

export async function main(args = process.argv.slice(2)) {
  assert.ok(args.includes('--run'), 'Explicit --run required; imports and preparation never execute APIs');
  const option = name => args.find(a => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
  const layer = option('layer') ?? 'api';
  assert.ok(['api', 'bff', 'browser', 'identity', 'consistency', 'all'].includes(layer), 'Unknown verification layer');
  const fixtureFile = option('fixture-file');
  if (['bff', 'browser', 'identity'].includes(layer)) assert.ok(fixtureFile, 'Run API first, then reuse its private fixture file');
  const c = config(), store = privateStore(randomUUID());
  const report = { runId: store.state.runId, synthetic: true, layer, pass: false, stages: [], requests: [], expectedFailed: [], limitations: ['Owner outage requires main-owned runtime adapter; not executed by this CLI', 'Participant-only provisional sagas do not prove an O-global-pending interleaving', 'Subject relinking and delayed Inbox require separately controlled owner evidence'] };
  const save = () => writeFileSync(resolve(store.dir, 'result.json'), JSON.stringify(report, null, 2));
  const emit = entry => appendFileSync(resolve(store.dir, 'run.log'), JSON.stringify(entry) + '\n');
  async function stage(name, action) {
    const entry = { name, status: 'RUNNING' }; report.stages.push(entry); save(); emit({ name, status: entry.status });
    try { await action(); entry.status = 'PASS'; }
    catch (error) { entry.status = 'FAIL'; entry.errorCategory = error?.name === 'AssertionError' ? 'ASSERTION' : 'EXECUTION'; entry.operator = error?.operator; entry.locations = [...new Set(String(error?.stack ?? '').match(/scripts[\/]cu05[\/][\w.-]+:\d+:\d+/g) ?? [])]; throw error; }
    finally { save(); emit({ name, status: entry.status }); }
  }
  try {
    const session = createSession(c), api = session.api;
    session.observeGraphql = value => { (report.graphqlRequests ??= []).push(value); save(); };
    session.api = async (...input) => {
      const result = await api(...input);
      const entry = { owner: input[0], path: input[1].split('?')[0], method: input[2] ?? 'GET', status: result.status, code: /^[A-Z_]+$/.test(result.body?.code ?? '') ? result.body.code : undefined };
      report.requests.push(entry); if (result.status >= 400) report.expectedFailed.push({ ...entry, classification: 'Observed negative response; stage assertion determines whether expected' });
      save(); return result;
    };
    let f;
    if (fixtureFile) {
      const previous = JSON.parse(readFileSync(fixtureFile, 'utf8'));
      assert.equal(previous.synthetic, true); assert.ok(previous.fixture, 'Incomplete fixture set; do not recreate or overwrite its private records');
      f = previous.fixture;
      assert.ok(layer !== 'all' && layer !== 'consistency', 'Consistency requires an owned creation closure in a new run');
      store.state.sourceRunId = previous.runId;
    } else await stage('fixtures-CU03-CU02-CU15-real-two-subjects-and-chief', async () => { f = await createFixtures(session, store); store.state.fixture = f; store.save(); });
    if (['api', 'all'].includes(layer)) { await apiProbes(c, session, f, stage); store.state.fixture = f; store.save(); }
    if (['bff', 'browser', 'identity'].includes(layer)) assert.ok(f.jobs.every(j => j.assignmentId), 'Run API layer first and pass its ignored private fixture file');
    if (['bff', 'all'].includes(layer)) await bffProbes(c, session, f, stage);
    if (['consistency', 'all'].includes(layer)) { const { consistencyProbes } = await import('./consistency.mjs'); await consistencyProbes(c, session, f, store, stage); }
    if (['browser', 'all'].includes(layer)) { const { browserProbes } = await import('./browser.mjs'); await browserProbes(c, f, store, stage, report, { only: option('browser-case'), noScreenshots: args.includes('--no-screenshots'), observeStaff: args.includes('--observe-staff') }); }
    if (['identity', 'all'].includes(layer)) await identityMutations(c, session, f, stage);
    report.pass = !report.browser?.diagnosticOnly;
    if (report.browser?.diagnosticOnly) { report.diagnosticOnly = true; process.exitCode = 1; }
  } catch { report.pass = false; process.exitCode = 1; }
  finally {
    store.save(); save(); writeFileSync(resolve(store.dir, 'run.exit'), report.pass ? '0\n' : '1\n');
    console.log(JSON.stringify({ runId: report.runId, layer, pass: report.pass, stages: report.stages.map(({ name, status }) => ({ name, status })) }));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv.includes('--run')) {
  main().catch(() => { process.exitCode = 1; console.error('CU05 harness preflight failed; private diagnostics withheld'); });
}
