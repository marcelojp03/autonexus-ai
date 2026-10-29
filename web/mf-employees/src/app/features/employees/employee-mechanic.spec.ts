import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNzDateFnsAdapter } from 'ng-zorro-antd/core/time';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EmployeeFormComponent } from './employee-form.component';
import { EmployeesApi } from './employees-api';
import { SESSION_PORT } from '../../auth/session';
import type { Employee } from './employees.contract';

const employee: Employee = { id: 'synthetic', firstName: 'Perfil', lastName: 'Sintético', document: 'test-only', email: 'synthetic@example.test', phone: '70000000', jobTitle: 'Mecánico', startDate: '2020-01-01', specialties: ['Frenos'], status: 'active', version: 7, createdAt: '', updatedAt: '', access: { requested: false, status: 'not_requested', subject: null, attempts: 0, errorCode: null } };
let api: { get: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
let requestBusiness: ReturnType<typeof vi.fn>;
beforeEach(() => {
  api = { get: vi.fn().mockResolvedValue(employee), create: vi.fn().mockResolvedValue({ employee, replayed: false }), update: vi.fn().mockResolvedValue({ employee, replayed: false }) };
  requestBusiness = vi.fn().mockResolvedValue({ data: { securityCatalog: { effective: ['employees:write'] } } });
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideNzDateFnsAdapter(), { provide: EmployeesApi, useValue: api }, { provide: SESSION_PORT, useValue: { requestBusiness } }] });
});
afterEach(() => TestBed.resetTestingModule());
async function ready(edit = false) {
  const fixture = TestBed.createComponent(EmployeeFormComponent); if (edit) fixture.componentRef.setInput('id', employee.id); fixture.detectChanges(); await fixture.whenStable();
  const component = fixture.componentInstance;
  if (!edit) component.form.patchValue({ firstName: employee.firstName, lastName: employee.lastName, document: employee.document, email: employee.email, phone: employee.phone, jobTitle: employee.jobTitle, startDate: new Date(2020, 0, 1), specialties: [] });
  return { fixture, component };
}
test('mechanic checkbox defaults false regardless of job title and sends explicit false', async () => {
  const { component } = await ready(); expect(component.form.controls.mechanicEnabled.value).toBe(false); await component.submit(); expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ mechanicEnabled: false, jobTitle: 'Mecánico' }) }));
});
test('enabling requires a specialty and does not grant any role or account', async () => {
  const { component, fixture } = await ready(); component.form.controls.mechanicEnabled.setValue(true); await component.submit(); expect(api.create).not.toHaveBeenCalled(); expect(component.error()).toContain('al menos una especialidad');
  component.form.controls.specialties.setValue(['Frenos']); await component.submit(); const input = api.create.mock.calls[0][0].input; expect(input.mechanicEnabled).toBe(true); expect(input.access).toEqual({ requested: false }); expect(input.roles).toBeUndefined(); expect(fixture.nativeElement.querySelector('#employee-mechanic-enabled')).not.toBeNull();
});
test('legacy profile without flag displays false and editing sends expected version', async () => {
  const { component, fixture } = await ready(true); expect(component.form.controls.mechanicEnabled.value).toBe(false); fixture.detectChanges(); expect(fixture.nativeElement.querySelector('#employee-mechanic-status').textContent).toContain('No habilitado');
  component.form.controls.mechanicEnabled.setValue(true); await component.submit(); expect(api.update).toHaveBeenCalledWith({ id: employee.id, input: expect.objectContaining({ expectedVersion: 7, mechanicEnabled: true }) });
});
test('without employees write flag is disabled and omitted on update', async () => {
  api.get.mockResolvedValue({ ...employee, mechanicEnabled: true }); requestBusiness.mockResolvedValue({ data: { securityCatalog: { effective: ['confirmations:read'] } } });
  const { component } = await ready(true); expect(component.canManageMechanic()).toBe(false); expect(component.form.controls.mechanicEnabled.disabled).toBe(true); await component.submit(); expect(api.update.mock.calls[0][0].input.mechanicEnabled).toBeUndefined();
});
test('busy guard prevents a duplicate employee mutation', async () => {
  const { component } = await ready(); component.saving.set(true); await component.submit(); expect(api.create).not.toHaveBeenCalled();
});
