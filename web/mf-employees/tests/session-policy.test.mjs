import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canPresentSession } from '../src/app/auth/session-policy.ts';
const valid = { mode: 'oidc', phase: 'authenticated', authenticated: true, identity: { subject: 'synthetic', username: 'staff', roles: ['mecanico'] } };
test('fails closed for absent, demo, stale, anonymous or malformed sessions', () => {
  for (const state of [undefined, null, {}, { ...valid, mode: 'demo' }, { ...valid, phase: 'error' }, { ...valid, authenticated: false }, { ...valid, identity: null }, { ...valid, identity: { roles: ['Bad!'] } }, { ...valid, identity: { roles: [] } }]) assert.equal(canPresentSession(state), false);
});
test('custom-only role can present CU05 while owners still decide permissions', () => {
  assert.equal(canPresentSession({ ...valid, identity: { ...valid.identity, roles: ['agenda_custom'] } }), true);
});
test('each recognized role can present the technical container, not CRUD authorization', () => {
  for (const role of ['administrador', 'recepcionista', 'mecanico', 'jefe_taller', 'responsable_financiero']) assert.equal(canPresentSession({ ...valid, identity: { ...valid.identity, roles: [role] } }), true);
});
