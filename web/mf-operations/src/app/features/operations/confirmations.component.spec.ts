import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ConfirmationsApi, type ConfirmationSaga, type StartConfirmation } from './confirmations-api';
import { ConfirmationsComponent } from './confirmations.component';
import { OperationsApi, OperationsFailure } from './operations-api';
import type { WorkOrder } from './operations.contract';
import { SESSION_PORT } from '../../auth/session';

const orderId = '10000000-0000-4000-8000-000000000001';
const quoteId = '10000000-0000-4000-8000-000000000002';
const employeeId = '10000000-0000-4000-8000-000000000003';
const operationId = '10000000-0000-4000-8000-000000000004';
const sagaId = '10000000-0000-4000-8000-000000000005';
const key = 'cu15:pending:synthetic-user';
const input: StartConfirmation = {
  operationId,
  expectedVersion: 4,
  quoteId,
  quoteVersion: 5,
  employeeId,
  employeeVersion: 3,
  requiredSpecialty: 'Frenos',
  startsAt: '2099-01-01T10:00:00-04:00',
  endsAt: '2099-01-01T11:00:00-04:00'
};
const metadata = (): { subject: string; orderId: string; operationId: string; input: StartConfirmation } => ({
  subject: 'synthetic-user',
  orderId,
  operationId,
  input: { ...input }
});
const saga = {
  ...input,
  sagaId,
  orderId,
  status: 'recovery_pending',
  version: 2,
  orderVersion: 5,
  steps: []
} as unknown as ConfirmationSaga;
let api: {
  catalog: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  byOperation: ReturnType<typeof vi.fn>;
  saga: ReturnType<typeof vi.fn>;
};
let listener: (state: { authenticated: boolean; identity: { subject: string } | null }) => void;
beforeEach(() => {
  sessionStorage.clear();
  api = {
    catalog: vi.fn().mockResolvedValue(['confirmations:read', 'confirmations:write']),
    start: vi.fn().mockRejectedValue(new Error('request never reached coordinator')),
    byOperation: vi
      .fn()
      .mockRejectedValue(new OperationsFailure({ code: 'CONFIRMATION_NOT_FOUND', statusCode: 404, message: 'Not found' })),
    saga: vi.fn().mockResolvedValue(saga)
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ConfirmationsApi, useValue: api },
      { provide: OperationsApi, useValue: { orders: vi.fn().mockResolvedValue({ items: [], total: 0 }) } },
      {
        provide: SESSION_PORT,
        useValue: {
          snapshot: () => ({ authenticated: true, identity: { subject: 'synthetic-user' } }),
          subscribe: (fn: typeof listener) => {
            listener = fn;
            return () => {};
          }
        }
      }
    ]
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
});
afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
  sessionStorage.clear();
});
async function mount(): Promise<ComponentFixture<ConfirmationsComponent>> {
  const fixture = TestBed.createComponent(ConfirmationsComponent);
  await fixture.componentInstance.ngOnInit();
  return fixture;
}
async function lostStart(): Promise<ComponentFixture<ConfirmationsComponent>> {
  const fixture = await mount();
  const component = fixture.componentInstance;
  component.orders.set([{ id: orderId, status: 'pending_quote', version: 4 } as WorkOrder]);
  component.orderId = orderId;
  component.quotes.set([
    { id: quoteId, orderReference: orderId, version: 5, status: 'approved', total: 100, currency: 'BOB', validUntil: '2099-01-02' }
  ]);
  component.quoteKey = `${quoteId}:5`;
  component.mechanics.set([
    {
      id: employeeId,
      fullName: 'Synthetic',
      jobTitle: 'Técnico',
      status: 'active',
      version: 3,
      eligible: true,
      mechanicEnabled: true,
      specialties: ['Frenos'],
      eligibilityReasons: []
    }
  ]);
  component.employeeId = employeeId;
  component.specialty = 'Frenos';
  component.startsAt = '2099-01-01T10:00';
  component.endsAt = '2099-01-01T11:00';
  await component.start();
  return fixture;
}

test('lost request before coordinator survives reload and permanent 404; only manual replay uses identical frozen command', async () => {
  const first = await lostStart();
  const original = structuredClone(api.start.mock.calls[0]);
  const stored = sessionStorage.getItem(key);
  first.destroy();
  expect(sessionStorage.getItem(key)).toBe(stored);
  api.start.mockClear();
  const second = await mount();
  const component = second.componentInstance;
  vi.useFakeTimers();
  await component.refresh();
  await vi.advanceTimersByTimeAsync(6000);
  expect(api.start).not.toHaveBeenCalled();
  expect(component.unknown()).toBe(true);
  expect(component.startBlocked()).toBe(false);
  expect(component.canResend()).toBe(true);
  component.specialty = 'Changed';
  component.orderId = quoteId;
  await component.newSelection();
  await component.start();
  expect(api.start).not.toHaveBeenCalled();
  await component.sendFrozen();
  expect(api.start.mock.calls[0]).toEqual(original);
  expect(Object.isFrozen(api.start.mock.calls[0][1])).toBe(true);
  api.start.mockRejectedValue(new OperationsFailure({ code: 'VERSION_CONFLICT', statusCode: 409, message: 'Conflict' }));
  await component.sendFrozen();
  expect(component.startBlocked()).toBe(false);
  expect(component.canResend()).toBe(true);
  expect(sessionStorage.getItem(key)).toBe(stored);
});

test.each(['confirmed', 'rejected'] as const)('terminal %s removes recovery metadata and disables replay', async status => {
  sessionStorage.setItem(key, JSON.stringify(metadata()));
  api.byOperation.mockResolvedValue({ ...saga, status });
  const fixture = await mount();
  expect(fixture.componentInstance.isTerminal()).toBe(true);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(fixture.componentInstance.canResend()).toBe(false);
  await fixture.componentInstance.refresh();
  expect(sessionStorage.getItem(key)).toBeNull();
});

test('mounted logout clears pending command and ignores late responses', async () => {
  const fixture = await lostStart();
  const component = fixture.componentInstance;
  let resolve!: (value: ConfirmationSaga) => void;
  api.byOperation.mockReturnValue(
    new Promise(r => {
      resolve = r;
    })
  );
  const request = component.refresh();
  listener({ authenticated: false, identity: null });
  resolve(saga);
  await request;
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(component.pending()).toBeNull();
  expect(component.progress()).toBeNull();
  expect(component.canResend()).toBe(false);
});

test('foreign subject key never restores a command or permissions', async () => {
  sessionStorage.setItem('cu15:pending:other-user', JSON.stringify({ ...metadata(), subject: 'other-user' }));
  const fixture = await mount();
  expect(fixture.componentInstance.pending()).toBeNull();
  expect(api.byOperation).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
});

test.each([
  { ...metadata(), subject: 'other-user' },
  { ...metadata(), token: 'synthetic-secret' },
  { ...metadata(), contactEmail: 'synthetic' },
  { ...metadata(), password: 'synthetic' },
  { ...metadata(), input: { ...input, initiatedBy: 'admin' } },
  { ...metadata(), input: { ...input, operationId: sagaId } },
  { ...metadata(), input: { ...input, quoteId: 'not-uuid' } },
  { ...metadata(), input: { ...input, employeeVersion: -1 } },
  { ...metadata(), input: { ...input, requiredSpecialty: 'F'.repeat(81) } },
  { ...metadata(), input: { ...input, requiredSpecialty: 'Frenos\u007f' } },
  { ...metadata(), input: { ...input, requiredSpecialty: ' Frenos  ABS ' } },
  { ...metadata(), input: { ...input, startsAt: '2099-02-30T10:00:00-04:00' } },
  { ...metadata(), input: { ...input, endsAt: '2099-01-02T11:00:00-04:00' } },
  { ...metadata(), input: { ...input, expectedVersion: '4' } },
  null,
  []
])('corrupt metadata cannot restore command or grant authorization %#', async value => {
  sessionStorage.setItem(key, JSON.stringify(value));
  const fixture = await mount();
  expect(fixture.componentInstance.pending()).toBeNull();
  expect(fixture.componentInstance.canResend()).toBe(false);
  expect(api.byOperation).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
});

test('restored command cannot bypass fresh server permissions', async () => {
  sessionStorage.setItem(key, JSON.stringify(metadata()));
  api.catalog.mockResolvedValue(['confirmations:read']);
  const fixture = await mount();
  expect(fixture.componentInstance.canResend()).toBe(false);
  await fixture.componentInstance.sendFrozen();
  expect(api.start).not.toHaveBeenCalled();
});

test('a different saga deep link never exposes replay of a restored pending command', async () => {
  sessionStorage.setItem(key, JSON.stringify(metadata()));
  vi.spyOn(TestBed.inject(ActivatedRoute).snapshot.paramMap, 'get').mockReturnValue(sagaId);
  api.saga.mockRejectedValue(new Error('404'));
  const fixture = await mount();
  expect(fixture.componentInstance.canResend()).toBe(false);
  await fixture.componentInstance.sendFrozen();
  expect(api.start).not.toHaveBeenCalled();
});

test.each(['{', 'x'.repeat(2049)])('malformed or oversized metadata cannot restore a command %#', async raw => {
  sessionStorage.setItem(key, raw);
  const fixture = await mount();
  expect(fixture.componentInstance.pending()).toBeNull();
  expect(api.byOperation).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(key)).toBeNull();
});

test('normalized specialty punctuation and combining marks survive reload without changing the command', async () => {
  const value = metadata();
  value.input.requiredSpecialty = 'Inyeccio\u0301n, frenos. ABS: diagnóstico';
  sessionStorage.setItem(key, JSON.stringify(value));
  const fixture = await mount();
  expect(fixture.componentInstance.canResend()).toBe(true);
  await fixture.componentInstance.sendFrozen();
  expect(api.start).toHaveBeenCalledWith(orderId, value.input);
});

test('stored command contains only allowlisted metadata, no identity profile or credentials', async () => {
  await lostStart();
  const value = JSON.parse(sessionStorage.getItem(key)!);
  expect(Object.keys(value).sort()).toEqual(['input', 'operationId', 'orderId', 'subject']);
  expect(Object.keys(value.input).sort()).toEqual(Object.keys(input).sort());
  expect(value.input).toEqual({ ...input, operationId: api.start.mock.calls[0][1].operationId });
});
