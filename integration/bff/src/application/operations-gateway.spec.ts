import { describe, expect, it, vi } from 'vitest';
import { HttpOperationsGateway } from './operations-gateway.js';

describe('CU11/CU12 REST boundary', () => {
  it.each(['VEHICLE_ALREADY_IN_RECEPTION', 'MILEAGE_REGRESSION', 'ORDER_ALREADY_EXISTS', 'RECEPTION_NOT_FOUND', 'ORDER_NOT_FOUND'])('preserves the public owner error %s', async code => {
    const statusCode = code.endsWith('NOT_FOUND') ? 404 : 409;
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code, message: 'private upstream detail' }), { status: statusCode }));
    const gateway = new HttpOperationsGateway('http://127.0.0.1:8081', transport);
    await expect(gateway.createReception({ operationId: 'unit' }, 'unit')).rejects.toMatchObject({ code, statusCode });
  });
  it.each([true, false])('forwards the open filter without changing false to absent (%s)', async open => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0 })));
    const gateway = new HttpOperationsGateway('http://127.0.0.1:8081', transport);
    await gateway.receptions({ open }, 'unit');
    expect(transport.mock.calls[0][0]).toBe('http://127.0.0.1:8081/receptions?open=' + open);
  });
  it('does not publish unrecognized upstream codes or messages', async () => {
    const gateway = new HttpOperationsGateway('http://127.0.0.1:8081', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: 'PRIVATE_ERROR', message: 'private' }), { status: 409 })));
    await expect(gateway.createReception({ operationId: 'unit' }, 'unit')).rejects.toMatchObject({ code: 'VERSION_CONFLICT', message: 'VERSION_CONFLICT' });
  });
});
