import { HttpAgendaGateway, type AgendaQuery } from './agenda-gateway.js';
import { WORK, PAGE, EMPLOYEES_PAGE } from '../../test/agenda-fixtures.js';

const O = 'http://127.0.0.1:8081';
const E = 'http://127.0.0.1:3002';
function setup(body: unknown = PAGE, status = 200) {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body, { status }));
  return { transport, gateway: new HttpAgendaGateway(O, E, transport) };
}
describe('CU05 HTTP adapter with explicit fake transport (not real integration)', () => {
  it('forwards the human bearer and only self filters, without inferred identity', async () => {
    const { transport, gateway } = setup();
    await gateway.list('self', { from: '2026-10-01', to: '2026-10-31', status: 'confirmed', priority: 'alta', limit: 100, offset: 2147483647 }, 'synthetic-token');
    expect(transport).toHaveBeenCalledWith(O + '/agenda/me?from=2026-10-01&to=2026-10-31&status=confirmed&priority=alta&limit=100&offset=2147483647',
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer synthetic-token' }, redirect: 'error', signal: expect.any(AbortSignal) }));
  });
  it('only permits employeeId on team, and encodes selector search', async () => {
    const { transport, gateway } = setup();
    await expect(gateway.list('self', { employeeId: 'other' }, 't')).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(transport).not.toHaveBeenCalled();
    await gateway.list('team', { employeeId: 'a&scope=self' }, 'human');
    expect(transport.mock.calls[0][0]).toBe(O + '/agenda/team?employeeId=a%26scope%3Dself');
    transport.mockResolvedValueOnce(Response.json(EMPLOYEES_PAGE));
    await gateway.employees({ search: 'Name & surname', status: 'inactive', limit: 1, offset: 2 }, 'human');
    expect(transport.mock.calls[1][0]).toBe(E + '/agenda/team/employees?search=Name+%26+surname&status=inactive&limit=1&offset=2');
  });
  it.each(['self', 'team'] as const)('encodes assignment path for %s without accessing CRUD or internal APIs', async scope => {
    const { transport, gateway } = setup(WORK);
    expect(await gateway.work(scope, 'a/b?scope=team#', 'human')).toEqual(WORK);
    expect(transport.mock.calls[0][0]).toBe(O + '/agenda/' + (scope === 'self' ? 'me' : 'team') + '/a%2Fb%3Fscope%3Dteam%23');
  });
  it('drops null filters and leaves omitted dates/default paging to the owner', async () => {
    const { transport, gateway } = setup();
    await gateway.list('self', { from: null, limit: null } as unknown as AgendaQuery, 'human');
    expect(transport.mock.calls[0][0]).toBe(O + '/agenda/me');
    await gateway.list('self', { to: '2026-10-28' }, 'human');
    expect(transport.mock.calls[1][0]).toBe(O + '/agenda/me?to=2026-10-28');
  });
  it.each([
    { from: '2026-02-30' }, { from: '2026-10-1' }, { from: '2026-10-02', to: '2026-10-01' },
    { from: '2026-10-01', to: '2026-11-01' }, { limit: 0 }, { limit: 101 }, { limit: 1.5 },
    { limit: NaN }, { offset: Infinity }, { offset: -1 }, { offset: 2147483648 }, { offset: '1' },
    { status: 'reserved' }, { priority: 'unknown' }, { scope: 'team' }, { subject: 'other' },
  ])('rejects invalid/unknown filters before transport: %j', async query => {
    const { transport, gateway } = setup();
    await expect(gateway.list('self', query as AgendaQuery, 'human')).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('projects only agenda DTO fields, including nested records', async () => {
    const extra = { ...WORK, customerId: 'private', total: 999, quotation: { secret: true },
      employee: { ...WORK.employee, document: 'private', email: 'private' },
      vehicle: { ...WORK.vehicle, customerName: 'private' },
      services: WORK.services.map(service => ({ ...service, price: 999 })) };
    const { gateway } = setup({ ...PAGE, actor: { ...PAGE.actor, subject: 'private' }, items: [extra], credentials: 'private' });
    expect(await gateway.list('team', {}, 'human')).toEqual(PAGE);
    const selector = setup({ ...EMPLOYEES_PAGE, items: [{ ...WORK.employee, email: 'private' }] });
    expect(await selector.gateway.employees({}, 'human')).toEqual(EMPLOYEES_PAGE);
  });
  it.each([
    [403, 'AGENDA_ACCESS_DENIED'], [404, 'AGENDA_WORK_NOT_FOUND'], [400, 'VALIDATION_ERROR'],
    [503, 'AGENDA_DEPENDENCY_UNAVAILABLE'], [503, 'AGENDA_STATE_UNAVAILABLE'], [503, 'PERSISTENCE_UNAVAILABLE'],
    [401, 'UNAUTHENTICATED'], [500, 'AGENDA_DEPENDENCY_UNAVAILABLE'],
  ])('maps owner status %s to safe %s, never an empty list', async (status, code) => {
    const { gateway } = setup({ code, message: 'SQL private upstream token detail' }, status);
    await expect(gateway.list('self', {}, 'human')).rejects.toMatchObject({ statusCode: status === 500 ? 503 : status, code, message: code });
  });
  it('does not trust unknown or status-mismatched upstream codes', async () => {
    for (const code of ['PRIVATE_SQL_EXCEPTION', 'AGENDA_ACCESS_DENIED', '__proto__']) {
      const { gateway } = setup({ code }, 503);
      await expect(gateway.employees({}, 'human')).rejects.toMatchObject({ code: 'AGENDA_DEPENDENCY_UNAVAILABLE' });
    }
  });
  it('reports transport/JSON failure, malformed 200 and missing items instead of success []', async () => {
    const { gateway, transport } = setup();
    transport.mockRejectedValueOnce(new Error('private detail'));
    await expect(gateway.list('self', {}, 't')).rejects.toMatchObject({ code: 'AGENDA_DEPENDENCY_UNAVAILABLE' });
    transport.mockResolvedValueOnce(new Response('not json'));
    await expect(gateway.list('self', {}, 't')).rejects.toMatchObject({ code: 'AGENDA_DEPENDENCY_UNAVAILABLE' });
    for (const body of [null, [], { ...PAGE, items: null }, { ...PAGE, total: Infinity }, { ...PAGE, items: [{ ...WORK, status: 'reserved' }] }]) {
      transport.mockResolvedValueOnce(Response.json(body));
      await expect(gateway.list('self', {}, 't')).rejects.toMatchObject({ code: 'AGENDA_STATE_UNAVAILABLE' });
    }
  });
  it('preserves a genuine empty page and observed versions/pending observation', async () => {
    const empty = { ...PAGE, items: [], total: 0, limit: 1, offset: 10 };
    expect(await setup(empty).gateway.list('self', {}, 't')).toEqual(empty);
    expect(await setup(WORK).gateway.work('self', WORK.assignmentId, 't')).toEqual(WORK);
  });
});
