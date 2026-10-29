/** Explicit acceptance fixture: one owned customer edit, then verify a seed rerun is conservative. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function main(args = process.argv.slice(2)) {
  assert.ok(args.includes('--run'));
  const phase = args.find(a => a.startsWith('--phase='))?.slice(8);
  assert.ok(['edit', 'verify'].includes(phase));
  const { privateWrite, session } = await import('./demo.mjs');
  const demo = JSON.parse(readFileSync('/demo-state/manifest.json', 'utf8')); assert.ok(demo.completedAt);
  const admin = JSON.parse(readFileSync('/run/config/admin-account.json', 'utf8'));
  const transport = session(demo.publicOrigin, admin, {});
  const file = '/demo-state/repeat-proof.private.json';
  const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const commands = Object.entries(demo.steps).map(([key, step]) => ({ key, body: step.body, id: step.result.id ?? step.result.sagaId }));
  const credentials = fingerprint(demo.accounts);
  let proof = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { scenarioId: demo.scenarioId, credentials, commands };
  assert.equal(proof.scenarioId, demo.scenarioId);
  const customerId = demo.steps['mechanicA.customer'].result.id;
  if (phase === 'edit') {
    if (!proof.editCommand) {
      const current = await transport.api('operations', '/customers/' + customerId);
      proof.editCommand = { operationId: randomUUID(), expectedVersion: current.version, firstName: current.firstName, lastName: current.lastName, document: current.document, email: current.email, phone: '+59170000123' };
      privateWrite(file, proof);
    }
    if (!proof.edited) {
      await transport.api('operations', '/customers/' + customerId, 'PUT', proof.editCommand);
      proof.edited = true; privateWrite(file, proof);
    }
  } else {
    assert.equal(proof.edited, true);
    assert.ok(credentials === proof.credentials, 'Credential fingerprint must remain identical');
    assert.ok(fingerprint(commands) === fingerprint(proof.commands), 'Seed command bodies, IDs and operation IDs must remain identical');
    const current = await transport.api('operations', '/customers/' + customerId);
    assert.equal(current.phone, proof.editCommand.phone, 'Seed must preserve the business edit');
    const employees = await transport.api('employees', '/employees?search=' + encodeURIComponent('DEMO-' + demo.scenarioId.slice(0, 8).toUpperCase()));
    assert.equal(employees.total, 5);
    const orders = await transport.api('operations', '/orders?limit=100');
    const quotes = await transport.api('finance', '/quotes?limit=100');
    assert.equal(orders.total, 2); assert.equal(quotes.total, 2);
    for (const key of ['mechanicA', 'mechanicB']) {
      const identity = await transport.login(demo.accounts[key]);
      const response = await fetch('http://operations:8081/agenda/me?from=' + demo.date + '&to=' + demo.date, { headers: { Authorization: 'Bearer ' + identity.token }, signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200);
      const page = await response.json(); assert.equal(page.total, 1);
      assert.equal(page.items[0].orderId, demo.steps[key + '.order'].result.id);
      assert.equal(page.items[0].confirmationObservation, 'observed', 'Real publisher/Inbox must have observed global confirmation');
    }
    proof.verified = true; privateWrite(file, proof);
  }
  console.log(JSON.stringify({ phase, pass: true, ...(phase === 'verify' ? { credentialsPreserved: true, noDuplicateCommands: true, businessEditPreserved: true } : { editedOwnedCustomer: true }) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('FAIL repeat proof ' + (error.name === 'AssertionError' ? 'ASSERTION' : 'EXECUTION') + '; private diagnostics omitted'); process.exitCode = 1; });
}
