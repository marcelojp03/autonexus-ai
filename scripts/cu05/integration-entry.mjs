import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, privateStore, createSession } from './runtime.mjs';
import { createFixtures } from './fixtures.mjs';

export async function runIntegration(kind, args = process.argv.slice(2)) {
  assert.ok(args.includes('--run'), 'Explicit main --run authorization required');
  assert.ok(['dependency', 'injections'].includes(kind));
  const option = name => args.find(value => value.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
  const fixtureFile = option('fixture-file'), scenario = option('scenario') ?? 'all';
  assert.ok(['all', 'global-pending', 'subject-drift'].includes(scenario));
  if (kind === 'dependency') assert.ok(fixtureFile, 'Dependency probe reuses API-verified owned fixtures');
  else assert.ok(!fixtureFile, 'Injection probe needs new creation closures, not deserialized fixtures');
  assert.ok(process.env.CU05_RUNTIME_HOOKS_MODULE, 'Main-owned adapter path CU05_RUNTIME_HOOKS_MODULE required');
  const c = config(), store = privateStore(randomUUID());
  const report = { runId: store.state.runId, kind, scenario, synthetic: true, INJECTED: true, pass: false, stages: [] };
  const save = () => writeFileSync(resolve(store.dir, 'result.json'), JSON.stringify(report, null, 2));
  const stage = async (name, action) => {
    const entry = { name, status: 'RUNNING' }; report.stages.push(entry); save();
    try { await action(); entry.status = 'PASS'; }
    catch (error) { entry.status = 'FAIL'; entry.errorCategory = error?.name === 'AssertionError' ? 'ASSERTION' : 'EXECUTION'; entry.operator = error?.operator; if (typeof error?.actual === 'number' || typeof error?.actual === 'boolean') entry.actual = error.actual; if (typeof error?.expected === 'number' || typeof error?.expected === 'boolean') entry.expected = error.expected; entry.locations = [...new Set(String(error?.stack ?? '').match(/[a-zA-Z-]+\.mjs:\d+:\d+/g) ?? [])]; throw error; }
    finally { save(); appendFileSync(resolve(store.dir, 'run.log'), JSON.stringify({ name, status: entry.status }) + '\n'); }
  };
  let hooks;
  try {
    const session = createSession(c);
    const api = session.api;
    session.api = async (...input) => {
      const result = await api(...input);
      (report.requests ??= []).push({ owner: input[0], path: input[1].split('?')[0], method: input[2] ?? 'GET', status: result.status, code: /^[A-Z_]+$/.test(result.body?.code ?? '') ? result.body.code : undefined });
      save(); return result;
    };
    const adapter = await import(pathToFileURL(resolve(process.env.CU05_RUNTIME_HOOKS_MODULE)).href);
    assert.equal(typeof adapter.createHooks, 'function', 'Adapter must export createHooks({config,session,store,report,stage})');
    hooks = await adapter.createHooks({ config: c, session, store, report, stage });
    const browserProbe = hooks.browserProbe ?? adapter.browserProbe;
    assert.equal(typeof browserProbe, 'function', 'Real browserProbe mandatory; no no-op success adapter');
    let fixture;
    if (kind === 'dependency') {
      const previous = JSON.parse(readFileSync(fixtureFile, 'utf8'));
      assert.equal(previous.synthetic, true); fixture = previous.fixture;
      assert.ok(fixture?.jobs.every(job => job.assignmentId), 'API verification must have identified both real assignments');
      store.state.sourceRunId = previous.runId;
      const { dependencyProbes } = await import('./dependency.mjs');
      await dependencyProbes(c, session, fixture, hooks, stage, browserProbe);
    } else {
      if (scenario !== 'global-pending') assert.equal(hooks.subjectDriftMode, 'linked-pair', 'Main approval of linked-pair subject injection required; column-only conflicts with CHECK');
      hooks.injectionScenario = scenario;
      await stage('fixtures-new-owned-injection-cohort', async () => { fixture = await createFixtures(session, store); store.state.fixture = fixture; store.save(); });
      const { injectionProbes } = await import('./injections.mjs');
      await injectionProbes(c, session, fixture, store, hooks, stage, browserProbe);
    }
    report.pass = true;
  } catch (error) {
    process.exitCode = 1;
    if (error?.code === 'CU05_DIRECT_RESTORE_FAILED_PROXY_RETAINED_FORWARDING') {
      report.errorCode = error.code;
      report.runtimeProtection = { forwardingProxyRetained: true, pid: process.pid, proxyUrl: error.proxyUrl };
      store.state.runtimeProtection = report.runtimeProtection;
    } else report.errorCode = 'CU05_INTEGRATION_FAILED';
  } finally {
    try { await hooks?.close?.(); report.hooksClose = hooks ? 'PASS' : 'NOT_CREATED'; }
    catch { report.hooksClose = 'FAIL'; report.pass = false; report.errorCode ??= 'CU05_HOOKS_CLOSE_FAILED'; process.exitCode = 1; }
    store.save(); save(); writeFileSync(resolve(store.dir, 'run.exit'), report.pass ? '0\n' : '1\n');
    console.log(JSON.stringify({ runId: report.runId, kind, pass: report.pass, errorCode: report.errorCode, runtimeProtection: report.runtimeProtection }));
  }
  return report;
}
