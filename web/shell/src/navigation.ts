/** Presentation only: business authority stays in the BFF and each owner. */
const roleLabels: Readonly<Record<string, string>> = {
  administrador: 'Administración',
  jefe_taller: 'Jefe de taller',
  mecanico: 'Mecánico',
  recepcionista: 'Recepción',
  responsable_financiero: 'Finanzas',
};

export function sessionLabel(roles: readonly string[]): string {
  return [...new Set(roles.map(role => roleLabels[role] ?? 'Rol personalizado'))].join(' · ');
}

export function employeeEntryPath(effective: readonly string[]): string {
  if (effective.includes('employees:read')) return '/employees/list';
  if (effective.includes('agenda:read:team')) return '/employees/agenda/team';
  if (effective.includes('agenda:read:self')) return '/employees/agenda';
  return '/employees/assistant';
}
