import { authEnvironment } from './auth-environment.js';

describe('Explicit local CU01 auth policy', () => {
  it('defaults to the exact trusted issuer, own audience and web origins', () => {
    expect(authEnvironment({})).toEqual({
      issuer: 'http://127.0.0.1:8180/realms/autonexus',
      jwksUri: 'http://127.0.0.1:8180/realms/autonexus/protocol/openid-connect/certs',
      audience: 'autonexus-employees-api',
      origins: ['http://127.0.0.1:4200', 'http://127.0.0.1:4201', 'http://127.0.0.1:4202'],
    });
  });

  it.each([
    { OIDC_ISSUER_URI: 'http://u:p@evil.invalid' },
    { OIDC_ISSUER_URI: 'http://127.0.0.1:8180/realms/autonexus?x=1' },
    { OIDC_AUDIENCE: 'autonexus-shell' },
    { WEB_ALLOWED_ORIGINS: '*' },
    { WEB_ALLOWED_ORIGINS: 'http://localhost:4200/' },
    { WEB_ALLOWED_ORIGINS: 'http://127.0.0.1:4200/path' },
  ])('rejects non-contract public configuration', (env) => {
    expect(() => authEnvironment(env)).toThrow('Invalid configuration');
  });

  it('allows an explicit subset of exact authorized origins', () => {
    expect(authEnvironment({ WEB_ALLOWED_ORIGINS: 'http://127.0.0.1:4201' }).origins)
      .toEqual(['http://127.0.0.1:4201']);
  });
});
