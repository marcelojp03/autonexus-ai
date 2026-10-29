import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinatorClientId, technicalScopes, participantAudiences, interactiveClients } from './cu15-identity.mjs';
test('CU15 identity is not an interactive client or a human/business permission', () => {
  assert.equal(interactiveClients.includes(coordinatorClientId), false);
  assert.equal(technicalScopes.length, new Set(technicalScopes).size);
  assert.equal(technicalScopes.length, 7);
  assert.ok(technicalScopes.every(scope => scope.startsWith('cu15.') && !scope.includes(':') && !scope.includes('manage') && !scope.includes('quotes.write') && !scope.includes('decide')));
});
test('technical token targets only its two remote participants', () => {
  assert.deepEqual(participantAudiences, ['autonexus-employees-api', 'autonexus-finance-api']);
});
