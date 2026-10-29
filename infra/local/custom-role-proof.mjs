/** Optional CU02/CU05 regression for the new IdP deployment, with an owned identity only. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { startRelay, chromiumRuntime } from './acceptance.mjs';

export async function main(args = process.argv.slice(2)) {
  assert.ok(args.includes('--run'));
  const { session, privateWrite, prepareCredential, civilDate } = await import('./demo.mjs');
  const demo = JSON.parse(readFileSync('/demo-state/manifest.json', 'utf8')); assert.ok(demo.completedAt);
  const admin = JSON.parse(readFileSync('/run/config/admin-account.json', 'utf8'));
  const client = JSON.parse(readFileSync('/run/config/employees-client.json', 'utf8'));
  const transport = session(demo.publicOrigin, admin, client);
  const runId = randomUUID(), suffix = runId.replaceAll('-', '').slice(0, 12);
  const account = { key: 'control', roleName: 'agenda_proof_' + suffix, password: randomBytes(32).toString('hex'), credentialState: 'prepared' };
  const state = { runId, accounts: { control: account }, steps: {} };
  const file = '/evidence/custom-role-' + runId + '.private.json';
  const ledger = { state, save: () => privateWrite(file, state) }; ledger.save();
  const report = { runId, pass: false, noNewJobs: true, privacy: true };
  privateWrite('/evidence/custom-role-result.json', report);
  let employee, browser, relay, inactiveProbeToken;
  try {
    state.roleCommand = { operationId: randomUUID(), name: account.roleName, description: 'Prueba local CU05 de rol personalizado', permissions: ['agenda:read:self'] }; ledger.save();
    const role = (await transport.api('employees', '/security/roles', 'POST', state.roleCommand)).role;
    assert.equal(role.name, account.roleName); assert.equal(role.syncStatus, 'synced');
    const marker = 'PROOF-' + suffix.toUpperCase();
    state.employeeCommand = { operationId: randomUUID(), firstName: 'Control', lastName: marker, document: marker, email: marker.toLowerCase() + '@example.invalid', phone: '+59170000000', jobTitle: 'Mecánico de prueba', startDate: civilDate(), specialties: ['Diagnóstico general'], mechanicEnabled: true, access: { requested: true } }; ledger.save();
    employee = (await transport.api('employees', '/employees', 'POST', state.employeeCommand)).employee;
    for (let i = 0; i < 120 && employee.access.status !== 'synced'; i++) { await pause(500); employee = await transport.api('employees', '/employees/' + employee.id); }
    assert.equal(employee.access.status, 'synced');
    Object.assign(account, { employeeId: employee.id, username: 'employee-' + employee.id, subject: employee.access.subject });
    state.steps['employee.control'] = { state: 'done', result: employee }; ledger.save();
    await prepareCredential(ledger, account, transport);
    state.assignCommand = { operationId: randomUUID(), roleName: account.roleName }; ledger.save();
    const assigned = await transport.api('employees', '/security/employees/' + employee.id + '/roles', 'POST', state.assignCommand);
    assert.equal(assigned.assignment.syncStatus, 'synced');
    const identity = await transport.login(account);
    const claims = JSON.parse(Buffer.from(identity.token.split('.')[1], 'base64url'));
    assert.ok(claims.realm_access.roles.includes(account.roleName));
    assert.ok(!claims.realm_access.roles.some(role => ['administrador', 'mecanico', 'jefe_taller', 'recepcionista', 'responsable_financiero'].includes(role)));
    relay = await startRelay(demo.publicOrigin);
    const gql = async query => {
      const r = await fetch(demo.publicOrigin + '/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + identity.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(15000) });
      assert.equal(r.status, 200); return r.json();
    };
    const own = await gql('{myAgenda{total}}'); assert.ok(!own.errors); assert.equal(own.data.myAgenda.total, 0);
    for (const query of ['{teamAgenda{total}}', '{orders{total}}']) {
      const denied = await gql(query); assert.ok(denied.data == null); assert.ok(denied.errors.some(e => e.extensions.code === 'FORBIDDEN' && e.extensions.statusCode === 403));
    }
    report.customOnlyToken = true; report.ownerAndBffPermission = true;
    const chromium = chromiumRuntime();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(); page.setDefaultTimeout(45000);
    await page.goto(demo.publicOrigin, { waitUntil: 'domcontentloaded' }); await page.locator('#session-login').click();
    await page.locator('#username').waitFor(); assert.equal(new URL(page.url()).origin, demo.publicOrigin);
    await page.locator('#username').fill(account.username); await page.locator('#password').fill(account.password); await page.locator('#kc-login').click();
    await page.locator('#session-logout').waitFor({ state: 'visible' });
    await page.goto(demo.publicOrigin + '/employees/agenda', { waitUntil: 'domcontentloaded' });
    await page.locator('anx-agenda h2').filter({ hasText: 'Mi agenda' }).waitFor();
    await page.locator('anx-agenda p[role=status]:not([aria-live])').waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('anx-agenda input[name=from]').waitFor();
    await page.locator('#session-logout').click(); await page.locator('#session-login').waitFor({ state: 'visible' });
    inactiveProbeToken = (await transport.login(account)).token;
    report.realBrowserMountReload = true; report.pass = true;
  } finally {
    await browser?.close(); await relay?.close();
    if (employee) {
      const current = await transport.api('employees', '/employees/' + employee.id);
      assert.equal(current.document, state.employeeCommand.document);
      if (current.status === 'active') {
        state.deactivateCommand = { operationId: randomUUID(), expectedVersion: current.version }; ledger.save();
        await transport.api('employees', '/employees/' + employee.id + '/deactivate', 'POST', state.deactivateCommand);
      }
      report.cleanup = 'owned-control-inactive-history-preserved';
      if (inactiveProbeToken) {
        const denied = await fetch('http://employees:3002/agenda/context?scope=self', { headers: { Authorization: 'Bearer ' + inactiveProbeToken }, signal: AbortSignal.timeout(15000) });
        assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'AGENDA_ACCESS_DENIED');
        const bff = await fetch('http://bff:3004/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + inactiveProbeToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{myAgenda{total}}' }), signal: AbortSignal.timeout(15000) });
        assert.equal(bff.status, 200); const body = await bff.json(); assert.ok(body.data == null);
        assert.ok(body.errors.some(e => ['FORBIDDEN', 'AGENDA_ACCESS_DENIED'].includes(e.extensions.code) && e.extensions.statusCode === 403));
        report.inactiveValidTokenDenied = true;
      }
    }
    privateWrite('/evidence/custom-role-result.json', report);
    console.log(JSON.stringify(report));
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('FAIL custom role proof; private diagnostics omitted'); process.exitCode = 1; });
}
