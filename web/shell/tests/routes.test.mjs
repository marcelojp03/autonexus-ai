import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedModules, matchesModule, moduleForPath, moduleProps, modules, moduleEntryPermissions } from '../src/routes.ts';
test('finance entry admits each financial module without requiring quote access', () => {
  assert.deepEqual(moduleEntryPermissions.finance, ['quotes:read', 'payments:read', 'payments:write', 'expenses:read', 'expenses:write']);
  for (const permission of ['payments:read', 'payments:write', 'expenses:read', 'expenses:write']) {
    assert.ok(moduleEntryPermissions.finance.some(required => [permission].includes(required)));
  }
  assert.equal(moduleEntryPermissions.finance.some(required => ['orders:read'].includes(required)), false);
  assert.deepEqual(moduleEntryPermissions.intelligence, ['intelligence:read']);
});
test('matches roots and nested history routes', () => {
  for (const module of ['employees', 'operations', 'finance', 'intelligence']) {
    for (const suffix of ['', '/', '/widgets', '/dashboard/v1']) {
      assert.equal(matchesModule('/' + module + suffix, module), true);
      assert.equal(moduleForPath('/' + module + suffix), module);
    }
  }
});
test('rejects unknown routes and similar prefixes', () => {
  for (const path of ['/', '/unknown', '/employees-other', '/operations2', '/finance-other', '/Employees']) {
    assert.equal(moduleForPath(path), undefined);
  }
});
test('all modules receive their own route and resource base', () => {
  assert.deepEqual(modules, ['employees', 'operations', 'finance', 'intelligence']);
  for (const module of modules) assert.deepEqual(moduleProps(module), { basePath: '/' + module, assetBase: '/mfs/' + module + '/' });
});
test('workspace destinations come only from effective permissions, not role labels', () => {
  assert.deepEqual(authorizedModules([]), []);
  assert.deepEqual(authorizedModules(['agenda:read:self']), ['employees']);
  assert.deepEqual(authorizedModules(['agenda:read:self', 'orders:read', 'payments:read']), ['employees', 'operations', 'finance']);
  assert.deepEqual(authorizedModules(['mecanico']), []);
});
