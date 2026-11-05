import test from 'node:test';
import assert from 'node:assert/strict';
import { safeXmlCode, uploadHeaders } from './resume-s3-reupload.mjs';

test('XML diagnostics retain only a bounded AWS code, never message, key or URL', () => {
  assert.equal(safeXmlCode('<Error><Code>SignatureDoesNotMatch</Code><Message>private</Message></Error>'), 'SignatureDoesNotMatch');
  for (const text of ['', '<Code>contains spaces</Code>', '<Code>' + 'A'.repeat(65) + '</Code>', '<Message>private</Message>']) {
    assert.equal(safeXmlCode(text), null);
  }
});

test('upload uses exact checksum, conditional write, no bearer, and actual byte length', () => {
  const upload = { method: 'PUT', url: 'https://autonexus-ai-evidencias.s3.amazonaws.com/',
    headersJson: JSON.stringify({ 'Content-Type': 'image/jpeg', 'x-amz-checksum-sha256': 'synthetic-checksum', 'If-None-Match': '*' }) };
  const headers = uploadHeaders(upload, 'synthetic-checksum', 123);
  assert.equal(headers.get('content-length'), '123');
  assert.equal(headers.has('authorization'), false);
  assert.throws(() => uploadHeaders(upload, 'different-checksum', 123));
  assert.throws(() => uploadHeaders({ ...upload, headersJson: '{}' }, 'synthetic-checksum', 123));
  assert.throws(() => uploadHeaders({ ...upload, headersJson: JSON.stringify({ ...JSON.parse(upload.headersJson), Authorization: 'synthetic' }) }, 'synthetic-checksum', 123));
});
