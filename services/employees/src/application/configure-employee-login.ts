import { EmployeeError, object, uuid, type Employee } from '../domain/employee.js';
import type { Permission } from '../domain/permissions.js';
import type { SecurityRepository } from './security-repository.js';

export interface LoginResult { username: string; ready: boolean; replayed: boolean }
export interface LoginGateway {
  configure(employee: Employee, username: string, password: string): Promise<void>;
}
export interface LoginRepository {
  configureLogin(id: string, operationId: string, username: string, actor: string,
    apply: (employee: Employee) => Promise<void>): Promise<LoginResult>;
}

/** Credentials live only in this call and the IdP request, never in a durable command. */
export class ConfigureEmployeeLogin {
  constructor(private readonly repository: LoginRepository, private readonly gateway: LoginGateway,
    private readonly security: Pick<SecurityRepository, 'employeeRoles' | 'role'>) {}
  run(id: unknown, input: unknown, actor: string, permissions: readonly Permission[]): Promise<LoginResult> {
    const body = object(input);
    if (Object.keys(body).some(key => !['operationId', 'username', 'password'].includes(key)) ||
      typeof body.username !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(body.username) ||
      typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128 ||
      /[\x00-\x1f\x7f]/.test(body.password)) throw new EmployeeError(400, 'VALIDATION_ERROR');
    const username = body.username;
    const password = body.password;
    return this.repository.configureLogin(uuid(id), uuid(body.operationId), username, actor,
      async employee => {
        const assignments = await this.security.employeeRoles(employee.id);
        for (const assignment of assignments.items.filter(item => item.status === 'active')) {
          const role = await this.security.role(assignment.roleName);
          if (role.permissions.some(permission => !permissions.includes(permission)))
            throw new EmployeeError(409, 'PERMISSION_ESCALATION');
        }
        await this.gateway.configure(employee, username, password);
      });
  }
}
