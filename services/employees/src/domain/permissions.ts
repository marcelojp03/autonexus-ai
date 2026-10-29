/** Closed permission catalog for CU02. Every entry is backed by a delivered use case. */
export const PERMISSIONS = [
  'employees:read',
  'employees:write',
  'schedules:read',
  'schedules:write',
  'security:read',
  'security:write',
  'customers:read',
  'customers:write',
  'vehicles:read',
  'vehicles:write',
  'catalog:read',
  'catalog:write',
  'appointments:read',
  'appointments:write',
  'receptions:read',
  'receptions:write',
  'orders:read',
  'orders:write',
  'quotes:read',
  'quotes:write',
  'quotes:decide',
  'confirmations:read',
  'confirmations:write',
  'agenda:read:self',
  'agenda:read:team',
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
  { id: 'customers:read', module: 'Clientes', operation: 'read', description: 'Consultar clientes del taller (CU06)' },
  { id: 'customers:write', module: 'Clientes', operation: 'write', description: 'Registrar, actualizar y desactivar clientes (CU06)' },
  { id: 'vehicles:read', module: 'Vehículos', operation: 'read', description: 'Consultar vehículos y su propietario (CU07)' },
  { id: 'vehicles:write', module: 'Vehículos', operation: 'write', description: 'Registrar, actualizar y desactivar vehículos (CU07)' },
  { id: 'catalog:read', module: 'Catálogo', operation: 'read', description: 'Consultar el catálogo de servicios (CU09)' },
  { id: 'catalog:write', module: 'Catálogo', operation: 'write', description: 'Crear, actualizar y desactivar servicios (CU09)' },
  { id: 'appointments:read', module: 'Citas', operation: 'read', description: 'Consultar citas y la agenda del taller (CU10)' },
  { id: 'appointments:write', module: 'Citas', operation: 'write', description: 'Registrar, reprogramar y cancelar citas (CU10)' },
  { id: 'receptions:read', module: 'Recepción', operation: 'read', description: 'Consultar recepciones e inspecciones del vehículo (CU11)' },
  { id: 'receptions:write', module: 'Recepción', operation: 'write', description: 'Recepcionar e inspeccionar un vehículo (CU11)' },
  { id: 'orders:read', module: 'Órdenes', operation: 'read', description: 'Consultar órdenes de trabajo (CU12)' },
  { id: 'orders:write', module: 'Órdenes', operation: 'write', description: 'Crear y modificar órdenes de trabajo (CU12)' },
  { id: 'quotes:read', module: 'Cotizaciones', operation: 'read', description: 'Consultar cotizaciones y sus versiones (CU13)' },
  { id: 'quotes:write', module: 'Cotizaciones', operation: 'write', description: 'Elaborar y versionar cotizaciones (CU13)' },
  { id: 'quotes:decide', module: 'Cotizaciones', operation: 'decide', description: 'Registrar la aprobación o el rechazo del cliente (CU14)' },
  { id: 'confirmations:read', module: 'Confirmaciones', operation: 'read', description: 'Consultar confirmaciones y candidatos mecánicos (CU15)' },
  { id: 'confirmations:write', module: 'Confirmaciones', operation: 'write', description: 'Iniciar y recuperar confirmaciones (CU15)' },
  { id: 'agenda:read:self', module: 'Agenda', operation: 'read', description: 'Consultar agenda propia vinculada (CU05)' },
  { id: 'agenda:read:team', module: 'Agenda', operation: 'read', description: 'Consultar agenda del equipo (CU05)' },
]);

const KNOWN = new Set<string>(PERMISSIONS);

export const isPermission = (value: unknown): value is Permission => typeof value === 'string' && KNOWN.has(value);

/** Permissions granted by the initial roles; reproduces the policy in force before CU02. */
export const INITIAL_ROLES: readonly { name: string; description: string; permissions: readonly Permission[] }[] = Object.freeze([
  { name: 'administrador', description: 'Administración completa de la plataforma', permissions: PERMISSIONS },
  { name: 'jefe_taller', description: 'Planificación y supervisión del taller', permissions: [
    'schedules:read', 'schedules:write', 'customers:read', 'vehicles:read', 'catalog:read', 'catalog:write',
    'appointments:read', 'appointments:write', 'receptions:read', 'orders:read', 'orders:write',
    'quotes:read', 'quotes:decide', 'confirmations:read', 'confirmations:write',
    'agenda:read:self', 'agenda:read:team',
  ] },
  { name: 'recepcionista', description: 'Atención al cliente en recepción', permissions: [
    'customers:read', 'customers:write', 'vehicles:read', 'vehicles:write', 'catalog:read',
    'appointments:read', 'appointments:write', 'receptions:read', 'receptions:write',
    'orders:read', 'orders:write', 'quotes:read', 'quotes:decide',
  ] },
  { name: 'mecanico', description: 'Trabajo técnico en el taller', permissions: ['receptions:read', 'receptions:write', 'agenda:read:self'] },
  { name: 'responsable_financiero', description: 'Responsabilidad financiera', permissions: ['orders:read', 'quotes:read', 'quotes:write', 'quotes:decide'] },
]);
