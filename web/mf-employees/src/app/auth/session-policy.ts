export function canPresentSession(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const state = value as { mode?: string; phase?: string; authenticated?: boolean; identity?: { roles?: unknown } };
  const roles = state.identity?.roles;
  // This only presents the container. API/BFF permissions remain authoritative.
  return state.mode === 'oidc' && state.phase === 'authenticated' && state.authenticated === true && Array.isArray(roles) && roles.some(role => typeof role === 'string' && /^[a-z][a-z0-9_]{2,63}$/.test(role));
}
