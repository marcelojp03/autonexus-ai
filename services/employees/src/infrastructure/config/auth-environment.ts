const LOCAL_ISSUER = 'http://127.0.0.1:8180/realms/autonexus';
const OWN_AUDIENCE = 'autonexus-employees-api';
const LOCAL_ORIGINS = [4200, 4201, 4202].map((port) => `http://127.0.0.1:${port}`);

export function authEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const issuer = env.OIDC_ISSUER_URI ?? LOCAL_ISSUER;
  const audience = env.OIDC_AUDIENCE ?? OWN_AUDIENCE;
  const origins = env.WEB_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()) ?? LOCAL_ORIGINS;
  if (issuer !== LOCAL_ISSUER) throw new Error('Invalid configuration: OIDC_ISSUER_URI');
  if (audience !== OWN_AUDIENCE) throw new Error('Invalid configuration: OIDC_AUDIENCE');
  if (!origins.length || origins.some((origin) => !LOCAL_ORIGINS.includes(origin))) {
    throw new Error('Invalid configuration: WEB_ALLOWED_ORIGINS');
  }
  return { issuer, audience, origins: [...new Set(origins)] };
}

export type AuthConfiguration = ReturnType<typeof authEnvironment>;
