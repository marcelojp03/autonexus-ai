import assert from 'node:assert/strict';
import test from 'node:test';
import { canReconcileInitialDefaults } from './bootstrap/identity.mjs';
const stock = [{ name: 'offline_access', clientRole: false }, { name: 'uma_authorization', clientRole: false }, { name: 'manage-account', clientRole: true, containerId: 'account-client' }, { name: 'view-profile', clientRole: true, containerId: 'account-client' }];
test('partial initial provision can remove only stock default authorities, never arbitrary roles', () => {
  assert.equal(canReconcileInitialDefaults(stock, 'account-client', false), true);
  for (const role of [{ name: 'administrador', clientRole: false }, { name: 'custom_role', clientRole: false }, { name: 'manage-account', clientRole: true, containerId: 'foreign-client' }]) assert.equal(canReconcileInitialDefaults([...stock, role], 'account-client', false), false);
});
test('completed identity policy rejects later drift rather than silently overwriting it', () => {
  assert.equal(canReconcileInitialDefaults([], 'account-client', true), true);
  assert.equal(canReconcileInitialDefaults(stock, 'account-client', true), false);
  assert.equal(canReconcileInitialDefaults(null, 'account-client', false), false);
});
