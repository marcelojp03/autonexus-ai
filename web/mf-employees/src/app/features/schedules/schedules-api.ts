import { inject, Injectable } from '@angular/core';
import { SESSION_PORT } from '../../auth/session';
import { EmployeesFailure } from '../employees/employees-api';
import type { Absence, Availability, Schedule, Shift, StaffingEmployee } from './schedules.contract';
import { AVAILABILITY_QUERY, CANCEL_ABSENCE, CREATE_ABSENCE, CREATE_SHIFT, DEACTIVATE_SHIFT, SCHEDULE_QUERY, STAFFING_EMPLOYEES } from './schedules.contract';

@Injectable({ providedIn: 'root' })
export class SchedulesApi {
  private readonly session = inject(SESSION_PORT);

  employees(search?: string): Promise<StaffingEmployee[]> {
    return this.run<{ staffingEmployees: StaffingEmployee[] }>(STAFFING_EMPLOYEES, search ? { search } : {}).then(data => data.staffingEmployees);
  }

  schedule(employeeId: string): Promise<Schedule> {
    return this.run<{ employeeSchedule: Schedule }>(SCHEDULE_QUERY, { id: employeeId }).then(data => data.employeeSchedule);
  }

  availability(employeeId: string, date: string): Promise<Availability> {
    return this.run<{ employeeAvailability: Availability }>(AVAILABILITY_QUERY, { id: employeeId, date }).then(data => data.employeeAvailability);
  }

  createShift(employeeId: string, input: Record<string, unknown>): Promise<{ shift: Shift; acknowledgedAssignments: boolean }> {
    return this.run<{ createShift: { shift: Shift; acknowledgedAssignments: boolean } }>(CREATE_SHIFT, { employeeId, input }).then(data => data.createShift);
  }

  deactivateShift(id: string, version: number, acknowledge: boolean): Promise<{ shift: Shift }> {
    return this.run<{ deactivateShift: { shift: Shift } }>(DEACTIVATE_SHIFT, {
      id,
      input: { operationId: globalThis.crypto.randomUUID(), expectedVersion: version, acknowledgeConfirmedAssignments: acknowledge },
    }).then(data => data.deactivateShift);
  }

  createAbsence(employeeId: string, input: Record<string, unknown>): Promise<{ absence: Absence }> {
    return this.run<{ createAbsence: { absence: Absence } }>(CREATE_ABSENCE, { employeeId, input }).then(data => data.createAbsence);
  }

  cancelAbsence(id: string, version: number, acknowledge: boolean): Promise<{ absence: Absence }> {
    return this.run<{ cancelAbsence: { absence: Absence } }>(CANCEL_ABSENCE, {
      id,
      input: { operationId: globalThis.crypto.randomUUID(), expectedVersion: version, acknowledgeConfirmedAssignments: acknowledge },
    }).then(data => data.cancelAbsence);
  }

  private async run<T>(query: string, variables?: Readonly<Record<string, unknown>>): Promise<T> {
    if (!this.session) throw new EmployeesFailure({ code: 'NO_SESSION_PORT', statusCode: 401, message: 'Esta vista requiere la sesión del Shell.' });
    const result = await this.session.requestBusiness(query, variables);
    if (result.errors?.length) throw new EmployeesFailure(result.errors[0]);
    if (!result.data) throw new EmployeesFailure({ code: 'SERVICE_UNAVAILABLE', statusCode: 503, message: 'El servicio de empleados no está disponible.' });
    return result.data as T;
  }
}
