/** PWA bridge to the MS05 coordinator. The human bearer is forwarded and never retained. */

import { BusinessError } from './business-error.js';

const PUBLIC_CODES = new Set([
  'OVERLAY_NOT_FOUND',
  'OPERATION_NOT_FOUND',
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'SERVICE_UNAVAILABLE',
  'PERSISTENCE_UNAVAILABLE',
  'IDEMPOTENCY_CONFLICT',
  'VERSION_CONFLICT',
]);

export interface RegisterSyncInput {
  readonly overlayId: string;
  readonly deviceId: string;
  readonly createdAt: string;
  readonly operationsJson: string;
}

export interface OfflineSyncOperation {
  readonly operationId: string;
  readonly overlayId: string;
  readonly entity: string;
  readonly state: string;
  readonly attemptCount: number;
  readonly lastStatus: number | null;
  readonly lastCode: string | null;
  readonly resultJson: string | null;
}

export interface SyncGateway {
  overlay(overlayId: string, token: string): Promise<unknown>;
  operation(operationId: string, token: string): Promise<unknown>;
  register(input: RegisterSyncInput, token: string): Promise<unknown>;
  push(overlayId: string, token: string): Promise<unknown>;
}

export class HttpSyncGateway implements SyncGateway {
  constructor(private readonly baseUrl: string, private readonly transport: typeof fetch = fetch) {}

  async overlay(overlayId: string, token: string): Promise<unknown> {
    this.id(overlayId);
    const body = this.record(await this.request('/sync/overlays/' + encodeURIComponent(overlayId), token));
    const overlay = this.record(body['overlay']);
    return {
      overlayId: overlay['overlayId'],
      deviceId: overlay['deviceId'],
      createdAt: overlay['createdAt'],
      operations: this.operations(overlay['operations']),
    };
  }

  async operation(operationId: string, token: string): Promise<unknown> {
    this.id(operationId);
    const body = this.record(await this.request('/sync/operations/' + encodeURIComponent(operationId), token));
    const operation = this.record(body['operation']);
    return { overlayId: operation['overlayId'], operation: this.operationView(operation) };
  }

  async register(input: RegisterSyncInput, token: string): Promise<unknown> {
    if (typeof input.operationsJson !== 'string' || input.operationsJson.length > 60000) throw new BusinessError(400, 'VALIDATION_ERROR');
    let operations: unknown;
    try { operations = JSON.parse(input.operationsJson); } catch { throw new BusinessError(400, 'VALIDATION_ERROR'); }
    if (!Array.isArray(operations) || operations.length === 0 || operations.length > 50) throw new BusinessError(400, 'VALIDATION_ERROR');

    const body = this.record(await this.request('/sync/overlays', token, {
      method: 'POST',
      body: JSON.stringify({
        overlayId: input.overlayId,
        deviceId: input.deviceId,
        createdAt: input.createdAt,
        operations,
      }),
    }, [200, 201]));
    const overlay = this.record(body['overlay']);
    return {
      overlay: {
        overlayId: overlay['overlayId'],
        deviceId: overlay['deviceId'],
        createdAt: overlay['createdAt'],
        operations: this.operations(overlay['operations']),
      },
      replayed: body['replayed'] === true,
      replayedOperations: Array.isArray(body['replayedOperations']) ? body['replayedOperations'] : [],
    };
  }

  async push(overlayId: string, token: string): Promise<unknown> {
    this.id(overlayId);
    const body = this.record(await this.request('/sync/overlays/' + encodeURIComponent(overlayId) + '/push', token, { method: 'POST' }, [200]));
    const results = Array.isArray(body['results']) ? body['results'] : [];
    const failures = Array.isArray(body['failed']) ? body['failed'] : [];
    return {
      overlayId: body['overlayId'] ?? overlayId,
      operations: this.operations(body['operations']),
      applied: Array.isArray(body['applied']) ? body['applied'] : [],
      pending: Array.isArray(body['pending']) ? body['pending'] : [],
      failed: failures.map(value => {
        const item = this.record(value);
        return { operationId: item['operationId'], state: item['state'], status: item['status'] ?? 0, code: item['code'] ?? '' };
      }),
      // Keep this response ephemeral: a successful evidence-authorize result may carry a presigned URL.
      resultsJson: JSON.stringify(results),
    };
  }

  private operations(value: unknown): OfflineSyncOperation[] {
    if (!Array.isArray(value)) return [];
    return value.map(item => this.operationView(this.record(item)));
  }

  private operationView(item: Record<string, unknown>): OfflineSyncOperation {
    const result = item['lastResult'] && typeof item['lastResult'] === 'object' ? item['lastResult'] as Record<string, unknown> : {};
    return {
      operationId: String(item['operationId'] ?? ''),
      overlayId: String(item['overlayId'] ?? ''),
      entity: String(item['entity'] ?? ''),
      state: String(item['state'] ?? 'pending'),
      attemptCount: Array.isArray(item['attempts']) ? item['attempts'].length : 0,
      lastStatus: typeof result['status'] === 'number' ? result['status'] : null,
      lastCode: typeof result['code'] === 'string' ? result['code'] : null,
      resultJson: item['lastBody'] == null ? null : JSON.stringify(this.sanitize(item['lastBody'])),
    };
  }

  private id(value: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BusinessError(400, 'VALIDATION_ERROR');
  }

  private sanitize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(item => this.sanitize(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, /^(url|presignedUrl|downloadUrl|uploadUrl)$/i.test(key) ? '[redacted]' : this.sanitize(item),
    ]));
  }

  private async request(path: string, token: string, init: RequestInit = {}, allowed = [200]): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(this.baseUrl + path, {
        ...init,
        headers: { Authorization: 'Bearer ' + token, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
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
    const status = response.status === 400 || response.status === 404 || response.status === 409 ? response.status : 503;
    throw new BusinessError(status, code ?? (status === 400 ? 'VALIDATION_ERROR' : status === 404 ? 'OVERLAY_NOT_FOUND' : status === 409 ? 'VERSION_CONFLICT' : 'SERVICE_UNAVAILABLE'));
  }

  private async payload(response: Response): Promise<unknown> {
    if (response.status === 204) return null;
    try { return await response.json(); } catch { return null; }
  }

  private record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    return value as Record<string, unknown>;
  }
}
