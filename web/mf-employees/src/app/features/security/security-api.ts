import { inject, Injectable } from '@angular/core';
import { SESSION_PORT } from '../../auth/session';
import { EmployeesFailure } from '../employees/employees-api';
import {
  ASSIGNABLE_EMPLOYEES,
  ASSIGN_ROLE,
  CREATE_ROLE,
  EMPLOYEE_ROLES,
  RETRY_ROLE_SYNC,
  REVOKE_ROLE,
  SECURITY_CATALOG,
  SECURITY_ROLES,
  UPDATE_ROLE,
  type AssignableEmployee,
  type EmployeeRoles,
  type Role,
  type RoleAssignment,
  type SecurityCatalog,
} from './security.contract';

@Injectable({ providedIn: 'root' })
export class SecurityApi {
  private readonly session = inject(SESSION_PORT);

  catalog(): Promise<SecurityCatalog> {
    return this.run<{ securityCatalog: SecurityCatalog }>(SECURITY_CATALOG).then(data => data.securityCatalog);
  }

  roles(): Promise<Role[]> {
    return this.run<{ securityRoles: Role[] }>(SECURITY_ROLES).then(data => data.securityRoles);
  }

  createRole(name: string, description: string, permissions: string[]): Promise<Role> {
    return this.run<{ createRole: { role: Role } }>(CREATE_ROLE, {
      input: { operationId: globalThis.crypto.randomUUID(), name, description, permissions },
    }).then(data => data.createRole.role);
  }

  updateRole(name: string, version: number, description: string, permissions: string[]): Promise<Role> {
    return this.run<{ updateRole: { role: Role } }>(UPDATE_ROLE, {
      name,
      input: { operationId: globalThis.crypto.randomUUID(), expectedVersion: version, description, permissions },
    }).then(data => data.updateRole.role);
  }

  retryRoleSync(name: string, version: number): Promise<Role> {
    return this.run<{ retryRoleSync: { role: Role } }>(RETRY_ROLE_SYNC, {
      name,
      input: { operationId: globalThis.crypto.randomUUID(), expectedVersion: version },
    }).then(data => data.retryRoleSync.role);
  }

  employeeRoles(employeeId: string): Promise<EmployeeRoles> {
    return this.run<{ employeeRoles: EmployeeRoles }>(EMPLOYEE_ROLES, { id: employeeId }).then(data => data.employeeRoles);
  }

  assignRole(employeeId: string, roleName: string): Promise<RoleAssignment> {
    return this.run<{ assignRole: { assignment: RoleAssignment } }>(ASSIGN_ROLE, {
      id: employeeId,
      input: { operationId: globalThis.crypto.randomUUID(), roleName },
    }).then(data => data.assignRole.assignment);
  }

  revokeRole(employeeId: string, roleName: string, version: number): Promise<RoleAssignment> {
    return this.run<{ revokeRole: { assignment: RoleAssignment } }>(REVOKE_ROLE, {
      id: employeeId,
      roleName,
      input: { operationId: globalThis.crypto.randomUUID(), expectedVersion: version },
    }).then(data => data.revokeRole.assignment);
  }

  employees(search?: string): Promise<AssignableEmployee[]> {
    return this.run<{ employees: { items: Array<{ id: string; firstName: string; lastName: string; status: 'active' | 'inactive'; access: { status: string } }> } }>(
      ASSIGNABLE_EMPLOYEES,
      search ? { search } : {},
    ).then(data => data.employees.items.map(item => ({
      id: item.id,
      firstName: item.firstName,
      lastName: item.lastName,
      status: item.status,
      accessStatus: item.access.status,
    })));
  }

  private async run<T>(query: string, variables?: Readonly<Record<string, unknown>>): Promise<T> {
    if (!this.session) throw new EmployeesFailure({ code: 'NO_SESSION_PORT', statusCode: 401, message: 'Esta vista requiere la sesión del Shell.' });
    const result = await this.session.requestBusiness(query, variables);
    if (result.errors?.length) throw new EmployeesFailure(result.errors[0]);
    if (!result.data) throw new EmployeesFailure({ code: 'SERVICE_UNAVAILABLE', statusCode: 503, message: 'El servicio de empleados no está disponible.' });
    return result.data as T;
  }
}
