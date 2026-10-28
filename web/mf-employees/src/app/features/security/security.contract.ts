/** CU02 web contract: role and permission management through the BFF. */
export interface SecurityPermission {
  id: string;
  module: string;
  operation: string;
  description: string;
}
export interface SecurityCatalog {
  catalog: SecurityPermission[];
  effective: string[];
  roles: string[];
}
export interface Role {
  name: string;
  description: string;
  permissions: string[];
  system: boolean;
  version: number;
  syncStatus: 'synced' | 'pending' | 'failed';
  syncErrorCode: string | null;
  assignedCount: number;
}
export interface RoleAssignment {
  id: string;
  roleName: string;
  status: 'active' | 'revoked';
  syncStatus: 'synced' | 'pending' | 'failed';
  syncErrorCode: string | null;
  version: number;
  assignedAt: string;
}
export interface EmployeeRoles {
  employeeId: string;
  subject: string | null;
  items: RoleAssignment[];
}
export interface AssignableEmployee {
  id: string;
  firstName: string;
  lastName: string;
  status: 'active' | 'inactive';
  accessStatus: string;
}

const ROLE_FIELDS = 'name description permissions system version syncStatus syncErrorCode assignedCount';

export const SECURITY_CATALOG = `query SecurityCatalog { securityCatalog { catalog { id module operation description } effective roles } }`;
export const SECURITY_ROLES = `query SecurityRoles { securityRoles { ${ROLE_FIELDS} } }`;
export const ROLE_MUTATION_RESULT = `role { ${ROLE_FIELDS} } replayed`;
export const CREATE_ROLE = `mutation CreateRole($input: RoleCreateInput!) { createRole(input: $input) { ${ROLE_MUTATION_RESULT} } }`;
export const UPDATE_ROLE = `mutation UpdateRole($name: String!, $input: RoleUpdateInput!) { updateRole(name: $name, input: $input) { ${ROLE_MUTATION_RESULT} } }`;
export const RETRY_ROLE_SYNC = `mutation RetryRoleSync($name: String!, $input: RoleRetryInput!) { retryRoleSync(name: $name, input: $input) { ${ROLE_MUTATION_RESULT} } }`;
export const EMPLOYEE_ROLES = `query EmployeeRoles($id: UUID!) { employeeRoles(employeeId: $id) { employeeId subject items { id roleName status syncStatus syncErrorCode version assignedAt } } }`;
export const ASSIGN_ROLE = `mutation AssignRole($id: UUID!, $input: RoleAssignmentInput!) { assignRole(employeeId: $id, input: $input) { assignment { id roleName status syncStatus syncErrorCode version assignedAt } replayed } }`;
export const REVOKE_ROLE = `mutation RevokeRole($id: UUID!, $roleName: String!, $input: RoleRevocationInput!) { revokeRole(employeeId: $id, roleName: $roleName, input: $input) { assignment { id roleName status syncStatus syncErrorCode version assignedAt } replayed } }`;
export const ASSIGNABLE_EMPLOYEES = `query Assignable($search: String) { employees(search: $search, limit: 20) { items { id firstName lastName status access { status } } total } }`;

export const SYNC_LABELS: Readonly<Record<string, string>> = Object.freeze({
  synced: 'Sincronizado',
  pending: 'Pendiente',
  failed: 'Falló la sincronización',
});

export const SYNC_ERROR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  IDP_UNAVAILABLE: 'Proveedor de identidad no disponible',
  IDP_TIMEOUT: 'Tiempo de espera agotado con el proveedor de identidad',
  IDP_FORBIDDEN: 'La identidad técnica no tiene permiso sobre roles',
  IDP_RESPONSE_INVALID: 'Respuesta inválida del proveedor de identidad',
  ROLE_NAME_CONFLICT: 'El rol ya existe en el proveedor con otro contenido',
});

/** Shown next to the permission matrix; kept in sync with the published behavior. */
export const VALIDITY_NOTICE =
  'Los cambios de permisos se aplican a las nuevas peticiones; el BFF puede tardar hasta 30 s por su caché. ' +
  'Un token ya emitido conserva sus roles hasta 60 s + 5 s, pero un rol retirado deja de otorgar permisos en la siguiente petición. ' +
  'No se revocan sesiones abiertas.';
