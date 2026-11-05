import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expiryOf } from './verify-s3-expiry.mjs';
const base = 'https://autonexus-ai-evidencias.s3.us-east-1.amazonaws.com/evidence/synthetic?';
test('expiry uses the signed timestamp and actual TTL, not the test clock', () => {
  assert.deepEqual(expiryOf(base + 'X-Amz-Date=20261105T140000Z&X-Amz-Expires=300'), { ttl: 300, expiresAt: Date.parse('2026-11-05T14:05:00Z') });
  assert.equal(expiryOf(base.replace('.s3.us-east-1.', '.s3.') + 'X-Amz-Date=20261105T140000Z&X-Amz-Expires=300').ttl, 300);
});
test('refuses non-AWS, non-HTTPS, malformed or unexpectedly long expiry', () => {
  for (const value of [base.replace('https:', 'http:') + 'X-Amz-Date=20261105T140000Z&X-Amz-Expires=300', base.replace('amazonaws.com', 'example.invalid') + 'X-Amz-Date=20261105T140000Z&X-Amz-Expires=300', base + 'X-Amz-Date=bad&X-Amz-Expires=300', base + 'X-Amz-Date=20261105T140000Z&X-Amz-Expires=601']) assert.throws(() => expiryOf(value));
});
