import { BusinessGraphql, BadRequest } from './business-graphql.js';
import { HttpAgendaGateway } from './agenda-gateway.js';
import { HttpEmployeesGateway } from './employees-gateway.js';
import { HttpOperationsGateway } from './operations-gateway.js';
import { HttpFinanceGateway } from './finance-gateway.js';
import { bffEnvironment } from '../infrastructure/config/environment.js';
import { PAGE, WORK, ID, EMPLOYEES_PAGE, WORK_FIELDS } from '../../test/agenda-fixtures.js';

const CALLER = { subject: 'synthetic-subject-not-an-employee-id', roles: ['custom_agenda_role'] };
function setup(effective = ['agenda:read:self', 'agenda:read:team']) {
  const permissionTransport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ effective }));
  const transport = vi.fn<typeof fetch>().mockImplementation(async url => {
    const path = new URL(url instanceof Request ? url.url : url).pathname;
    return Response.json(path === '/agenda/team/employees' ? EMPLOYEES_PAGE : path.endsWith(ID) ? WORK : PAGE);
  });
  const forbiddenTransport = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unexpected non-agenda owner request'));
  const graphql = new BusinessGraphql(new HttpEmployeesGateway('http://127.0.0.1:3002', permissionTransport),
    new HttpOperationsGateway('http://127.0.0.1:8081', forbiddenTransport), new HttpFinanceGateway('http://127.0.0.1:8000', forbiddenTransport),
    bffEnvironment({}).schemaPaths, new HttpAgendaGateway('http://127.0.0.1:8081', 'http://127.0.0.1:3002', transport));
  return { graphql, transport, permissionTransport, forbiddenTransport };
}
describe('CU05 GraphQL contract with explicit fake HTTP owners', () => {
  it('maps all five exact roots and the complete agenda SDL DTO', async () => {
    const { graphql, transport, forbiddenTransport } = setup();
    const response = await graphql.run({ query: `{
      mine: myAgenda { actor { employeeId fullName status scopes } items { ${WORK_FIELDS} } total limit offset from to timeZone observedAt }
      myAgendaWork(assignmentId: "${ID}") { ${WORK_FIELDS} }
      teamAgenda(employeeId: "${WORK.employee.id}") { total items { assignmentId } }
      teamAgendaWork(assignmentId: "${ID}") { ${WORK_FIELDS} }
      agendaTeamEmployees { items { id fullName status } total limit offset observedAt }
    }` }, CALLER, 'human');
    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({ mine: PAGE, myAgendaWork: WORK, teamAgenda: { total: 1, items: [{ assignmentId: ID }] }, teamAgendaWork: WORK, agendaTeamEmployees: EMPLOYEES_PAGE });
    expect(transport).toHaveBeenCalledTimes(5);
    expect(forbiddenTransport).not.toHaveBeenCalled();
  });
  it.each(['agenda:read', 'agenda:*', 'agenda:read:team', 'employees:read', 'orders:read', 'confirmations:read'])('never inherits self authority from %s', async permission => {
    const { graphql, transport } = setup([permission]);
    const response = await graphql.run({ query: '{ alias: myAgenda { total } }' }, { ...CALLER, roles: ['mecanico'] }, 'human');
    expect(response.errors?.[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(response.data).toBeUndefined();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    '{ teamAgenda { total } }', '{ teamAgendaWork(assignmentId:"' + ID + '"){assignmentId} }',
    '{ agendaTeamEmployees { total } }', '{ allowed: myAgenda {total} hidden: teamAgenda {total} }',
    '{ alias: myAgenda{total} employees{total} }',
  ])('preflights every aliased/multiple root without partial data: %s', async query => {
    const { graphql, transport } = setup(['agenda:read:self']);
    const response = await graphql.run({ query }, CALLER, 'human');
    expect(response.errors?.[0].extensions.code).toBe('FORBIDDEN');
    expect(response.data).toBeUndefined();
    expect(transport).not.toHaveBeenCalled();
  });
  it('allows team-only without inferring self authority or employee identity', async () => {
    const { graphql, transport } = setup(['agenda:read:team']);
    const result = await graphql.run({ query: '{teamAgenda{actor{employeeId} total}}' }, CALLER, 'human');
    expect(result.errors).toBeUndefined();
    expect(transport.mock.calls[0][0]).toBe('http://127.0.0.1:8081/agenda/team');
  });
  it.each([
    '{myAgenda(employeeId:"' + ID + '"){total}}', '{myAgenda(scope:team){total}}',
    '{myAgenda{items{customerId}}}', '{myAgenda{items{employee{email}}}}',
    '{myAgenda{items{services{price}}}}', '{myAgenda{items{quotation{id}}}}',
    '{myAgenda(status:reserved){total}}', '{myAgenda(priority:critical){total}}',
    '{agendaTeamEmployees(status:unknown){total}}', '{myAgenda(limit:1,limit:2){total}}',
    '{... on Query {myAgenda{total}}}', '{a:__schema{types{name}}}',
    '{unknownAgenda{total}}', 'mutation{myAgenda{total}}',
  ])('rejects unknown input, PII, wrong roots, introspection: %s', async query => {
    const { graphql, transport } = setup();
    await expect(graphql.run({ query }, CALLER, 'human')).rejects.toBeInstanceOf(BadRequest);
    expect(transport).not.toHaveBeenCalled();
  });
  it('does not convert cached general permission into owner authority after revocation/inactivity/unlinking', async () => {
    const { graphql, transport, permissionTransport } = setup();
    const query = '{myAgenda{total}}';
    expect((await graphql.run({ query }, CALLER, 'human')).errors).toBeUndefined();
    transport.mockResolvedValueOnce(Response.json({ code: 'AGENDA_ACCESS_DENIED', message: 'private identity details' }, { status: 403 }));
    const denied = await graphql.run({ query }, CALLER, 'human');
    expect(denied.errors?.[0].extensions).toEqual({ code: 'FORBIDDEN', statusCode: 403 });
    expect(denied.data).toBeUndefined();
    expect(permissionTransport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(denied)).not.toContain('private');
  });
  it.each([
    ['AGENDA_WORK_NOT_FOUND', 404], ['AGENDA_STATE_UNAVAILABLE', 503],
    ['AGENDA_DEPENDENCY_UNAVAILABLE', 503], ['PERSISTENCE_UNAVAILABLE', 503],
  ] as const)('preserves safe owner error %s and its extensions, not []', async (code, status) => {
    const { graphql, transport } = setup();
    transport.mockResolvedValueOnce(Response.json({ code, message: 'private SQL' }, { status }));
    const result = await graphql.run({ query: '{myAgendaWork(assignmentId:"' + ID + '"){assignmentId}}' }, CALLER, 'human');
    expect(result.errors?.[0].extensions).toEqual({ code, statusCode: status });
    expect(result.data).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('validates finite ranges/paging before transport with the existing GraphQL envelope', async () => {
    const { graphql, transport } = setup();
    const result = await graphql.run({ query: '{myAgenda(from:"2026-10-01",to:"2026-11-01"){total}}' }, CALLER, 'human');
    expect(result.errors?.[0].extensions).toEqual({ code: 'VALIDATION_ERROR', statusCode: 400 });
    expect(transport).not.toHaveBeenCalled();
  });
});
