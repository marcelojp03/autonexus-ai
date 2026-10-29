import test from 'node:test';
import assert from 'node:assert/strict';
import { httpApi, withTransportRetry } from './bootstrap.mjs';

test('lost create response re-enters get-or-create with the same state, not a duplicate POST', async () => {
  const original = globalThis.fetch;
  let exists = false, creates = 0, attempts = 0;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    if (options.method === 'GET') return exists ? Response.json({ clientId: 'synthetic-client' }) : new Response(null, { status: 404 });
    creates++; bodies.push(options.body); exists = true;
    throw new TypeError('Synthetic response loss after commit');
  };
  try {
    const api = httpApi('http://synthetic.invalid', 'Bearer synthetic');
    const value = await withTransportRetry(async () => {
      attempts++;
      const current = await api('/client', 'GET', undefined, [200, 404]);
      if (!current) await api('/client', 'POST', { clientId: 'synthetic-client' });
      return api('/client');
    }, { wait: async () => {} });
    assert.equal(value.clientId, 'synthetic-client'); assert.equal(creates, 1); assert.equal(attempts, 2); assert.equal(bodies.length, 1);
  } finally { globalThis.fetch = original; }
});
test('authorization and policy errors are fatal, while uncertain transport has a finite budget', async () => {
  for (const code of ['HTTP_STATUS_400', 'HTTP_STATUS_401', 'HTTP_STATUS_403', 'CLIENT_POLICY_DRIFT', 'CLIENT_SECRET_DRIFT']) {
    let attempts = 0;
    await assert.rejects(withTransportRetry(async () => { attempts++; throw new Error(code); }, { wait: async () => {} }), new RegExp(code));
    assert.equal(attempts, 1);
  }
  let attempts = 0;
  await assert.rejects(withTransportRetry(async () => { attempts++; throw new Error('HTTP_TRANSPORT_UNCERTAIN'); }, { attempts: 3, wait: async () => {} }), /HTTP_TRANSPORT_UNCERTAIN/);
  assert.equal(attempts, 3);
});
