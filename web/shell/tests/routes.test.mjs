import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesModule, moduleForPath, moduleProps, modules } from '../src/routes.ts';
test('matches roots and nested history routes', () => {
  for (const module of ['employees', 'operations', 'finance']) {
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
  assert.deepEqual(modules, ['employees', 'operations', 'finance']);
  for (const module of modules) assert.deepEqual(moduleProps(module), { basePath: '/' + module, assetBase: '/mfs/' + module + '/' });
});
