import { BusinessError } from './business-error.js';

/** Only codes published by the finance contract may leave this BFF. */
const PUBLIC_CODES = new Set([
  'VALIDATION_ERROR',
  'QUOTE_NOT_FOUND',
  'QUOTE_ITEMS_INVALID',
  'DISCOUNT_NOT_AUTHORIZED',
  'TAX_INVALID',
  'QUOTE_TOTAL_MISMATCH',
  'QUOTE_ALREADY_DECIDED',
  'QUOTE_EXPIRED',
  'QUOTE_APPROVED_IMMUTABLE',
  'QUOTE_NOT_PENDING',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'PERSISTENCE_UNAVAILABLE',
]);

export interface QuoteQuery {
  limit?: number;
  offset?: number;
  orderReference?: string;
  status?: string;
}
export interface QuoteCommand {
  operationId: string;
  expectedVersion?: number;
  [field: string]: unknown;
}

/** Port to the Finanzas owner REST API. Never crosses into its database. */
export interface FinanceGateway {
  quotes(query: QuoteQuery, token: string): Promise<unknown>;
  quote(id: string, token: string): Promise<unknown>;
  createQuote(input: QuoteCommand, token: string): Promise<unknown>;
  reviseQuote(id: string, input: QuoteCommand, token: string): Promise<unknown>;
  decideQuote(id: string, input: QuoteCommand, token: string): Promise<unknown>;
}

export class HttpFinanceGateway implements FinanceGateway {
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
    throw new BusinessError(
      statusCode,
      code ?? (statusCode === 404 ? 'QUOTE_NOT_FOUND' : statusCode === 409 ? 'VERSION_CONFLICT' : statusCode === 400 ? 'VALIDATION_ERROR' : 'SERVICE_UNAVAILABLE'),
    );
  }

  private async payload(response: Response): Promise<unknown> {
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  quotes(query: QuoteQuery, token: string): Promise<unknown> {
    const parameters = new URLSearchParams();
    for (const key of ['limit', 'offset', 'orderReference', 'status'] as const) {
      const value = query[key];
      if (value !== undefined && value !== null) parameters.set(key, String(value));
    }
    const suffix = parameters.toString();
    return this.request(`/quotes${suffix ? `?${suffix}` : ''}`, token);
  }

  quote(id: string, token: string): Promise<unknown> {
    return this.request(`/quotes/${encodeURIComponent(id)}`, token);
  }

  createQuote(input: QuoteCommand, token: string): Promise<unknown> {
    return this.request('/quotes', token, { method: 'POST', body: JSON.stringify(input) }, [201]);
  }

  reviseQuote(id: string, input: QuoteCommand, token: string): Promise<unknown> {
    return this.request(`/quotes/${encodeURIComponent(id)}/revisions`, token, { method: 'POST', body: JSON.stringify(input) });
  }

  decideQuote(id: string, input: QuoteCommand, token: string): Promise<unknown> {
    return this.request(`/quotes/${encodeURIComponent(id)}/decision`, token, { method: 'POST', body: JSON.stringify(input) });
  }
}
