import { describe, expect, it, vi } from 'vitest';
import { HttpOperationsGateway } from './operations-gateway.js';

describe('CU11/CU12 REST boundary', () => {
  it('uses the narrow CU08 owner picker and forwards the caller token', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ items: [], total: 0, limit: 20, offset: 0 }),
        ),
      );
    const gateway = new HttpOperationsGateway(
      'http://127.0.0.1:8081',
      transport,
    );
    await gateway.vehicleHistoryVehicles(
      { search: 'AB', limit: 20 },
      'human-token',
    );
    expect(transport.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8081/vehicles/service-history/vehicles?limit=20&search=AB',
    );
    expect(
      new Headers(transport.mock.calls[0][1]?.headers).get('Authorization'),
    ).toBe('Bearer human-token');
  });
  it('proxies CU08 private evidence as bounded bytes with the human bearer', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': '2',
          'Content-Disposition': "attachment; filename*=UTF-8''inspection.png",
        },
      }),
    );
    const gateway = new HttpOperationsGateway(
      'http://127.0.0.1:8081',
      transport,
    );
    const file = await gateway.vehicleServiceHistoryEvidence(
      'vehicle-1',
      'order-1',
      'evidence-1',
      'human-token',
    );
    expect(transport.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8081/vehicles/vehicle-1/service-history/order-1/evidence/evidence-1',
    );
    expect(
      new Headers(transport.mock.calls[0][1]?.headers).get('Authorization'),
    ).toBe('Bearer human-token');
    expect([...file.bytes]).toEqual([1, 2]);
    expect(file.fileName).toBe('inspection.png');
  });
  it('forwards the employee bearer to the bounded vehicle history owner routes', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ items: [] })));
    const gateway = new HttpOperationsGateway(
      'http://127.0.0.1:8081',
      transport,
    );
    await gateway.vehicleServiceHistory(
      'vehicle/id',
      { limit: 20, offset: 40 },
      'human-token',
    );
    expect(transport.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8081/vehicles/vehicle%2Fid/service-history?limit=20&offset=40',
    );
    expect(
      new Headers(transport.mock.calls[0][1]?.headers).get('Authorization'),
    ).toBe('Bearer human-token');
    await gateway.vehicleServiceHistoryEntry(
      'vehicle-1',
      'order-1',
      'human-token',
    );
    expect(transport.mock.calls[1][0]).toBe(
      'http://127.0.0.1:8081/vehicles/vehicle-1/service-history/order-1',
    );
  });
  it.each([
    'VEHICLE_ALREADY_IN_RECEPTION',
    'MILEAGE_REGRESSION',
    'ORDER_ALREADY_EXISTS',
    'RECEPTION_NOT_FOUND',
    'ORDER_NOT_FOUND',
  ])('preserves the public owner error %s', async (code) => {
    const statusCode = code.endsWith('NOT_FOUND') ? 404 : 409;
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code, message: 'private upstream detail' }),
          { status: statusCode },
        ),
      );
    const gateway = new HttpOperationsGateway(
      'http://127.0.0.1:8081',
      transport,
    );
    await expect(
      gateway.createReception({ operationId: 'unit' }, 'unit'),
    ).rejects.toMatchObject({ code, statusCode });
  });
  it.each([true, false])(
    'forwards the open filter without changing false to absent (%s)',
    async (open) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ items: [], total: 0 })),
        );
      const gateway = new HttpOperationsGateway(
        'http://127.0.0.1:8081',
        transport,
      );
      await gateway.receptions({ open }, 'unit');
      expect(transport.mock.calls[0][0]).toBe(
        'http://127.0.0.1:8081/receptions?open=' + open,
      );
    },
  );
  it('does not publish unrecognized upstream codes or messages', async () => {
    const gateway = new HttpOperationsGateway(
      'http://127.0.0.1:8081',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ code: 'PRIVATE_ERROR', message: 'private' }),
            { status: 409 },
          ),
        ),
    );
    await expect(
      gateway.createReception({ operationId: 'unit' }, 'unit'),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      message: 'VERSION_CONFLICT',
    });
  });
});
