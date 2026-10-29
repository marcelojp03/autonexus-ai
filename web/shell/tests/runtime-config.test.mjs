import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePublicRuntimeConfig } from '../../browser-auth/session.ts';

const origin = 'http://127.0.0.1:4280';
const valid = () => ({ version: 1, oidcUrl: origin + '/identity', graphqlUrl: origin + '/graphql', technicalUrls: { employees: origin + '/technical/employees', operations: origin + '/technical/operations' } });
test('deployment config uses one exact public origin and immutable non-secret endpoints', () => {
  const parsed = parsePublicRuntimeConfig(valid(), origin);
  assert.deepEqual(parsed, valid()); assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed.technicalUrls));
});
test('deployment config rejects unexpected, secret, foreign or malformed values', () => {
  for (const value of [null, {}, { ...valid(), version: 2 }, { ...valid(), password: 'not-a-secret-fixture' }, { ...valid(), graphqlUrl: 'http://other.invalid/graphql' }, { ...valid(), oidcUrl: origin + '/identity?redirect=outside' }, { ...valid(), oidcUrl: origin + '/identity#fragment' }, { ...valid(), graphqlUrl: 'http://user:placeholder@127.0.0.1:4280/graphql' }, { ...valid(), technicalUrls: { ...valid().technicalUrls, finance: origin + '/finance' } }, { ...valid(), technicalUrls: { employees: origin + '/employees', operations: origin + '/operations' } }]) assert.throws(() => parsePublicRuntimeConfig(value, origin), /pública inválida/);
});
