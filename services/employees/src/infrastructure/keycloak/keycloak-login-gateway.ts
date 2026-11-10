import type { LoginGateway } from '../../application/configure-employee-login.js';
import { EmployeeError, type Employee } from '../../domain/employee.js';
import { identityEnvironment } from '../config/identity-environment.js';
import { adminClientCredentials } from './admin-credentials.js';

/** Administrative credential setup for an already owned, synchronized employee identity. */
export class KeycloakLoginGateway implements LoginGateway {
  constructor(private readonly transport: typeof fetch = fetch, private readonly config = identityEnvironment(),
    private readonly credentials = adminClientCredentials) {}

  private async request(url: string, init: RequestInit, allowed = [200, 204]): Promise<Response> {
    try {
      const response = await this.transport(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!allowed.includes(response.status)) {
        if (response.status === 409) throw new EmployeeError(409, 'USERNAME_TAKEN');
        if (response.status === 400) throw new EmployeeError(400, 'LOGIN_POLICY_REJECTED');
        throw new EmployeeError(503, 'LOGIN_PROVIDER_UNAVAILABLE');
      }
      return response;
    } catch (error) {
      if (error instanceof EmployeeError) throw error;
      throw new EmployeeError(503, 'LOGIN_PROVIDER_UNAVAILABLE');
    }
  }
  private async json(response: Response): Promise<any> {
    try { return await response.json(); } catch { throw new EmployeeError(503, 'LOGIN_PROVIDER_UNAVAILABLE'); }
  }
  async configure(employee: Employee, username: string, password: string): Promise<void> {
    let credentials: { clientId: string; clientSecret: string };
    try { credentials = this.credentials(); } catch { throw new EmployeeError(503, 'LOGIN_PROVIDER_UNAVAILABLE'); }
    const tokens = await this.json(await this.request(this.config.tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({grant_type: 'client_credentials', client_id: credentials.clientId, client_secret: credentials.clientSecret}),
    }));
    if (typeof tokens?.access_token !== 'string') throw new EmployeeError(503, 'LOGIN_PROVIDER_UNAVAILABLE');
    const headers = {Authorization: 'Bearer ' + tokens.access_token, 'Content-Type': 'application/json'};
    const users = this.config.adminBase + '/admin/realms/autonexus/users';
    const path = users + '/' + encodeURIComponent(employee.access.subject!);
    const user = await this.json(await this.request(path, {headers}));
    if (user?.id !== employee.access.subject || user?.attributes?.employeeId?.length !== 1 ||
      user.attributes.employeeId[0] !== employee.id || user.enabled !== true)
      throw new EmployeeError(409, 'LOGIN_IDENTITY_CONFLICT');
    const matches = await this.json(await this.request(users + '?exact=true&username=' + encodeURIComponent(username), {headers}));
    if (!Array.isArray(matches)) throw new EmployeeError(503, 'LOGIN_PROVIDER_UNAVAILABLE');
    if (matches.some((match: {id: string}) => match.id !== user.id)) throw new EmployeeError(409, 'USERNAME_TAKEN');
    if (user.username !== username) {
      await this.request(path, {method: 'PUT', headers, body: JSON.stringify({username})});
    }
    const confirmed = await this.json(await this.request(path, {headers}));
    if (confirmed?.username !== username || confirmed?.id !== user.id || confirmed?.enabled !== true ||
      confirmed?.attributes?.employeeId?.[0] !== employee.id) throw new EmployeeError(409, 'LOGIN_IDENTITY_CONFLICT');
    await this.request(path + '/reset-password', {method: 'PUT', headers,
      body: JSON.stringify({type: 'password', value: password, temporary: false})});
  }
}
