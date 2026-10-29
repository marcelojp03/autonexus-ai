vi.mock('../keycloak/admin-credentials.js', () => ({ adminClientCredentials: () => ({ clientId: 'autonexus-employees-admin', clientSecret: 'synthetic-test-only' }) }));
import { identityEnvironment } from './identity-environment.js';
import { KeycloakRoleGateway } from '../keycloak/keycloak-role-gateway.js';
import { KeycloakIdentityGateway } from '../keycloak/keycloak-identity-gateway.js';

describe('trusted IdP administration transport', () => {
  it('separates the administrative base, token URL and public issuer', () => {
    expect(identityEnvironment({ OIDC_ADMIN_BASE_URL: 'http://keycloak:8080/identity', OIDC_TOKEN_URL: 'http://keycloak:8080/identity/realms/autonexus/protocol/openid-connect/token', OIDC_ISSUER_URI: 'https://workshop.test/identity/realms/autonexus' })).toEqual({ adminBase: 'http://keycloak:8080/identity', tokenUrl: 'http://keycloak:8080/identity/realms/autonexus/protocol/openid-connect/token' });
  });
  it('sends credentials only to the configured token URL and roles to the internal admin base', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'synthetic-token' })))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }));
    const config = identityEnvironment({ OIDC_ADMIN_BASE_URL: 'http://keycloak:8080/identity', OIDC_TOKEN_URL: 'http://keycloak:8080/identity/realms/autonexus/protocol/openid-connect/token' });
    await new KeycloakRoleGateway(transport, config).upsertRole('synthetic_role', 'Synthetic', []);
    expect(transport.mock.calls.map(call => call[0])).toEqual([config.tokenUrl, config.adminBase + '/admin/realms/autonexus/roles/synthetic_role', config.adminBase + '/admin/realms/autonexus/roles']);
  });
  it.each(['http://u:p@keycloak', 'http://keycloak?x=1', 'http://keycloak#x', 'file:///keycloak'])('rejects unsafe endpoint %s at construction', (url) => {
    expect(() => identityEnvironment({ OIDC_TOKEN_URL: url })).toThrow('OIDC_TOKEN_URL');
    expect(() => new KeycloakRoleGateway(fetch, identityEnvironment({ OIDC_ADMIN_BASE_URL: url }))).toThrow('OIDC_ADMIN_BASE_URL');
    expect(() => new KeycloakIdentityGateway(fetch, identityEnvironment({ OIDC_ADMIN_BASE_URL: url }))).toThrow('OIDC_ADMIN_BASE_URL');
  });
});
