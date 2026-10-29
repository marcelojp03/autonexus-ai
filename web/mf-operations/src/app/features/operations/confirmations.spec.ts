import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SESSION_PORT, DEMO_MODE, businessSessionGuard } from '../../auth/session';
import { ConfirmationsApi, intervalValid, terminal, type ConfirmationSaga, type StartConfirmation } from './confirmations-api';
import { ConfirmationsComponent } from './confirmations.component';
import { OperationsApi, OperationsFailure } from './operations-api';
import type { WorkOrder } from './operations.contract';

const orderId = '10000000-0000-4000-8000-000000000001';
const operationId = '10000000-0000-4000-8000-000000000002';
const sagaId = '10000000-0000-4000-8000-000000000003';
const order = { id: orderId, number: 'WO-synthetic', status: 'pending_quote', version: 4, items: [{ estimatedMinutes: 30, quantity: 2 }] } as WorkOrder;
const mechanic = { id: 'mechanic', fullName: 'Perfil sintético', jobTitle: 'Técnico', status: 'active', version: 3, mechanicEnabled: true, specialties: ['Frenos'], eligible: true, eligibilityReasons: [] };
const quote = { id: 'quote', orderReference: orderId, version: 5, status: 'approved', total: 100, currency: 'BOB', validUntil: '2099-01-01' };
const saga: ConfirmationSaga = { sagaId, operationId, orderId, status: 'recovery_pending', phase: 'reserve_assignment', version: 2, orderVersion: 5, nextAttemptAt: null, errorCode: 'PARTICIPANT_UNAVAILABLE', quoteId: quote.id, quoteVersion: 5, employeeId: mechanic.id, employeeVersion: 3, requiredSpecialty: 'Frenos', startsAt: '2099-01-01T10:00:00-04:00', endsAt: '2099-01-01T11:00:00-04:00', assignmentId: null, quoteLinkId: null, steps: [] };
const page = <T>(items: T[]) => ({ items, total: items.length, limit: 20, offset: 0 });
let api: { catalog: ReturnType<typeof vi.fn>; mechanics: ReturnType<typeof vi.fn>; quotes: ReturnType<typeof vi.fn>; forOrder: ReturnType<typeof vi.fn>; availability: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn>; saga: ReturnType<typeof vi.fn>; byOperation: ReturnType<typeof vi.fn> };
let listener: (state: { authenticated: boolean; identity: { subject: string } | null }) => void;
beforeEach(() => {
  sessionStorage.clear();
  api = { catalog: vi.fn().mockResolvedValue(['confirmations:read', 'confirmations:write']), mechanics: vi.fn().mockResolvedValue(page([mechanic])), quotes: vi.fn().mockResolvedValue(page([quote])), forOrder: vi.fn().mockResolvedValue([]), availability: vi.fn().mockResolvedValue({ available: [], assignments: [], reservations: [] }), start: vi.fn().mockResolvedValue(saga), retry: vi.fn().mockResolvedValue(saga), saga: vi.fn().mockResolvedValue(saga), byOperation: vi.fn().mockResolvedValue(saga) };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ConfirmationsApi, useValue: api }, { provide: OperationsApi, useValue: { orders: vi.fn().mockResolvedValue(page([order])) } }, { provide: SESSION_PORT, useValue: { snapshot: () => ({ authenticated: true, identity: { subject: 'synthetic-user' } }), subscribe: (fn: typeof listener) => { listener = fn; return () => {}; } } }] });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
});
afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); sessionStorage.clear(); });
async function ready() {
  const fixture = TestBed.createComponent(ConfirmationsComponent); const component = fixture.componentInstance; fixture.detectChanges(); await fixture.whenStable();
  component.orderId = orderId; await component.chooseOrder(); component.quoteKey = 'quote:5'; component.employeeId = mechanic.id; component.specialty = 'Frenos'; component.startsAt = '2099-01-01T10:00'; component.endsAt = '2099-01-01T11:00'; return { fixture, component };
}
test('future La Paz interval excludes midnight crossings, past and reversed intervals', () => {
  expect(intervalValid('2099-01-01T10:00', '2099-01-01T11:00')).toBe(true);
  for (const [start, end] of [['2099-01-01T23:30', '2099-01-02T00:30'], ['2020-01-01T10:00', '2020-01-01T11:00'], ['2099-01-01T11:00', '2099-01-01T10:00'], ['', '']]) expect(intervalValid(start, end)).toBe(false);
});
test('only confirmed and compensated rejected are terminal', () => {
  for (const status of ['running', 'recovery_pending', 'compensating', 'compensation_pending'] as const) expect(terminal({ ...saga, status })).toBe(false);
  expect(terminal({ ...saga, status: 'confirmed' })).toBe(true); expect(terminal({ ...saga, status: 'rejected' })).toBe(true);
});
test('202 direct saga stays pending, sends exact versions, and stores identifiers only', async () => {
  const { component } = await ready(); await component.start();
  expect(component.progress()?.status).toBe('recovery_pending'); expect(component.isTerminal()).toBe(false); expect(component.error()).toBeNull();
  expect(api.start).toHaveBeenCalledWith(orderId, expect.objectContaining({ expectedVersion: 4, quoteId: 'quote', quoteVersion: 5, employeeId: 'mechanic', employeeVersion: 3, requiredSpecialty: 'Frenos', startsAt: '2099-01-01T10:00:00-04:00' }));
  expect(JSON.parse(sessionStorage.getItem('cu15:pending:synthetic-user')!)).toEqual({ operationId, orderId, sagaId });
  expect(component.duration()).toBe(60);
});
test('busy guard blocks double-click synchronously', async () => {
  const { component } = await ready(); let resolve!: (value: ConfirmationSaga) => void; api.start.mockReturnValue(new Promise(r => { resolve = r; }));
  const first = component.start(); await component.start(); expect(api.start).toHaveBeenCalledOnce(); resolve(saga); await first;
});
test('lost start response reuses frozen input and never creates another operation', async () => {
  const { component } = await ready(); api.start.mockRejectedValue(new Error('lost')); await component.start();
  component.specialty = 'Changed'; component.startsAt = '2099-02-02T10:00'; await component.sendFrozen();
  expect(api.start.mock.calls[0]).toEqual(api.start.mock.calls[1]); expect(component.unknown()).toBe(true); expect(component.progress()).toBeNull();
  await component.start(); expect(api.start).toHaveBeenCalledTimes(2);
});
test('reload resolves by operation without issuing any mutation; 404 is UNKNOWN', async () => {
  sessionStorage.setItem('cu15:pending:synthetic-user', JSON.stringify({ orderId, operationId })); api.byOperation.mockRejectedValue(new Error('404'));
  const component = TestBed.createComponent(ConfirmationsComponent).componentInstance; await component.ngOnInit();
  expect(api.byOperation).toHaveBeenCalledWith(operationId); expect(component.unknown()).toBe(true); expect(component.error()).toContain('UNKNOWN'); expect(api.start).not.toHaveBeenCalled();
  api.byOperation.mockResolvedValue(saga); await component.refresh(); expect(component.progress()?.sagaId).toBe(sagaId);
});
test('deep link queries saga directly without creating effects', async () => {
  vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.paramMap, 'get').mockReturnValue(sagaId);
  const component = TestBed.createComponent(ConfirmationsComponent).componentInstance; await component.ngOnInit(); expect(api.saga).toHaveBeenCalledWith(sagaId); expect(api.start).not.toHaveBeenCalled();
});
test('retry nudges the same saga with current version and new operation; uncertain retry retains input', async () => {
  const { component } = await ready(); await component.start(); api.retry.mockRejectedValue(new Error('lost')); await component.retry(); await component.retry();
  expect(api.retry.mock.calls[0][0]).toBe(sagaId); expect(api.retry.mock.calls[0][1].expectedVersion).toBe(2); expect(api.retry.mock.calls[0][1].operationId).not.toBe(operationId); expect(api.retry.mock.calls[0]).toEqual(api.retry.mock.calls[1]);
  component.progress.set({ ...saga, status: 'confirmed' }); await component.retry(); expect(api.retry).toHaveBeenCalledTimes(2);
});
test('custom permission grants, not role names, control start and retry', async () => {
  const { component } = await ready(); component.permissions.set(['confirmations:read']); await component.start(); component.progress.set(saga); await component.retry(); expect(api.start).not.toHaveBeenCalled(); expect(api.retry).not.toHaveBeenCalled();
  component.permissions.set(['confirmations:read', 'confirmations:write']); component.progress.set(null); await component.start(); expect(api.start).toHaveBeenCalledOnce();
});
test('wrong-order quote, inelegibility, no specialty and overnight intervals block start', async () => {
  const { component } = await ready(); component.quotes.set([{ ...quote, orderReference: 'other' }]); await component.start(); component.quotes.set([quote]); component.mechanics.set([{ ...mechanic, eligible: false }]); await component.start(); component.mechanics.set([mechanic]); component.specialty = ''; await component.start(); component.specialty = 'Frenos'; component.endsAt = '2099-01-02T01:00'; await component.start(); expect(api.start).not.toHaveBeenCalled();
});
test('logout discards late responses and stops polling', async () => {
  const { fixture, component } = await ready(); let resolve!: (value: ConfirmationSaga) => void; api.start.mockReturnValue(new Promise(r => { resolve = r; })); const request = component.start(); listener({ authenticated: false, identity: null }); resolve(saga); await request; expect(component.progress()).toBeNull(); expect(component.pending()).toBeNull(); fixture.destroy();
});
test('polls every two seconds and stops on terminal state', async () => {
  const { component } = await ready(); vi.useFakeTimers(); await component.start(); api.saga.mockResolvedValue({ ...saga, status: 'confirmed', version: 3 }); await vi.advanceTimersByTimeAsync(2000); expect(api.saga).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(6000); expect(api.saga).toHaveBeenCalledOnce();
});
test('API uses direct mutation payloads, preserving operationId and expectedVersion', async () => {
  TestBed.resetTestingModule(); const requestBusiness = vi.fn().mockResolvedValueOnce({ data: { startServiceConfirmation: saga } }).mockResolvedValueOnce({ data: { retryServiceConfirmation: saga } });
  TestBed.configureTestingModule({ providers: [{ provide: SESSION_PORT, useValue: { requestBusiness } }] }); const client = TestBed.inject(ConfirmationsApi);
  const input = { operationId, expectedVersion: 4 } as StartConfirmation; expect(await client.start(orderId, input)).toBe(saga); expect(await client.retry(sagaId, { operationId, expectedVersion: 2 })).toBe(saga); expect(requestBusiness.mock.calls[0][1]).toEqual({ orderId, input }); expect(requestBusiness.mock.calls[1][1]).toEqual({ id: sagaId, input: { operationId, expectedVersion: 2 } });
});
test('business route cannot enter explicit demo mode', () => {
  TestBed.resetTestingModule(); TestBed.configureTestingModule({ providers: [{ provide: DEMO_MODE, useValue: true }] });
  expect(TestBed.runInInjectionContext(() => businessSessionGuard({} as never, {} as never))).toBe(false);
});
test('pending template is informational, never success or rejection', async () => {
  const { fixture, component } = await ready(); await component.start(); fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  expect(host.querySelector('#confirmation-status')?.textContent).toContain('Recuperación pendiente');
  expect(host.querySelector('#confirmation-success')).toBeNull(); expect(host.querySelector('#confirmation-error')).toBeNull();
  expect(host.querySelector('#confirmation-retry')).not.toBeNull();
});
test('inelegible profiles keep reasons visible without granting employee edit navigation', async () => {
  const { fixture, component } = await ready(); component.mechanics.set([{ ...mechanic, eligible: false, mechanicEnabled: false, eligibilityReasons: ['MECHANIC_NOT_ENABLED'] }]); fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  expect(host.querySelector('#confirmation-ineligible')?.textContent).toContain('Falta habilitación laboral');
  expect(host.querySelector('#confirmation-edit-employee')).toBeNull();
  component.permissions.update(value => [...value, 'employees:write']); fixture.detectChanges();
  expect(host.querySelector('#confirmation-edit-employee')).not.toBeNull();
});
test('late polling version cannot replace a newer terminal response', async () => {
  const { component } = await ready(); await component.start(); component.progress.set({ ...saga, version: 5, status: 'confirmed' }); api.saga.mockResolvedValue(saga);
  await component.refresh(); expect(component.progress()?.version).toBe(5); expect(component.progress()?.status).toBe('confirmed');
});

test('definitive pre-start version conflict allows explicit review but is not a rejected saga', async () => {
  const { component } = await ready(); api.start.mockRejectedValue(new OperationsFailure({ code: 'VERSION_CONFLICT', statusCode: 409, message: 'Version changed' })); await component.start();
  expect(component.startBlocked()).toBe(true); expect(component.progress()).toBeNull(); expect(component.unknown()).toBe(false); expect(component.error()).toContain('VERSION_CONFLICT');
  await component.newSelection(); expect(component.pending()).toBeNull(); expect(api.start).toHaveBeenCalledOnce();
});
