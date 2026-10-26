import { randomUUID } from 'node:crypto';
import {
  command,
  query,
  transition,
  uuid,
  type Action,
} from '../domain/employee.js';
import type { EmployeeRepository } from './employee-repository.js';
import { IdentitySyncError, type IdentityGateway } from './identity-gateway.js';
export class ManageEmployees {
  constructor(
    private readonly repository: EmployeeRepository,
    private readonly identity: IdentityGateway,
  ) {}
  get(id: unknown) {
    return this.repository.get(uuid(id));
  }
  list(input: unknown) {
    return this.repository.list(query(input));
  }
  history(id: unknown, input: unknown) {
    return this.repository.history(uuid(id), query(input, true));
  }
  async mutate(action: Action, id: unknown, input: unknown, actor: string) {
    const parsed = command(action, id, input);
    const newId = randomUUID(),
      now = new Date().toISOString();
    const result = await this.repository.execute(parsed, actor, (current) =>
      transition(parsed, current, actor, newId, now),
    );
    if (!result.replayed && result.employee.access.status === 'pending') {
      try {
        await this.repository.synchronize(
          result.employee.id,
          async (desired) => {
            try {
              return { subject: await this.identity.sync(desired) };
            } catch (error) {
              const codes = [
                'IDP_UNAVAILABLE',
                'IDP_TIMEOUT',
                'IDP_FORBIDDEN',
                'IDP_OWNERSHIP_CONFLICT',
                'IDP_RESPONSE_INVALID',
              ];
              return {
                code:
                  error instanceof IdentitySyncError &&
                  codes.includes(error.code)
                    ? error.code
                    : 'IDP_UNAVAILABLE',
                conflict: error instanceof IdentitySyncError && error.conflict,
              };
            }
          },
        );
      } catch {
        /* Local commit is durable. Explicit retry reconciles a lost confirmation. */
      }
    }
    return result;
  }
}
