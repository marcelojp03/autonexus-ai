import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '../../domain/permissions.js';

export const WORKSHOP_ROLES = ['administrador', 'recepcionista', 'mecanico', 'jefe_taller', 'responsable_financiero'] as const;
export type WorkshopRole = typeof WORKSHOP_ROLES[number];
export interface VerifiedIdentity {
  readonly subject: string;
  readonly clientId?: string;
  readonly scopes?: readonly string[];
  readonly roles: readonly string[];
  readonly permissions: readonly Permission[];
  readonly recognized: readonly string[];
}
export interface AuthenticatedRequest extends Request { identity: VerifiedIdentity; }
export const AUTH_POLICY = Symbol('AUTH_POLICY');
export type AuthPolicy =
  | { agenda: true }
  | { technicalScope: string }
  | { public: true }
  | { roles: readonly WorkshopRole[] }
  | { permissions: readonly Permission[] }
  | { authenticated: true };
export const RequireCu15 = (technicalScope: string) => SetMetadata(AUTH_POLICY, { technicalScope } satisfies AuthPolicy);
export const RequireAgenda = () => SetMetadata(AUTH_POLICY, { agenda: true } satisfies AuthPolicy);
export const Public = () => SetMetadata(AUTH_POLICY, { public: true } satisfies AuthPolicy);
export const RequireRoles = (...roles: WorkshopRole[]) => SetMetadata(AUTH_POLICY, { roles } satisfies AuthPolicy);
/** CU02 policy: the permission catalog replaces role names for every business operation. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(AUTH_POLICY, { permissions } satisfies AuthPolicy);
/** Any token whose realm roles exist in the persisted catalog. */
export const RequireAuthenticated = () => SetMetadata(AUTH_POLICY, { authenticated: true } satisfies AuthPolicy);
