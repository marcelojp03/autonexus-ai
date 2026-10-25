import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesModule, moduleForPath } from '../src/routes.ts';
test('matches roots and nested history routes', () => {
  for (const module of ['employees', 'operations']) {
    for (const suffix of ['', '/', '/widgets', '/dashboard/v1']) {
      assert.equal(matchesModule('/' + module + suffix, module), true);
      assert.equal(moduleForPath('/' + module + suffix), module);
    }
  }
});
test('rejects unknown routes and similar prefixes', () => {
  for (const path of ['/', '/unknown', '/employees-other', '/operations2', '/Employees']) {
    assert.equal(moduleForPath(path), undefined);
  }
});
