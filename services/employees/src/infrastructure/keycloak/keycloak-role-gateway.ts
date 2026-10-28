import { RoleSyncError, type RoleGateway } from '../../application/role-gateway.js';
import type { Permission } from '../../domain/permissions.js';
import { adminClientCredentials } from './admin-credentials.js';

const BASE = 'http://127.0.0.1:8180';
const REALM = '/admin/realms/autonexus';

/** Keycloak realm-role adapter. Only role endpoints are called, never other realm administration. */
export class KeycloakRoleGateway implements RoleGateway {
  constructor(private readonly transport: typeof fetch = fetch) {}

  private async request(path: string, options: RequestInit = {}, allowed = [200, 201, 204]): Promise<Response> {
    try {
      const response = await this.transport(BASE + path, {
        ...options,
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!allowed.includes(response.status)) {
        throw new RoleSyncError(response.status === 401 || response.status === 403 ? 'IDP_FORBIDDEN' : 'IDP_UNAVAILABLE');
      }
      return response;
    } catch (error) {
      if (error instanceof RoleSyncError) throw error;
      throw new RoleSyncError(
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'IDP_TIMEOUT' : 'IDP_UNAVAILABLE',
      );
    }
  }

  private async json(response: Response): Promise<unknown> {
    try { return await response.json(); } catch { throw new RoleSyncError('IDP_RESPONSE_INVALID'); }
  }

  private async headers(): Promise<Record<string, string>> {
    let credentials;
    try { credentials = adminClientCredentials(); } catch { throw new RoleSyncError('IDP_UNAVAILABLE'); }
    const response = await this.request('/realms/autonexus/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
    });
    const tokens = (await this.json(response)) as { access_token?: unknown };
    if (typeof tokens.access_token !== 'string') throw new RoleSyncError('IDP_RESPONSE_INVALID');
    return { Authorization: 'Bearer ' + tokens.access_token, 'Content-Type': 'application/json' };
  }

  async upsertRole(name: string, description: string, permissions: readonly Permission[]): Promise<void> {
    const headers = await this.headers();
    const body = JSON.stringify({ name, description, attributes: { permissions: [JSON.stringify(permissions)] } });
    const current = await this.request(`${REALM}/roles/${encodeURIComponent(name)}`, { headers }, [200, 404]);
    if (current.status === 404) {
      const created = await this.request(`${REALM}/roles`, { method: 'POST', headers, body }, [201, 409]);
      if (created.status === 409) throw new RoleSyncError('ROLE_NAME_CONFLICT');
      return;
    }
    const profile = (await this.json(current)) as { name?: unknown };
    if (profile.name !== name) throw new RoleSyncError('ROLE_NAME_CONFLICT');
    await this.request(`${REALM}/roles/${encodeURIComponent(name)}`, { method: 'PUT', headers, body }, [200, 204]);
  }

  private async role(headers: Record<string, string>, roleName: string): Promise<{ id: string; name: string }> {
    const response = await this.request(`${REALM}/roles/${encodeURIComponent(roleName)}`, { headers }, [200, 404]);
    if (response.status === 404) throw new RoleSyncError('ROLE_NAME_CONFLICT');
    const role = (await this.json(response)) as { id?: unknown; name?: unknown };
    if (typeof role.id !== 'string' || role.name !== roleName) throw new RoleSyncError('IDP_RESPONSE_INVALID');
    return { id: role.id, name: roleName };
  }

  /** Verifies ownership through the managed employeeId attribute before touching mappings. */
  private async verifySubject(headers: Record<string, string>, employeeId: string, subject: string): Promise<void> {
    const response = await this.request(`${REALM}/users/${encodeURIComponent(subject)}`, { headers }, [200, 404]);
    if (response.status === 404) throw new RoleSyncError('IDP_RESPONSE_INVALID');
    const user = (await this.json(response)) as { id?: unknown; attributes?: { employeeId?: unknown } };
    const attribute = user.attributes?.employeeId;
    if (user.id !== subject || !Array.isArray(attribute) || attribute[0] !== employeeId) throw new RoleSyncError('IDP_FORBIDDEN');
  }

  async assignRole(employeeId: string, subject: string, roleName: string): Promise<void> {
    const headers = await this.headers();
    await this.verifySubject(headers, employeeId, subject);
    const role = await this.role(headers, roleName);
    const path = `${REALM}/users/${encodeURIComponent(subject)}/role-mappings/realm`;
    const current = (await this.json(await this.request(path, { headers }))) as unknown;
    if (!Array.isArray(current)) throw new RoleSyncError('IDP_RESPONSE_INVALID');
    if (current.some(item => (item as { id?: unknown }).id === role.id)) return;
    await this.request(path, { method: 'POST', headers, body: JSON.stringify([{ id: role.id, name: role.name }]) });
  }

  async revokeRole(employeeId: string, subject: string, roleName: string): Promise<void> {
    const headers = await this.headers();
    await this.verifySubject(headers, employeeId, subject);
    const existing = await this.request(`${REALM}/roles/${encodeURIComponent(roleName)}`, { headers }, [200, 404]);
    if (existing.status === 404) return;
    const role = (await this.json(existing)) as { id?: unknown };
    if (typeof role.id !== 'string') throw new RoleSyncError('IDP_RESPONSE_INVALID');
    await this.request(`${REALM}/users/${encodeURIComponent(subject)}/role-mappings/realm`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify([{ id: role.id, name: roleName }]),
    });
  }
}
