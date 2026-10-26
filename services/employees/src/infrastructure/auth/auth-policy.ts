import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const WORKSHOP_ROLES = ['administrador', 'recepcionista', 'mecanico', 'jefe_taller', 'responsable_financiero'] as const;
export type WorkshopRole = typeof WORKSHOP_ROLES[number];
export interface VerifiedIdentity { subject: string; roles: WorkshopRole[]; }
export interface AuthenticatedRequest extends Request { identity: VerifiedIdentity; }
export const AUTH_POLICY = Symbol('AUTH_POLICY');
export type AuthPolicy = { public: true } | { roles: readonly WorkshopRole[] };
export const Public = () => SetMetadata(AUTH_POLICY, { public: true } satisfies AuthPolicy);
export const RequireRoles = (...roles: WorkshopRole[]) => SetMetadata(AUTH_POLICY, { roles } satisfies AuthPolicy);
