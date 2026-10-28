/** Closed permission catalog for CU02. Every entry is backed by a delivered use case. */
export const PERMISSIONS = [
  'employees:read',
  'employees:write',
  'schedules:read',
  'schedules:write',
  'security:read',
  'security:write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface PermissionDescriptor {
  readonly id: Permission;
  readonly module: string;
  readonly operation: string;
  readonly description: string;
}

export const PERMISSION_CATALOG: readonly PermissionDescriptor[] = Object.freeze([
  { id: 'employees:read', module: 'Empleados', operation: 'read', description: 'Consultar empleados, ficha e historial (CU03)' },
  { id: 'employees:write', module: 'Empleados', operation: 'write', description: 'Alta, edición, desactivación y reintento de acceso (CU03)' },
  { id: 'schedules:read', module: 'Horarios', operation: 'read', description: 'Consultar horarios, ausencias y disponibilidad (CU04)' },
  { id: 'schedules:write', module: 'Horarios', operation: 'write', description: 'Planificar turnos, descansos y ausencias (CU04)' },
  { id: 'security:read', module: 'Seguridad', operation: 'read', description: 'Consultar roles, permisos y asignaciones (CU02)' },
  { id: 'security:write', module: 'Seguridad', operation: 'write', description: 'Crear y modificar roles, asignarlos y retirarlos (CU02)' },
]);

const KNOWN = new Set<string>(PERMISSIONS);

export const isPermission = (value: unknown): value is Permission => typeof value === 'string' && KNOWN.has(value);

/** Permissions granted by the initial roles; reproduces the policy in force before CU02. */
export const INITIAL_ROLES: readonly { name: string; description: string; permissions: readonly Permission[] }[] = Object.freeze([
  { name: 'administrador', description: 'Administración completa de la plataforma', permissions: PERMISSIONS },
  { name: 'jefe_taller', description: 'Planificación de horarios y disponibilidad', permissions: ['schedules:read', 'schedules:write'] },
  { name: 'recepcionista', description: 'Atención al cliente en recepción', permissions: [] },
  { name: 'mecanico', description: 'Trabajo técnico en el taller', permissions: [] },
  { name: 'responsable_financiero', description: 'Responsabilidad financiera', permissions: [] },
]);
