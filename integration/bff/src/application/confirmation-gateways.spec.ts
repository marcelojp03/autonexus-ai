import { HttpOperationsGateway } from './operations-gateway.js';
import { HttpEmployeesGateway } from './employees-gateway.js';

describe('CU15 HTTP adapters with explicit fake transport', () => {
  const base = 'http://127.0.0.1:8081';
  it('forwards the frozen body and bearer, accepting 202 without declaring success', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'running' }), { status: 202 }));
    const gateway = new HttpOperationsGateway(base, transport);
    const input = { operationId: 'operation', expectedVersion: 7, quoteId: 'quote', quoteVersion: 2, employeeId: 'employee', employeeVersion: 3, requiredSpecialty: 'frenos', startsAt: '2026-11-02T12:00:00Z', endsAt: '2026-11-02T13:00:00Z' };
    expect(await gateway.startServiceConfirmation('order/a', input, 'human')).toEqual({ status: 'running' });
    expect(transport).toHaveBeenLastCalledWith(base + '/orders/order%2Fa/confirmations', expect.objectContaining({ method: 'POST', body: JSON.stringify(input), headers: { Authorization: 'Bearer human', 'Content-Type': 'application/json' }, redirect: 'error' }));
    const retry = { operationId: 'retry', expectedVersion: 8 };
    await gateway.retryServiceConfirmation('saga', retry, 'human');
    expect(transport).toHaveBeenLastCalledWith(base + '/confirmations/saga/retry', expect.objectContaining({ body: JSON.stringify(retry) }));
  });
  it('uses only public GET endpoints and leaves direct arrays intact', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response('[]'));
    const gateway = new HttpOperationsGateway(base, transport);
    await gateway.confirmationSaga('id', 'human');
    expect(transport).toHaveBeenLastCalledWith(base + '/confirmations/id', expect.anything());
    await gateway.confirmationByOperation('op', 'human');
    expect(transport).toHaveBeenLastCalledWith(base + '/confirmations/operations/op', expect.anything());
    expect(await gateway.orderConfirmations('order', 'human')).toEqual([]);
    expect(transport).toHaveBeenLastCalledWith(base + '/orders/order/confirmations', expect.anything());
  });
  it.each([[404, 'CONFIRMATION_NOT_FOUND'], [404, 'OPERATION_NOT_FOUND'], [409, 'CONFIRMATION_TERMINAL'], [409, 'ORDER_NOT_CONFIRMABLE'], [409, 'ORDER_CONFIRMATION_IN_PROGRESS'], [409, 'ORDER_ALREADY_CONFIRMED'], [409, 'VERSION_CONFLICT'], [409, 'IDEMPOTENCY_CONFLICT'], [503, 'CU15_DISABLED']])('preserves public %i %s', async (status, code) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code, message: 'private details' }), { status }));
    await expect(new HttpOperationsGateway(base, transport).confirmationSaga('id', 'human')).rejects.toMatchObject({ statusCode: status, code, message: code });
  });
  it('encodes mechanic projection and availability filters with human authorization', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
    const gateway = new HttpEmployeesGateway(base, transport);
    await gateway.confirmationMechanics({ limit: 5, offset: 10, search: 'a&b' }, 'human');
    expect(transport).toHaveBeenLastCalledWith(base + '/staffing/mechanics?limit=5&offset=10&search=a%26b', expect.objectContaining({ headers: { Authorization: 'Bearer human' } }));
    await gateway.confirmationAvailability('id/a', '2026-11-02', 'human');
    expect(transport).toHaveBeenLastCalledWith(base + '/staffing/mechanics/id%2Fa/availability?date=2026-11-02', expect.anything());
  });
});
