/** Explicit owner-outage acceptance; Docker control remains outside the test container. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function main(args = process.argv.slice(2)) {
  assert.ok(args.includes('--run'));
  const expected = args.find(a => a.startsWith('--expect='))?.slice(9); assert.ok(['down', 'up'].includes(expected));
  const { session, privateWrite } = await import('./demo.mjs');
  const demo = JSON.parse(readFileSync('/demo-state/manifest.json', 'utf8')); assert.ok(demo.completedAt);
  const identity = await session(demo.publicOrigin, {}, {}).login(demo.accounts.mechanicA);
  const response = await fetch('http://bff:3004/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + identity.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query($date:Date!){myAgenda(from:$date,to:$date){total items{orderId}}}', variables: { date: demo.date } }), signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); const body = await response.json();
  if (expected === 'down') {
    assert.ok(body.data == null, 'Unavailable owner must not return a success page');
    assert.ok(body.errors?.some(e => ['SERVICE_UNAVAILABLE', 'AGENDA_DEPENDENCY_UNAVAILABLE'].includes(e.extensions?.code) && e.extensions.statusCode === 503));
  } else {
    assert.ok(!body.errors); assert.equal(body.data.myAgenda.total, 1);
    assert.equal(body.data.myAgenda.items[0].orderId, demo.steps['mechanicA.order'].result.id);
  }
  const result = { expected, INJECTED: true, pass: true, ...(expected === 'down' ? { emptySuccessRejected: true } : { originalWorkRestored: true }) };
  privateWrite('/evidence/availability-' + expected + '.json', result); console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('FAIL owner availability proof; private diagnostics omitted'); process.exitCode = 1; });
