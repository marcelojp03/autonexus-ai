import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { AgendaApi } from './agenda-api';
import { AgendaComponent } from './agenda.component';
import type { SessionSnapshot } from '../../../../../../contracts/auth/session';
import { SESSION_PORT } from '../../auth/session';
import { EmployeesFailure } from '../employees/employees-api';
import type { AgendaWork } from './agenda.contract';
test('UTC early morning stays on the previous La Paz day with consistent 24-hour start and end', () => {
  const c = TestBed.createComponent(AgendaComponent).componentInstance;
  const start = c.stamp('2026-11-06T03:00:00Z');
  expect(start).toMatch(/^5 nov(?: de)? 2026,/);
  expect(start).toContain('23:00');
  expect(c.time('2026-11-06T03:00:00Z')).toBe('23:00');
  expect(c.stamp('2026-11-06T03:30:00Z')).toContain('23:30');
  expect(c.time('2026-11-06T03:30:00Z')).toBe('23:30');
});
test('rendered form has civil date inputs and a real empty state after an authorized response', async () => {
  requestBusiness.mockResolvedValue({
    data: { myAgenda: { ...page('A'), from: '2026-10-31', to: '2026-10-31', timeZone: 'America/La_Paz' } }
  });
  const fixture = TestBed.createComponent(AgendaComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelectorAll('input[type=date]')).toHaveLength(2);
  expect(fixture.nativeElement.textContent).toContain('No hay trabajos confirmados');
  expect(fixture.nativeElement.textContent).toContain('Última comprobación');
});
test('CU16 status and progress appear in agenda list and detail while the work stays confirmed', async () => {
  const work: AgendaWork = {
    assignmentId: 'assignment-1', orderId: 'order-1', orderNumber: 'OT-1',
    employee: { id: 'employee-1', fullName: 'Mecánico', status: 'active' },
    vehicle: { id: 'vehicle-1', plate: 'SYN-001', make: 'Test', model: 'Fixture' },
    startsAt: '2026-11-06T12:00:00Z', endsAt: '2026-11-06T14:00:00Z', priority: 'normal', status: 'confirmed',
    description: 'Trabajo confirmado', notes: null, services: [], orderVersion: 2, assignmentVersion: 1,
    observedAt: '2026-11-01T12:00:00Z', confirmationObservation: 'observed', executionStatus: 'in_progress',
    executionProgress: { advances: 2, lastAdvanceAt: '2026-11-01T11:00:00Z', availableEvidence: 1 }
  };
  requestBusiness.mockResolvedValueOnce({ data: { myAgenda: { ...page('A'), items: [work], total: 1, from: '2026-11-01', to: '2026-11-30', timeZone: 'America/La_Paz' } } })
    .mockResolvedValueOnce({ data: { myAgendaWork: work } });
  const fixture = TestBed.createComponent(AgendaComponent); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('En ejecución');
  expect(fixture.nativeElement.textContent).toContain('2 avances');
  expect(fixture.nativeElement.textContent).toContain('1 evidencias confirmadas');
  params.next(convertToParamMap({ assignmentId: work.assignmentId })); await fixture.whenStable(); fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Confirmado · En ejecución');
  expect(fixture.nativeElement.textContent).toContain('Último avance');
  expect(fixture.nativeElement.textContent).toContain('Abrir ejecución');
});
test('offline event clears previously loaded RAM instead of presenting cached agenda', async () => {
  requestBusiness.mockResolvedValue({ data: { myAgenda: page('A') } });
  const c = TestBed.createComponent(AgendaComponent).componentInstance;
  await c.load();
  expect(c.page()).not.toBeNull();
  window.dispatchEvent(new Event('offline'));
  expect(c.page()).toBeNull();
  expect(c.error()).toContain('Sin conexión');
});
test('changing subject invalidates successful data and pending selector', async () => {
  requestBusiness.mockResolvedValue({ data: { myAgenda: page('A') } });
  const c = TestBed.createComponent(AgendaComponent).componentInstance;
  c.ngOnInit();
  await c.load();
  const pending = deferred();
  requestBusiness.mockReturnValue(pending.promise);
  const lookup = c.loadEmployees();
  snapshot = { ...snapshot, identity: { subject: 'B', username: 'other', roles: ['mecanico'] } };
  listener(snapshot);
  pending.resolve({ data: { agendaTeamEmployees: { items: [{ id: 'old' }] } } });
  await lookup;
  expect(c.page()).toBeNull();
  expect(c.work()).toBeNull();
  expect(c.staff()).toBeNull();
});
test('invalid dates never issue a business query', async () => {
  const c = TestBed.createComponent(AgendaComponent).componentInstance;
  c.from = '2026-01-01';
  c.to = '2026-02-01';
  await c.load();
  expect(requestBusiness).not.toHaveBeenCalled();
  expect(c.error()).toContain('31 días');
});
let requestBusiness: ReturnType<typeof vi.fn>;
let listener: (state: SessionSnapshot) => void;
let snapshot: SessionSnapshot;
let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
beforeEach(() => {
  snapshot = {
    mode: 'oidc',
    phase: 'authenticated',
    authenticated: true,
    identity: { subject: 'A', username: 'test', roles: ['mecanico'] }
  };
  requestBusiness = vi.fn();
  params = new BehaviorSubject(convertToParamMap({}));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: params, snapshot: { data: { scope: 'self' } } } },
      {
        provide: SESSION_PORT,
        useValue: {
          snapshot: () => snapshot,
          subscribe: (fn: typeof listener) => {
            listener = fn;
            return vi.fn();
          },
          requestBusiness
        }
      }
    ]
  });
});
afterEach(() => TestBed.resetTestingModule());
const page = (label: string): { actor: { fullName: string }; items: never[]; total: number; observedAt: string } => ({
  actor: { fullName: label },
  items: [],
  total: 0,
  observedAt: '2026-10-31T13:00:00Z'
});
const deferred = (): { promise: Promise<unknown>; resolve: (value: unknown) => void } => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(r => {
    resolve = r;
  });
  return { promise, resolve };
};
test('own query strips employee identity even from unexpected filter keys', async () => {
  requestBusiness.mockResolvedValue({ data: { myAgenda: page('A') } });
  const api = TestBed.inject(AgendaApi);
  await api.list(
    'self',
    { from: '2026-10-31', to: '2026-10-31', status: 'confirmed', limit: 20, offset: 0, employeeId: 'B' } as never,
    'B'
  );
  expect(requestBusiness.mock.calls[0][0]).not.toContain('$employeeId');
  expect(requestBusiness.mock.calls[0][1]).not.toHaveProperty('employeeId');
});
test('scoped detail uses assignmentId only', async () => {
  requestBusiness.mockResolvedValue({ data: { myAgendaWork: { assignmentId: 'x' } } });
  await TestBed.inject(AgendaApi).detail('self', 'x');
  expect(requestBusiness.mock.calls[0][0]).toContain('myAgendaWork(assignmentId:$assignmentId)');
  expect(requestBusiness.mock.calls[0][1]).toEqual({ assignmentId: 'x' });
});
test('team query and selector use dedicated paginated DTO roots', async () => {
  requestBusiness.mockResolvedValue({ data: { teamAgenda: page('A'), agendaTeamEmployees: { items: [], total: 0 } } });
  const api = TestBed.inject(AgendaApi);
  await api.list('team', { from: '2026-10-31', to: '2026-10-31', status: 'confirmed', limit: 20, offset: 20 }, 'B');
  expect(requestBusiness.mock.calls[0][1].employeeId).toBe('B');
  await api.employees('  Taller  ', 'inactive', 20);
  expect(requestBusiness.mock.calls[1][1]).toEqual({ search: 'Taller', status: 'inactive', limit: 20, offset: 20 });
});
test('API rejects denial even if partial data is present', async () => {
  requestBusiness.mockResolvedValue({
    data: { myAgenda: page('leak') },
    errors: [{ code: 'AGENDA_ACCESS_DENIED', statusCode: 403, message: 'safe' }]
  });
  await expect(
    TestBed.inject(AgendaApi).list('self', { from: '2026-10-31', to: '2026-10-31', status: 'confirmed', limit: 20, offset: 0 })
  ).rejects.toBeInstanceOf(EmployeesFailure);
});
test('older filter response cannot overwrite new result', async () => {
  const first = deferred();
  requestBusiness.mockReturnValueOnce(first.promise).mockResolvedValue({ data: { myAgenda: page('new') } });
  const fixture = TestBed.createComponent(AgendaComponent);
  const c = fixture.componentInstance;
  const old = c.load();
  await c.load();
  first.resolve({ data: { myAgenda: page('old') } });
  await old;
  expect(c.page()?.actor.fullName).toBe('new');
});
test('changing a filter invalidates in-flight result immediately', async () => {
  const pending = deferred();
  requestBusiness.mockReturnValue(pending.promise);
  const c = TestBed.createComponent(AgendaComponent).componentInstance;
  const work = c.load();
  c.filtersChanged();
  pending.resolve({ data: { myAgenda: page('old') } });
  await work;
  expect(c.page()).toBeNull();
});
test('logout clears RAM and invalidates pending list and selector', async () => {
  const pending = deferred();
  requestBusiness.mockReturnValue(pending.promise);
  const fixture = TestBed.createComponent(AgendaComponent);
  const c = fixture.componentInstance;
  c.ngOnInit();
  snapshot = { ...snapshot, authenticated: false, identity: null };
  listener(snapshot);
  pending.resolve({ data: { myAgenda: page('old') } });
  await Promise.resolve();
  await Promise.resolve();
  expect(c.page()).toBeNull();
  expect(c.staff()).toBeNull();
});
test('detail route params are consumed on reuse and latest ID wins', async () => {
  const first = deferred();
  requestBusiness.mockReturnValueOnce(first.promise).mockResolvedValue({ data: { myAgendaWork: { assignmentId: 'two' } } });
  params.next(convertToParamMap({ assignmentId: 'one' }));
  const c = TestBed.createComponent(AgendaComponent).componentInstance;
  c.ngOnInit();
  params.next(convertToParamMap({ assignmentId: 'two' }));
  await Promise.resolve();
  await Promise.resolve();
  first.resolve({ data: { myAgendaWork: { assignmentId: 'one' } } });
  await Promise.resolve();
  await Promise.resolve();
  expect(c.work()?.assignmentId).toBe('two');
});
test('dependency errors render error state, never an empty success', async () => {
  requestBusiness.mockResolvedValue({ errors: [{ code: 'AGENDA_DEPENDENCY_UNAVAILABLE', statusCode: 503, message: 'private host' }] });
  const c = TestBed.createComponent(AgendaComponent).componentInstance;
  await c.load();
  expect(c.page()).toBeNull();
  expect(c.error()).toContain('dependencia');
  expect(c.error()).not.toContain('private');
});
