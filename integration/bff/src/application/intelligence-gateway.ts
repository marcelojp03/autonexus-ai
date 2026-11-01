import { BusinessError } from './business-error.js';

/** Only codes published by the CU23 contract may leave this BFF. */
const PUBLIC_CODES = new Set([
  'MODEL_NOT_READY',
  'IMAGE_INVALID',
  'IMAGE_TOO_LARGE',
  'EVIDENCE_NOT_AVAILABLE',
  'ASSIGNMENT_NOT_FOUND',
  'ANALYSIS_NOT_FOUND',
  'VALIDATION_ERROR',
  'PERSISTENCE_UNAVAILABLE',
]);

export interface IntelligenceGateway {
  model(token: string): Promise<unknown>;
  analyze(assignmentId: string, evidenceId: string, token: string): Promise<unknown>;
  analysis(analysisId: string, token: string): Promise<unknown>;
  assignment(assignmentId: string, token: string): Promise<unknown>;
  order(orderId: string, assignmentId: string, token: string): Promise<unknown>;
}

export class HttpIntelligenceGateway implements IntelligenceGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async model(token: string): Promise<unknown> {
    // The owner publishes the model status inside a richer self-diagnostic body; the contract
    // field is the status itself.
    const body = (await this.request('/vision/model', token)) as { model?: unknown } | null;
    return body?.model ?? body;
  }

  analyze(assignmentId: string, evidenceId: string, token: string): Promise<unknown> {
    // Inference plus an authorised evidence download: the longest read in the platform.
    return this.request('/vision/analyze', token, { method: 'POST', body: JSON.stringify({ assignmentId, evidenceId }) }, [200], 20000);
  }

  analysis(analysisId: string, token: string): Promise<unknown> {
    return this.request('/vision/analyses/' + encodeURIComponent(analysisId), token);
  }

  assignment(assignmentId: string, token: string): Promise<unknown> {
    return this.request('/vision/assignments/' + encodeURIComponent(assignmentId), token);
  }

  order(orderId: string, assignmentId: string, token: string): Promise<unknown> {
    return this.request(
      '/vision/orders/' + encodeURIComponent(orderId) + '?assignmentId=' + encodeURIComponent(assignmentId),
      token,
    );
  }

  private async request(path: string, token: string, init: RequestInit = {}, allowed = [200], timeoutMs = 10000): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(this.baseUrl + path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    }
    const body = await this.payload(response);
    if (allowed.includes(response.status)) return body;
    if (response.status === 401) throw new BusinessError(401, 'UNAUTHENTICATED');
    if (response.status === 403) throw new BusinessError(403, 'FORBIDDEN');
    const candidate = body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
    const code = candidate && PUBLIC_CODES.has(candidate) ? candidate : undefined;
    if (response.status === 503) throw new BusinessError(503, code ?? 'SERVICE_UNAVAILABLE');
    if (response.status === 413) throw new BusinessError(400, code ?? 'IMAGE_TOO_LARGE');
    const statusCode = response.status === 400 || response.status === 404 || response.status === 409 ? response.status : 503;
    throw new BusinessError(
      statusCode,
      code ?? (statusCode === 404 ? 'ANALYSIS_NOT_FOUND' : statusCode === 409 ? 'EVIDENCE_NOT_AVAILABLE' : statusCode === 400 ? 'VALIDATION_ERROR' : 'SERVICE_UNAVAILABLE'),
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
}
