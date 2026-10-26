export function canPresentSession(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const state = value as { mode?: string; phase?: string; authenticated?: boolean; identity?: { roles?: unknown } };
  const roles = state.identity?.roles;
  return state.mode === 'oidc' && state.phase === 'authenticated' && state.authenticated === true && Array.isArray(roles) && roles.some(role => ['administrador', 'recepcionista', 'mecanico', 'jefe_taller', 'responsable_financiero'].includes(role));
}
