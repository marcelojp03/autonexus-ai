import type { EffectivePermissions, SecurityRepository } from './security-repository.js';

/** Resolves permissions for one request: token roles intersected with persisted roles and assignments. */
export class AuthorizeActor {
  constructor(private readonly repository: SecurityRepository) {}

  resolve(subject: string, roles: readonly string[]): Promise<EffectivePermissions> {
    return this.repository.permissions(subject, roles);
  }
}
