import { inject, Injectable } from '@angular/core';
import type { BusinessFailure } from '../../../../../../contracts/auth/session';
import { SESSION_PORT } from '../../auth/session';
import {
  CREATE_EMPLOYEE,
  DEACTIVATE_EMPLOYEE,
  EMPLOYEE_HISTORY_QUERY,
  EMPLOYEE_QUERY,
  EMPLOYEES_QUERY,
  RETRY_ACCESS,
  UPDATE_EMPLOYEE,
  type CommandVariables,
  type CreateEmployeeVariables,
  type Employee,
  type EmployeeHistoryPage,
  type EmployeeMutationResult,
  type EmployeePage,
  type EmployeeStatus,
  type UpdateEmployeeVariables
} from './employees.contract';

/** Failure with a stable BFF code, ready for the view to branch on. */
export class EmployeesFailure extends Error {
  constructor(readonly failure: BusinessFailure) {
    super(failure.message);
  }
}

export interface EmployeesQuery {
  limit?: number;
  offset?: number;
  status?: EmployeeStatus;
  search?: string;
}

@Injectable({ providedIn: 'root' })
export class EmployeesApi {
  private readonly session = inject(SESSION_PORT);

  list(query: EmployeesQuery): Promise<EmployeePage> {
    return this.run<{ employees: EmployeePage }>(EMPLOYEES_QUERY, {
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.offset === undefined ? {} : { offset: query.offset }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined || !query.search.trim() ? {} : { search: query.search.trim() })
    }).then(data => data.employees);
  }

  get(id: string): Promise<Employee> {
    return this.run<{ employee: Employee }>(EMPLOYEE_QUERY, { id }).then(data => data.employee);
  }

  history(id: string, query: { limit?: number; offset?: number } = {}): Promise<EmployeeHistoryPage> {
    return this.run<{ employeeHistory: EmployeeHistoryPage }>(EMPLOYEE_HISTORY_QUERY, {
      id,
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.offset === undefined ? {} : { offset: query.offset })
    }).then(data => data.employeeHistory);
  }

  create(variables: CreateEmployeeVariables): Promise<EmployeeMutationResult> {
    return this.run<{ createEmployee: EmployeeMutationResult }>(CREATE_EMPLOYEE, { input: variables.input }).then(data => data.createEmployee);
  }

  update(variables: UpdateEmployeeVariables): Promise<EmployeeMutationResult> {
    return this.run<{ updateEmployee: EmployeeMutationResult }>(UPDATE_EMPLOYEE, { id: variables.id, input: variables.input }).then(data => data.updateEmployee);
  }

  deactivate(variables: CommandVariables): Promise<EmployeeMutationResult> {
    return this.run<{ deactivateEmployee: EmployeeMutationResult }>(DEACTIVATE_EMPLOYEE, { id: variables.id, input: variables.input }).then(data => data.deactivateEmployee);
  }

  retryAccess(variables: CommandVariables): Promise<EmployeeMutationResult> {
    return this.run<{ retryEmployeeAccess: EmployeeMutationResult }>(RETRY_ACCESS, { id: variables.id, input: variables.input }).then(data => data.retryEmployeeAccess);
  }

  private async run<T>(query: string, variables?: Readonly<Record<string, unknown>>): Promise<T> {
    if (!this.session) throw new EmployeesFailure({ code: 'NO_SESSION_PORT', statusCode: 401, message: 'Esta vista requiere la sesión del Shell.' });
    const result = await this.session.requestBusiness(query, variables);
    if (result.errors?.length) throw new EmployeesFailure(result.errors[0]);
    if (!result.data) throw new EmployeesFailure({ code: 'SERVICE_UNAVAILABLE', statusCode: 503, message: 'El servicio de empleados no está disponible.' });
    return result.data as T;
  }
}

/** One-time idempotency key for a concrete user intent. */
export function newOperationId(): string {
  return globalThis.crypto.randomUUID();
}
