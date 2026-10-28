import { PERMISSIONS, isPermission, type Permission } from './permissions.js';

export class SecurityError extends Error {
  constructor(readonly statusCode: number, readonly code: string, options?: { cause?: unknown }) { super(code, options); this.name = 'SecurityError'; }
}

export const SYNC_STATUSES = ['synced', 'pending', 'failed'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];
export const SYNC_ERROR_CODES = ['IDP_UNAVAILABLE', 'IDP_TIMEOUT', 'IDP_FORBIDDEN', 'IDP_RESPONSE_INVALID', 'ROLE_NAME_CONFLICT'] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

export interface RoleView {
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
  readonly system: boolean;
  readonly version: number;
  readonly syncStatus: SyncStatus;
  readonly syncErrorCode: SyncErrorCode | null;
  readonly assignedCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssignmentView {
  readonly id: string;
  readonly roleName: string;
  readonly employeeId: string;
  readonly subject: string;
  readonly status: 'active' | 'revoked';
  readonly syncStatus: SyncStatus;
  readonly syncErrorCode: SyncErrorCode | null;
  readonly assignedAt: string;
  readonly assignedBy: string;
  readonly version: number;
}

export interface SecurityHistoryView {
  readonly id: string;
  readonly entity: 'role' | 'assignment';
  readonly entityId: string;
  readonly action: string;
  readonly actorSubject: string;
  readonly occurredAt: string;
  readonly version: number;
  readonly snapshot: unknown;
}

export interface RoleDraft { readonly description: string; readonly permissions: readonly Permission[]; }

const ROLE_NAME = /^[a-z][a-z0-9_]{2,63}$/;
const invalid = (): never => { throw new SecurityError(400, 'VALIDATION_ERROR'); };
const collapse = (value: string): string => value.trim().replace(/\s+/gu, ' ');

export function roleName(value: unknown): string {
  if (typeof value !== 'string' || !ROLE_NAME.test(value)) return invalid();
  return value;
}

export function roleDescription(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return invalid();
  const normalized = collapse(value);
  if (normalized.length > 200) return invalid();
  return normalized;
}

/** New and updated roles must carry at least one known permission and no duplicates. */
export function rolePermissions(value: unknown): readonly Permission[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > PERMISSIONS.length) return invalid();
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPermission(item) || seen.has(item)) return invalid();
    seen.add(item);
  }
  return Object.freeze([...seen] as Permission[]);
}

export function roleDraft(input: unknown, keys: readonly string[]): RoleDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !keys.includes(key))) return invalid();
  return { description: roleDescription(body.description), permissions: rolePermissions(body.permissions) };
}

export function expectedVersionOf(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return invalid();
  return value as number;
}

/** Escalation guard: an actor may only grant permissions it already holds. */
export function assertNoEscalation(requested: readonly Permission[], effective: readonly Permission[]): void {
  if (requested.some(item => !effective.includes(item))) throw new SecurityError(409, 'PERMISSION_ESCALATION');
}
