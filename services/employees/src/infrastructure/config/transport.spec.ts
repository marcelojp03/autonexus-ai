import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authEnvironment } from './auth-environment.js';
import { databaseEnvironment, httpEnvironment } from './environment.js';
describe('portable transport', () => {
  it('separates issuer and JWKS', () => {
    const config = authEnvironment({ OIDC_ISSUER_URI: 'https://workshop.test/identity/realms/autonexus', OIDC_JWKS_URI: 'http://keycloak:8080/certs', WEB_ALLOWED_ORIGINS: 'https://workshop.test' });
    expect(config.issuer).toBe('https://workshop.test/identity/realms/autonexus');
    expect(config).toHaveProperty('jwksUri', 'http://keycloak:8080/certs');
  });
  it('binds explicitly', () => {
    expect(httpEnvironment({ HTTP_HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
    expect(httpEnvironment({}).host).toBe('127.0.0.1');
  });
  it.each(['http://u:p@keycloak/certs', 'http://@keycloak/certs', 'http://keycloak/certs?x=1', 'http://keycloak/certs#x', 'file:///certs'])('rejects unsafe JWKS %s', (url) => {
    expect(() => authEnvironment({ OIDC_JWKS_URI: url })).toThrow('OIDC_JWKS_URI');
  });
  it('loads an optional CA without disabling certificate and hostname validation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'employees-ca-'));
    try {
      const path = join(directory, 'ca.pem');
      writeFileSync(path, 'synthetic-ca');
      expect(databaseEnvironment({ DB_PASSWORD: 'test', DB_SSLMODE: 'verify-full', DB_CA_FILE: path }).ssl).toEqual({ rejectUnauthorized: true, ca: 'synthetic-ca' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('requires verified TLS or explicit disable', () => {
    expect(databaseEnvironment({ DB_PASSWORD: 'test', DB_SSLMODE: 'verify-full' })).toHaveProperty('ssl', { rejectUnauthorized: true });
    expect(databaseEnvironment({ DB_PASSWORD: 'test', DB_SSLMODE: 'disable' })).toHaveProperty('ssl', false);
    expect(() => databaseEnvironment({ DB_PASSWORD: 'test', DB_SSLMODE: 'require' })).toThrow('DB_SSLMODE');
    expect(() => databaseEnvironment({ DB_PASSWORD: 'test', DB_SSLMODE: 'disable', DB_CA_FILE: 'unused' })).toThrow('DB_CA_FILE');
  });
});
