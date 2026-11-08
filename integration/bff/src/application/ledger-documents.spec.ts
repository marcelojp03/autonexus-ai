import { describe, expect, it, vi } from 'vitest';
import { HttpLedgerGateway } from './ledger-gateway.js';
const id = 'aaaaaaaa-1111-4111-8111-111111111111';
const document = { id, fileName: 'fixture.png', contentType: 'image/png', sizeBytes: 100, sha256: 'a'.repeat(64), state: 'pending', createdAt: '2026-11-07T00:00:00Z', expenseId: null };
const target = { url: '/finance-files/documents/' + id + '/content', method: 'PUT', expiresAt: '2026-11-07T00:02:00Z', headersJson: JSON.stringify({ 'X-Finance-Grant': 'b'.repeat(64), 'Content-Type': 'image/png' }) };
function setup(payload: unknown) {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
  return { gateway: new HttpLedgerGateway('http://127.0.0.1:8000', transport), transport };
}
describe('Finance-owned private document metadata', () => {
  it('requests its upload through the exact owner route and preserves input', async () => {
    const input = { operationId: id, fileName: 'fixture.png', contentType: 'image/png', sizeBytes: 100, sha256: 'a'.repeat(64) };
    const { gateway, transport } = setup({ document: { ...document, objectKey: 'private' }, upload: target, replayed: false });
    expect(await gateway.call('requestExpenseDocument', { input }, 'human')).toEqual({ document, upload: target, replayed: false });
    expect(transport.mock.calls[0][0]).toBe('http://127.0.0.1:8000/expense-documents');
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual(input);
  });
  it('confirms by path and forwards only operationId; owner returns the document directly', async () => {
    const { gateway, transport } = setup(document);
    expect(await gateway.call('confirmExpenseDocument', { input: { operationId: id, documentId: id } }, 'human')).toEqual(document);
    expect(transport.mock.calls[0][0]).toBe('http://127.0.0.1:8000/expense-documents/' + id + '/confirm');
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toEqual({ operationId: id });
  });
  it('downloads only a relative fixed-route GET target', async () => {
    const download = { ...target, method: 'GET', headersJson: JSON.stringify({ 'X-Finance-Grant': 'b'.repeat(64) }) };
    const { gateway, transport } = setup(download);
    expect(await gateway.call('expenseDocumentDownload', { documentId: id }, 'human')).toEqual(download);
    expect(transport.mock.calls[0][0]).toBe('http://127.0.0.1:8000/expense-documents/' + id + '/download');
  });
  it.each([
    { url: 'https://outside.invalid/file' }, { url: target.url + '?grant=private' }, { url: '/finance-files/documents/other/content' },
    { method: 'GET' }, { headersJson: '{bad' }, { headersJson: JSON.stringify({ Authorization: 'Bearer private' }) },
    { headersJson: JSON.stringify({ 'X-Finance-Grant': 'short' }) },
  ])('rejects malformed owner upload capability %j', async change => {
    const { gateway } = setup({ document, upload: { ...target, ...change }, replayed: false });
    await expect(gateway.call('requestExpenseDocument', { input: { operationId: id, fileName: 'fixture.png', contentType: 'image/png', sizeBytes: 100, sha256: 'a'.repeat(64) } }, 'human')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
  it.each(['request_document', 'confirm_document'])('reconciles %s without retaining an ephemeral grant', async action => {
    const payload = { operationId: id, action, outcome: 'applied', status: 200, committedAt: '2026-11-07T00:00:00Z', errorCode: null, resultJson: JSON.stringify({ document, replayed: false, upload: target }) };
    const { gateway } = setup(payload);
    const result = await gateway.call('financialOperation', { operationId: id }, 'human') as { resultJson: string };
    expect(JSON.parse(result.resultJson)).toEqual({ document, replayed: false });
    expect(result.resultJson).not.toContain('X-Finance-Grant');
  });
});
