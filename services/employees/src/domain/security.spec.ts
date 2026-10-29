import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_CATALOG, INITIAL_ROLES, isPermission } from './permissions.js';
import {
  SecurityError,
  assertNoEscalation,
  expectedVersionOf,
  roleDescription,
  roleDraft,
  roleName,
  rolePermissions,
} from './security.js';

const code = (work: () => unknown): string => {
  try { work(); } catch (error) { return (error as SecurityError).code; }
  return 'NO_ERROR';
};

describe('permission catalog', () => {
  it('lists one descriptor per permission, backed by a delivered use case', () => {
    expect(PERMISSION_CATALOG.map(item => item.id)).toEqual([...PERMISSIONS]);
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const item of PERMISSION_CATALOG) {
      expect(item.id).toBe(item.module.length ? item.id : item.id);
      expect(item.id).toContain(item.operation);
      expect(item.description.length).toBeGreaterThan(10);
      expect(isPermission(item.id)).toBe(true);
    }
  });

  it('rejects unknown permissions and keeps initial roles consistent', () => {
    expect(isPermission('finances:read')).toBe(false);
    expect(isPermission(42)).toBe(false);
    const names = INITIAL_ROLES.map(role => role.name);
    expect(names).toEqual(['administrador', 'jefe_taller', 'recepcionista', 'mecanico', 'responsable_financiero']);
    expect(INITIAL_ROLES[0].permissions).toEqual([...PERMISSIONS]);
    expect(INITIAL_ROLES[1].permissions).toContain('orders:write');
    expect(INITIAL_ROLES[1].permissions).not.toContain('quotes:write');
    expect(INITIAL_ROLES[2].permissions).toContain('receptions:write');
    expect(INITIAL_ROLES[2].permissions).toContain('quotes:decide');
    expect(INITIAL_ROLES[3].permissions).toEqual(['receptions:read', 'receptions:write']);
    expect(INITIAL_ROLES[4].permissions).toEqual(['orders:read', 'quotes:read', 'quotes:write', 'quotes:decide']);
    expect(PERMISSIONS.length).toBe(23);
    expect(INITIAL_ROLES[1].permissions).toContain('confirmations:write');
  });
});

describe('role validation', () => {
  it('accepts slug names and rejects everything else', () => {
    expect(roleName('supervisor_pruebas')).toBe('supervisor_pruebas');
    for (const value of ['ab', 'Supervisor', '1supervisor', 'supervisor-pruebas', 'supervisor pruebas', '', 'a'.repeat(65), 7, null]) {
      expect(code(() => roleName(value))).toBe('VALIDATION_ERROR');
    }
  });

  it('requires at least one distinct known permission', () => {
    expect(rolePermissions(['schedules:read'])).toEqual(['schedules:read']);
    for (const value of [[], ['finances:read'], ['schedules:read', 'schedules:read'], 'schedules:read', ['schedules:read', ...Array(8).fill('employees:read')]]) {
      expect(code(() => rolePermissions(value))).toBe('VALIDATION_ERROR');
    }
  });

  it('normalizes descriptions and bounds them', () => {
    expect(roleDescription('  Planifica   el  taller ')).toBe('Planifica el taller');
    expect(roleDescription(undefined)).toBe('');
    expect(code(() => roleDescription('x'.repeat(201)))).toBe('VALIDATION_ERROR');
    expect(code(() => roleDescription(1))).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown keys in a role draft', () => {
    expect(roleDraft({ description: 'x', permissions: ['security:read'] }, ['description', 'permissions']))
      .toEqual({ description: 'x', permissions: ['security:read'] });
    expect(code(() => roleDraft({ description: 'x', permissions: ['security:read'], system: true }, ['description', 'permissions']))).toBe('VALIDATION_ERROR');
  });

  it('requires a positive integer version', () => {
    expect(expectedVersionOf(2)).toBe(2);
    for (const value of [0, -1, 1.5, '2', null]) expect(code(() => expectedVersionOf(value))).toBe('VALIDATION_ERROR');
  });
});

describe('escalation guard', () => {
  it('allows granting permissions inside the actor scope', () => {
    expect(() => assertNoEscalation(['schedules:read'], ['schedules:read', 'security:write'])).not.toThrow();
  });

  it('blocks granting a permission the actor does not hold', () => {
    expect(code(() => assertNoEscalation(['employees:write'], ['security:write']))).toBe('PERMISSION_ESCALATION');
  });
});
