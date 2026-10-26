import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkspacePath } from './workspace-path.mjs';

test('Compose Windows separator escaping retains exact workspace identity', () => {
  const bs = String.fromCharCode(92);
  const path = ['C:', 'Project', 'infra', 'keycloak'].join(bs);
  assert.equal(normalizeWorkspacePath(path), 'c:/project/infra/keycloak');
  assert.equal(normalizeWorkspacePath(path.replaceAll(bs, bs + bs)), 'c:/project/infra/keycloak');
  assert.notEqual(normalizeWorkspacePath(path + '/other'), normalizeWorkspacePath(path));
  assert.notEqual(normalizeWorkspacePath('C:/Project/.worktrees/cu01/infra/keycloak'), normalizeWorkspacePath(path));
});
