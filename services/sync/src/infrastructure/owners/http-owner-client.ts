/** HTTP adapter: each entity is forwarded to its owner with the user's token. */

import type { StoredOperation } from '../../domain/overlay.js';
import type { OwnerClient, OwnerResult } from '../../application/ports.js';

export interface OwnerEndpoints {
  readonly operationsUrl: string;
  readonly intelligenceUrl: string;
}

/** Removes short-lived signed URLs before anything is persisted. */
export function sanitize(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const clone = structuredClone(body) as Record<string, unknown>;
  const upload = clone['upload'];
  if (upload && typeof upload === 'object') {
    const record = upload as Record<string, unknown>;
    if ('url' in record) record['url'] = '[redacted]';
  }
  for (const key of ['url', 'presignedUrl', 'downloadUrl']) if (key in clone) clone[key] = '[redacted]';
  return clone;
}

export class HttpOwnerClient implements OwnerClient {
  constructor(
    private readonly endpoints: OwnerEndpoints,
    private readonly transport: typeof fetch = fetch,
    private readonly timeoutMs = 10000,
  ) {}

  async apply(operation: StoredOperation, token: string): Promise<OwnerResult> {
    const { path, base } = this.route(operation);
    let response: Response;
    try {
      response = await this.transport(base + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(operation.payload),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // A transport failure is not a rejection: the owner may have applied the change, so the
      // operation stays pending and a replay with the same operationId is safe.
      return { status: 503, code: 'SERVICE_UNAVAILABLE', body: { cause: String((error as Error).message).slice(0, 80) } };
    }
    const body = await this.payload(response);
    const code = typeof (body as { code?: unknown })?.code === 'string' ? String((body as { code: string }).code) : `HTTP_${response.status}`;
    return { status: response.status, code, body };
  }

  private route(operation: StoredOperation): { base: string; path: string } {
    const assignmentId = encodeURIComponent(operation.target.assignmentId);
    switch (operation.entity) {
      case 'advance':
        return { base: this.endpoints.operationsUrl, path: `/executions/${assignmentId}/advances` };
      case 'evidence-authorize': {
        const advanceId = encodeURIComponent(operation.target.advanceId ?? '');
        return { base: this.endpoints.operationsUrl, path: `/executions/${assignmentId}/advances/${advanceId}/evidences` };
      }
      case 'evidence-confirm': {
        const evidenceId = encodeURIComponent(operation.target.evidenceId ?? '');
        return { base: this.endpoints.operationsUrl, path: `/executions/${assignmentId}/evidences/${evidenceId}/confirm` };
      }
      case 'client-inference':
        return { base: this.endpoints.intelligenceUrl, path: '/vision/client-analyses' };
      default:
        throw new Error('unpublished entity: ' + String(operation.entity));
    }
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
