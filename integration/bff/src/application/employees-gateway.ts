import { BusinessError } from './business-error.js';

/** Only codes published by the CU03 contract may leave this BFF. */
const PUBLIC_CODES = new Set([
  'VALIDATION_ERROR',
  'EMPLOYEE_NOT_FOUND',
  'DUPLICATE_DOCUMENT',
  'DUPLICATE_EMAIL',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'SELF_DEACTIVATION_FORBIDDEN',
  'ACCESS_REQUEST_CANNOT_BE_REVOKED',
  'ACCESS_NOT_REQUESTED',
  'PERSISTENCE_UNAVAILABLE',
]);

export interface EmployeePageQuery {
  limit?: number;
  offset?: number;
  status?: string;
  search?: string;
}
export interface CommandInput {
  operationId: string;
  expectedVersion?: number;
  [field: string]: unknown;
}

/** Port to the Employees owner REST API. Never crosses into its database. */
export interface EmployeesGateway {
  list(query: EmployeePageQuery, token: string): Promise<unknown>;
  get(id: string, token: string): Promise<unknown>;
  history(id: string, query: { limit?: number; offset?: number }, token: string): Promise<unknown>;
  create(input: CommandInput, token: string): Promise<unknown>;
  update(id: string, input: CommandInput, token: string): Promise<unknown>;
  deactivate(id: string, input: CommandInput, token: string): Promise<unknown>;
  retryAccess(id: string, input: CommandInput, token: string): Promise<unknown>;
  reachable(): Promise<boolean>;
}

export class HttpEmployeesGateway implements EmployeesGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  private async request(path: string, token: string, init: RequestInit = {}, allowed = [200, 201]): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(this.baseUrl + path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    }
    const body = await this.payload(response);
    if (allowed.includes(response.status)) return body;
    if (response.status === 401) throw new BusinessError(401, 'UNAUTHENTICATED');
    if (response.status === 403) throw new BusinessError(403, 'FORBIDDEN');
    if (response.status === 503) throw new BusinessError(503, 'PERSISTENCE_UNAVAILABLE');
    const candidate = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    const code = candidate && PUBLIC_CODES.has(candidate) ? candidate : undefined;
    const statusCode = response.status === 400 || response.status === 404 || response.status === 409 ? response.status : 503;
    throw new BusinessError(statusCode, code ?? (statusCode === 404 ? 'EMPLOYEE_NOT_FOUND' : statusCode === 409 ? 'VERSION_CONFLICT' : statusCode === 400 ? 'VALIDATION_ERROR' : 'SERVICE_UNAVAILABLE'));
  }

  private async payload(response: Response): Promise<unknown> {
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  list(query: EmployeePageQuery, token: string): Promise<unknown> {
    const parameters = new URLSearchParams();
    for (const key of ['limit', 'offset', 'status', 'search'] as const) {
      const value = query[key];
      if (value !== undefined && value !== null) parameters.set(key, String(value));
    }
    const suffix = parameters.toString();
    return this.request(`/employees${suffix ? `?${suffix}` : ''}`, token);
  }

  get(id: string, token: string): Promise<unknown> {
    return this.request(`/employees/${encodeURIComponent(id)}`, token);
  }

  history(id: string, query: { limit?: number; offset?: number }, token: string): Promise<unknown> {
    const parameters = new URLSearchParams();
    if (query.limit !== undefined && query.limit !== null) parameters.set('limit', String(query.limit));
    if (query.offset !== undefined && query.offset !== null) parameters.set('offset', String(query.offset));
    const suffix = parameters.toString();
    return this.request(`/employees/${encodeURIComponent(id)}/history${suffix ? `?${suffix}` : ''}`, token);
  }

  create(input: CommandInput, token: string): Promise<unknown> {
    return this.request('/employees', token, { method: 'POST', body: JSON.stringify(input) }, [201]);
  }

  update(id: string, input: CommandInput, token: string): Promise<unknown> {
    return this.request(`/employees/${encodeURIComponent(id)}`, token, { method: 'PUT', body: JSON.stringify(input) });
  }

  deactivate(id: string, input: CommandInput, token: string): Promise<unknown> {
    return this.request(`/employees/${encodeURIComponent(id)}/deactivate`, token, { method: 'POST', body: JSON.stringify(input) });
  }

  retryAccess(id: string, input: CommandInput, token: string): Promise<unknown> {
    return this.request(`/employees/${encodeURIComponent(id)}/access/retry`, token, { method: 'POST', body: JSON.stringify(input) });
  }

  async reachable(): Promise<boolean> {
    try {
      const response = await this.transport(`${this.baseUrl}/health/live`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}