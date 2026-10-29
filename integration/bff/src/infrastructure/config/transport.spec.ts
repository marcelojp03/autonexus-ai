import { bffEnvironment } from './environment.js';

describe('portable BFF configuration', () => {
  it('uses trusted DNS endpoints, bind and exact issuer independent of JWKS', () => {
    const config = bffEnvironment({ HTTP_HOST: '0.0.0.0', EMPLOYEES_API_URL: 'http://employees:3002', OPERATIONS_API_URL: 'http://operations:8081', FINANCE_API_URL: 'https://finance', OIDC_ISSUER_URI: 'https://workshop.test/identity/realms/autonexus', OIDC_JWKS_URI: 'http://keycloak:8080/certs', WEB_ALLOWED_ORIGINS: 'https://workshop.test' });
    expect(config.host).toBe('0.0.0.0');
    expect(config.employeesUrl).toBe('http://employees:3002');
    expect(config.jwksUri).toBe('http://keycloak:8080/certs');
    expect(config.issuer).toBe('https://workshop.test/identity/realms/autonexus');
  });
  it.each(['http://u:p@employees', 'http://employees?x=1', 'http://employees#x', 'ftp://employees', 'http://employees?', 'http://employees#'])('rejects unsafe dependency %s', (url) => {
    expect(() => bffEnvironment({ EMPLOYEES_API_URL: url })).toThrow('EMPLOYEES_API_URL');
  });
  it.each(['*', 'https://workshop.test/path', 'https://u:p@workshop.test', 'https://workshop.test?x=1'])('rejects non-origin %s', (origin) => {
    expect(() => bffEnvironment({ WEB_ALLOWED_ORIGINS: origin })).toThrow('WEB_ALLOWED_ORIGINS');
  });
});
