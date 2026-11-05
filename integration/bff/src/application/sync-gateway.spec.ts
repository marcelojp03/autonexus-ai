import { HttpSyncGateway } from './sync-gateway.js';

const ID = '11111111-1111-4111-8111-111111111111';
const INPUT = { overlayId: ID, deviceId: 'pwa', createdAt: '2026-11-04T12:00:00Z', operationsJson: '[{}]' };

describe('CU27 fixed coordinator gateway', () => {
  it('projects durable results without signed URLs, identity, payload or token', async () => {
    const operation = { operationId: ID, overlayId: ID, entity: 'advance', state: 'applied', attempts: [{}],
      subject: 'private', payload: { secret: true }, lastResult: { status: 201, code: 'APPLIED' },
      lastBody: { advanceId: ID, version: 2, upload: { url: 'signed-secret' }, nested: [{ downloadUrl: 'secret' }] } };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ operation }));
    const gateway = new HttpSyncGateway('http://127.0.0.1:3005', transport);
    const result = await gateway.operation(ID, 'human-token');
    expect(result).toEqual({ overlayId: ID, operation: { operationId: ID, overlayId: ID, entity: 'advance', state: 'applied',
      attemptCount: 1, lastStatus: 201, lastCode: 'APPLIED', resultJson: JSON.stringify({ advanceId: ID, version: 2,
        upload: { url: '[redacted]' }, nested: [{ downloadUrl: '[redacted]' }] }) } });
    expect(JSON.stringify(result)).not.toMatch(/signed-secret|human-token|private|payload/);
    expect(operation.lastBody.upload.url).toBe('signed-secret');
    expect(transport).toHaveBeenCalledWith('http://127.0.0.1:3005/sync/operations/' + ID,
      expect.objectContaining({ cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer human-token' } }));
  });

  it('only sends the registration envelope and refreshes the bearer on every request', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ overlay: { ...INPUT, operations: [] } }));
    const gateway = new HttpSyncGateway('http://127.0.0.1:3005', transport);
    await gateway.register({ ...INPUT, subject: 'spoofed', url: 'http://client.invalid' } as typeof INPUT, 'first');
    await gateway.overlay(ID, 'renewed');
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual({ overlayId: ID, deviceId: 'pwa', createdAt: INPUT.createdAt, operations: [{}] });
    expect(transport.mock.calls[1][1]!.headers).toEqual({ Authorization: 'Bearer renewed' });
  });

  it.each(['invalid', '..', 'http://client.invalid/path'])('rejects client routing value %s before transport', async id => {
    const transport = vi.fn<typeof fetch>();
    const gateway = new HttpSyncGateway('http://127.0.0.1:3005', transport);
    await expect(gateway.push(id, 'token')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(gateway.operation(id, 'token')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['bad json', '[]', '{}', '[', 'x'.repeat(60001)])('rejects malformed or oversized operations', async operationsJson => {
    const transport = vi.fn<typeof fetch>();
    await expect(new HttpSyncGateway('http://127.0.0.1:3005', transport).register({ ...INPUT, operationsJson }, 'token'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([[401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'OVERLAY_NOT_FOUND'], [409, 'IDEMPOTENCY_CONFLICT'], [503, 'PERSISTENCE_UNAVAILABLE']])
  ('preserves safe upstream failure %s', async (status, code) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code, message: 'private detail' }, { status: status as number }));
    await expect(new HttpSyncGateway('http://127.0.0.1:3005', transport).overlay(ID, 'token')).rejects.toMatchObject({ statusCode: status, code });
  });

  it('reports transport failure as unavailable, not a business rejection', async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error('private failure'));
    await expect(new HttpSyncGateway('http://127.0.0.1:3005', transport).push(ID, 'token')).rejects.toMatchObject({ statusCode: 503, code: 'SERVICE_UNAVAILABLE' });
  });
});
