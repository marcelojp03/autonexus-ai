import { describe, expect, it, vi } from 'vitest';
import { ReadAgenda } from './read-agenda.js';
import type { AgendaRepository } from './agenda-repository.js';
import type { AgendaActor } from '../domain/agenda.js';
const id = '11111111-1111-4111-8111-111111111111';
const identity = { subject: 'current', roles: ['custom'] };
const actor: AgendaActor = {
  employeeId: id,
  fullName: 'Ana Perez',
  status: 'active',
  scopes: ['self'],
};
const fixture = () => {
  const repository = {
    actor: vi.fn<AgendaRepository['actor']>(async () => structuredClone(actor)),
    employees: vi.fn<AgendaRepository['employees']>(async (q) => ({ items: [], total: 0, limit: q.limit, offset: q.offset })),
    assignments: vi.fn<AgendaRepository['assignments']>(async () => []),
  };
  return { repository, service: new ReadAgenda(repository) };
};
describe('CU05 authorization and read orchestration', () => {
  it('resolves current identity on every request, including revoked next request', async () => {
    const { repository, service } = fixture();
    await expect(service.context(identity, 'self')).resolves.toMatchObject({
      actor,
    });
    vi.mocked(repository.actor).mockResolvedValueOnce(null);
    await expect(service.context(identity, 'self')).rejects.toMatchObject({
      status: 403,
      code: 'AGENDA_ACCESS_DENIED',
    });
    expect(repository.actor).toHaveBeenCalledTimes(2);
    expect(repository.actor).toHaveBeenLastCalledWith('current', ['custom']);
  });
  it('denies team without its exact permission before querying data', async () => {
    const { repository, service } = fixture();
    await expect(service.teamEmployees(identity, {})).rejects.toMatchObject({
      status: 403,
      code: 'AGENDA_ACCESS_DENIED',
    });
    expect(repository.employees).not.toHaveBeenCalled();
  });
  it('restricts self to resolved employee and returns no partial results', async () => {
    const { repository, service } = fixture();
    await expect(
      service.check(identity, { scope: 'self', assignmentIds: [id] }),
    ).rejects.toMatchObject({ status: 404, code: 'AGENDA_WORK_NOT_FOUND' });
    expect(repository.assignments).toHaveBeenCalledWith([id], actor.employeeId);
  });
  it('allows authorized empty team selector with both statuses omitted', async () => {
    const { repository, service } = fixture();
    vi.mocked(repository.actor).mockResolvedValue({
      ...actor,
      scopes: ['team'],
    });
    expect(await service.teamEmployees(identity, {})).toMatchObject({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
    expect(repository.employees).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    await service.check(identity, { scope: 'team', assignmentIds: [] });
    expect(repository.assignments).toHaveBeenCalledWith([], null);
  });
  it.each([{ scope: ['self', 'team'] }, { scope: 'self', employeeId: id }, {}])(
    'rejects identity/query injection %j',
    async (input) => {
      const { service } = fixture();
      await expect(
        Promise.resolve().then(() => service.contextQuery(identity, input)),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
});
