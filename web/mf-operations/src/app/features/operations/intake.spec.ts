import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { OrdersComponent } from './orders.component';
import { ReceptionsComponent } from './receptions.component';
import { OperationsApi, OperationsFailure } from './operations-api';
import { SESSION_PORT } from '../../auth/session';
const reception = { id: 'reception-1', vehicleId: 'vehicle-1', vehiclePlate: 'ABC123', customerId: 'customer-1', customerName: 'Cliente sintético', appointmentId: null, mileage: 100, reason: 'Ruido al frenar', symptoms: null, visibleConditions: null, hasOrder: false, receivedAt: '2026-10-28T10:00:00-04:00', version: 1 };
const order = { id: 'order-1', number: 'WO-2026-1', receptionId: reception.id, vehicleId: reception.vehicleId, vehiclePlate: reception.vehiclePlate, customerId: reception.customerId, customerName: reception.customerName, description: reception.reason, priority: 'normal', notes: null, status: 'pending_quote', version: 1, createdAt: reception.receivedAt, updatedAt: reception.receivedAt, items: [{ serviceId: 'service-1', serviceName: 'Diagnóstico', quantity: 1, referenceRate: 150, estimatedMinutes: 30 }] };
const page = <T>(items: T[]) => ({ items, total: items.length, limit: 20, offset: 0 });
let api: { orders: ReturnType<typeof vi.fn>; receptions: ReturnType<typeof vi.fn>; reception: ReturnType<typeof vi.fn>; services: ReturnType<typeof vi.fn>; vehicles: ReturnType<typeof vi.fn>; appointments: ReturnType<typeof vi.fn>; createReception: ReturnType<typeof vi.fn>; createWorkOrder: ReturnType<typeof vi.fn> };
beforeEach(() => {
  api = { orders: vi.fn().mockResolvedValue(page([order])), receptions: vi.fn().mockResolvedValue(page([reception])), reception: vi.fn().mockResolvedValue(reception), services: vi.fn().mockResolvedValue(page([])), vehicles: vi.fn().mockResolvedValue(page([])), appointments: vi.fn().mockResolvedValue(page([])), createReception: vi.fn().mockResolvedValue(reception), createWorkOrder: vi.fn().mockResolvedValue(order) };
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: OperationsApi, useValue: api }] });
});
afterEach(() => TestBed.resetTestingModule());
test('orders remain visible when reception and catalog lookups are forbidden', async () => {
  const denied = new OperationsFailure({ code: 'FORBIDDEN', statusCode: 403, message: 'Forbidden' });
  api.receptions.mockRejectedValue(denied); api.services.mockRejectedValue(denied);
  const fixture = TestBed.createComponent(OrdersComponent); fixture.detectChanges(); await fixture.whenStable();
  expect(api.receptions).not.toHaveBeenCalled(); expect(api.services).not.toHaveBeenCalled();
  await fixture.componentInstance.loadReceptions(); await fixture.componentInstance.loadServices(); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('#order-table').textContent).toContain(order.number);
  expect(fixture.componentInstance.error()).toBeNull();
  expect(fixture.nativeElement.querySelector('#order-service-error').textContent).toContain('permiso');
  fixture.nativeElement.querySelector('[data-order-detail]').click(); fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('#order-items').textContent).toContain('150.00');
});
test('reception form submits text inspection and optional appointment', async () => {
  const fixture = TestBed.createComponent(ReceptionsComponent); fixture.detectChanges(); await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const fill = (id: string, value: string) => { const input = host.querySelector<HTMLInputElement>(id)!; input.value = value; input.dispatchEvent(new Event('input')); };
  fill('#reception-vehicle-id', reception.vehicleId); fill('#reception-mileage', '100'); fill('#reception-reason', reception.reason); fill('#reception-symptoms', 'Vibración'); fill('#reception-conditions', 'Sin daño visible'); fill('#reception-appointment', 'appointment-1');
  fixture.detectChanges(); await fixture.whenStable();
  (host.querySelector('#reception-save') as HTMLButtonElement).click(); await fixture.whenStable(); fixture.detectChanges();
  expect(api.createReception).toHaveBeenCalledWith(expect.objectContaining({ vehicleId: reception.vehicleId, mileage: 100, symptoms: 'Vibración', visibleConditions: 'Sin daño visible', appointmentId: 'appointment-1' }));
  expect(host.querySelector('#reception-notice')?.textContent).toContain('registrada');
  expect(host.querySelector('[data-reception-id]')?.getAttribute('data-has-order')).toBe('false');
});
test('orders submit reception and quantities, not editable rates', async () => {
  const fixture = TestBed.createComponent(OrdersComponent); const component = fixture.componentInstance;
  fixture.detectChanges(); await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  for (const [id, value] of [['#order-reception-id', reception.id], ['#order-description', reception.reason], ['#order-service-id-0', 'service-1'], ['#order-quantity-0', '2']]) {
    const input = host.querySelector<HTMLInputElement>(id)!; input.value = value; input.dispatchEvent(new Event('input'));
  }
  fixture.detectChanges(); await fixture.whenStable();
  (host.querySelector('#order-save') as HTMLButtonElement).click(); await fixture.whenStable(); fixture.detectChanges();
  expect(api.createWorkOrder).toHaveBeenCalledWith(expect.objectContaining({ receptionId: reception.id, services: [{ serviceId: 'service-1', quantity: 2 }], priority: 'normal' }));
  expect(component.detail()?.number).toBe(order.number);
});
test('orders reject duplicate services, fractional quantity and more than 20 lines', async () => {
  const component = TestBed.createComponent(OrdersComponent).componentInstance;
  component.receptionId = reception.id; component.description = reception.reason;
  for (const items of [[{ serviceId: 'a', quantity: 1 }, { serviceId: 'a', quantity: 1 }], [{ serviceId: 'a', quantity: 1.5 }], Array.from({ length: 21 }, (_, i) => ({ serviceId: String(i), quantity: 1 }))]) { component.items = items; await component.save(); }
  expect(api.createWorkOrder).not.toHaveBeenCalled();
  component.items = [{ serviceId: 'a', quantity: 1 }]; for (let i = 0; i < 25; i++) component.addItem(); expect(component.items).toHaveLength(20);
});
test('reception rejects absent, fractional and out-of-range mileage', async () => {
  const component = TestBed.createComponent(ReceptionsComponent).componentInstance; component.vehicleId = reception.vehicleId; component.reason = reception.reason;
  for (const mileage of [null, -1, 0.1, 2000001]) { component.mileage = mileage; await component.save(); }
  expect(api.createReception).not.toHaveBeenCalled();
  component.mileage = 0; await component.save(); expect(api.createReception).toHaveBeenCalledOnce();
});
test('business rejection preserves form and retries the same operationId', async () => {
  const component = TestBed.createComponent(ReceptionsComponent).componentInstance; component.vehicleId = reception.vehicleId; component.reason = reception.reason; component.mileage = 10;
  api.createReception.mockRejectedValue(new OperationsFailure({ code: 'MILEAGE_REGRESSION', statusCode: 409, message: 'Mileage' }));
  await component.save(); await component.save();
  expect(component.reason).toBe(reception.reason); expect(component.error()).toContain('inferior');
  expect(api.createReception.mock.calls[0][0].operationId).toBe(api.createReception.mock.calls[1][0].operationId);
  component.mileage = 11; await component.save(); expect(api.createReception.mock.calls[2][0].operationId).not.toBe(api.createReception.mock.calls[0][0].operationId);
});
test('order retry keeps operationId and prevents duplicate in-flight submit', async () => {
  const component = TestBed.createComponent(OrdersComponent).componentInstance; component.receptionId = reception.id; component.description = reception.reason; component.items = [{ serviceId: 'service-1', quantity: 1 }];
  api.createWorkOrder.mockRejectedValue(new Error('Red no disponible')); await component.save(); await component.save();
  expect(api.createWorkOrder.mock.calls[0][0].operationId).toBe(api.createWorkOrder.mock.calls[1][0].operationId);
  component.saving.set(true); await component.save(); expect(api.createWorkOrder).toHaveBeenCalledTimes(2);
});
test('appointment lookup is scoped to the selected vehicle', async () => {
  const component = TestBed.createComponent(ReceptionsComponent).componentInstance; component.selectVehicle('vehicle-1'); await component.loadAppointments();
  expect(api.appointments).toHaveBeenCalledWith({ limit: 100, status: 'scheduled', vehicleId: 'vehicle-1' });
  component.appointmentId = 'old'; component.selectVehicle('vehicle-2'); expect(component.appointmentId).toBe('');
});

test('new API operations use SessionPort requestBusiness and retain supplied operationId', async () => {
  TestBed.resetTestingModule();
  const requestBusiness = vi.fn().mockResolvedValueOnce({ data: { receptions: page([reception]) } }).mockResolvedValueOnce({ data: { createReception: { reception } } }).mockResolvedValueOnce({ data: { orders: page([order]) } }).mockResolvedValueOnce({ data: { createWorkOrder: { order } } });
  TestBed.configureTestingModule({ providers: [OperationsApi, { provide: SESSION_PORT, useValue: { requestBusiness } }] });
  const client = TestBed.inject(OperationsApi);
  expect((await client.receptions({ open: true })).items[0].hasOrder).toBe(false);
  await client.createReception({ operationId: 'stable-reception' });
  expect((await client.orders({})).items[0].number).toBe(order.number);
  await client.createWorkOrder({ operationId: 'stable-order' });
  expect(requestBusiness.mock.calls[1][1]).toEqual({ input: { operationId: 'stable-reception' } });
  expect(requestBusiness.mock.calls[3][1]).toEqual({ input: { operationId: 'stable-order' } });
  expect(requestBusiness.mock.calls[2][0]).toContain('referenceRate');
});
