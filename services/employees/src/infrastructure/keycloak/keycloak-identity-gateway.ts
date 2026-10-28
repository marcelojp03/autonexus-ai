import { adminClientCredentials } from './admin-credentials.js';
import {
  IdentitySyncError,
  type IdentityDesired,
  type IdentityGateway,
} from '../../application/identity-gateway.js';
const base = 'http://127.0.0.1:8180';
interface IdpUser {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  enabled: boolean;
  attributes?: Record<string, string[]>;
}
export class KeycloakIdentityGateway implements IdentityGateway {
  constructor(private readonly transport: typeof fetch = fetch) {}
  private async request(
    path: string,
    options: RequestInit = {},
    allowed = [200, 201, 204],
  ): Promise<Response> {
    try {
      const response = await this.transport(base + path, {
        ...options,
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!allowed.includes(response.status))
        throw new IdentitySyncError(
          response.status === 401 || response.status === 403
            ? 'IDP_FORBIDDEN'
            : 'IDP_UNAVAILABLE',
        );
      return response;
    } catch (error) {
      if (error instanceof IdentitySyncError) throw error;
      throw new IdentitySyncError(
        error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'IDP_TIMEOUT'
          : 'IDP_UNAVAILABLE',
      );
    }
  }
  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new IdentitySyncError('IDP_RESPONSE_INVALID');
    }
  }
  private credentials(): { clientId: string; clientSecret: string } {
    try {
      return adminClientCredentials();
    } catch {
      throw new IdentitySyncError('IDP_UNAVAILABLE');
    }
  }
  async sync(desired: IdentityDesired): Promise<string> {
    const credentials = this.credentials();
    const tokenResponse = await this.request(
      '/realms/autonexus/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }),
      },
    );
    const tokens = (await this.json(tokenResponse)) as {
      access_token?: unknown;
    };
    if (!tokens || typeof tokens.access_token !== 'string')
      throw new IdentitySyncError('IDP_RESPONSE_INVALID');
    const headers = {
      Authorization: 'Bearer ' + tokens.access_token,
      'Content-Type': 'application/json',
    };
    const username = 'employee-' + desired.employeeId;
    const users = '/admin/realms/autonexus/users';
    const lookup = async (): Promise<IdpUser | null> => {
      const data = await this.json(
        await this.request(
          users + '?exact=true&username=' + encodeURIComponent(username),
          { headers },
        ),
      );
      if (!Array.isArray(data) || data.length > 1)
        throw new IdentitySyncError('IDP_RESPONSE_INVALID');
      return (data[0] as IdpUser) ?? null;
    };
    const verify = (user: IdpUser | null): IdpUser => {
      if (
        !user ||
        typeof user.id !== 'string' ||
        user.username !== username ||
        user.attributes?.employeeId?.length !== 1 ||
        user.attributes.employeeId[0] !== desired.employeeId ||
        (desired.subject !== null && user.id !== desired.subject)
      )
        throw new IdentitySyncError('IDP_OWNERSHIP_CONFLICT', true);
      return user;
    };
    let user: IdpUser | null;
    if (desired.subject !== null) {
      const response = await this.request(
        users + '/' + encodeURIComponent(desired.subject),
        { headers },
        [200, 404],
      );
      if (response.status === 404)
        throw new IdentitySyncError('IDP_OWNERSHIP_CONFLICT', true);
      user = verify((await this.json(response)) as IdpUser);
    } else {
      user = await lookup();
      if (!user) {
        const created = await this.request(
          users,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              username,
              firstName: desired.firstName,
              lastName: desired.lastName,
              email: desired.email,
              enabled: desired.enabled,
              emailVerified: false,
              attributes: { employeeId: [desired.employeeId] },
            }),
          },
          [201, 409],
        );
        user = await lookup();
        if (created.status === 409 && !user)
          throw new IdentitySyncError('IDP_OWNERSHIP_CONFLICT', true);
      }
      user = verify(user);
    }
    if (desired.enabled && !user.enabled)
      throw new IdentitySyncError('IDP_ACCOUNT_DISABLED');
    await this.request(users + '/' + encodeURIComponent(user.id), {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        firstName: desired.firstName,
        lastName: desired.lastName,
        email: desired.email,
        ...(desired.enabled ? {} : { enabled: false }),
        attributes: { ...user.attributes, employeeId: [desired.employeeId] },
      }),
    });
    const confirmed = verify(
      (await this.json(
        await this.request(users + '/' + encodeURIComponent(user.id), {
          headers,
        }),
      )) as IdpUser,
    );
    if (desired.enabled && !confirmed.enabled)
      throw new IdentitySyncError('IDP_ACCOUNT_DISABLED');
    if (
      confirmed.firstName !== desired.firstName ||
      confirmed.lastName !== desired.lastName ||
      confirmed.email !== desired.email ||
      confirmed.enabled !== desired.enabled
    )
      throw new IdentitySyncError('IDP_RESPONSE_INVALID');
    return confirmed.id;
  }
}
