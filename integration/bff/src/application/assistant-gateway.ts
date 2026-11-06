import { BusinessError, isPublicBusinessCode } from './business-error.js';

/** One LLM turn plus its authorised tool calls: the slowest read in the platform. */
export const ASSISTANT_TIMEOUT_MS = 120_000;
/** A prompt, not a document: the BFF rejects anything longer before reaching the assistant. */
export const MAX_ASSISTANT_QUERY = 2000;
/** Only codes the assistant owner may publish leave this BFF. */
const PUBLIC_CODES = new Set(['VALIDATION_ERROR', 'SERVICE_UNAVAILABLE', 'PERSISTENCE_UNAVAILABLE']);

export interface AssistantGateway {
  ask(query: string, token: string): Promise<unknown>;
  report(from: string, to: string, token: string): Promise<unknown>;
}

/**
 * CU25/CU26 boundary. The human bearer token is forwarded unchanged: the assistant executes its
 * closed tool catalogue with that same token, so this BFF never mints an identity and never widens
 * authority. Responses are projected field by field; there is no financial field to project.
 */
export class HttpAssistantGateway implements AssistantGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly transport: typeof fetch = fetch,
    private readonly timeoutMs = ASSISTANT_TIMEOUT_MS,
  ) {}

  async ask(query: string, token: string): Promise<unknown> {
    if (typeof query !== 'string' || !query.trim() || query.length > MAX_ASSISTANT_QUERY) {
      throw new BusinessError(400, 'VALIDATION_ERROR');
    }
    return projectAnswer(await this.request('/assistant', { query }, token));
  }

  async report(from: string, to: string, token: string): Promise<unknown> {
    if (typeof from !== 'string' || typeof to !== 'string' || !from.trim() || !to.trim()) {
      throw new BusinessError(400, 'VALIDATION_ERROR');
    }
    return projectReport(await this.request('/report', { from, to }, token), from, to);
  }

  private async request(path: string, body: Readonly<Record<string, string>>, token: string): Promise<unknown> {
    const controller = new AbortController();
    // A timeout is not a confirmed rejection: both cases publish the same safe code.
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.transport(this.baseUrl + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    const payload = await this.payload(response);
    if (response.status === 200) return payload;
    if (response.status === 401) throw new BusinessError(401, 'UNAUTHENTICATED');
    if (response.status === 403) throw new BusinessError(403, 'FORBIDDEN');
    const published = payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string' ? payload.code : undefined;
    const code = published && PUBLIC_CODES.has(published) && isPublicBusinessCode(published) ? published : undefined;
    if (response.status === 400 || response.status === 422) throw new BusinessError(400, code ?? 'VALIDATION_ERROR');
    throw new BusinessError(503, code ?? 'SERVICE_UNAVAILABLE');
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

function invalid(): BusinessError {
  return new BusinessError(503, 'SERVICE_UNAVAILABLE');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid();
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function whole(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalid();
  return value;
}

function references(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const items: Array<Record<string, unknown>> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const reference = entry as Record<string, unknown>;
    const kind = optionalText(reference.kind);
    const id = optionalText(reference.id);
    if (!kind || !id) continue;
    items.push({ kind, id, label: optionalText(reference.label) });
  }
  return items;
}

function provenance(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const items: Array<Record<string, unknown>> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    const service = optionalText(source.service);
    const resource = optionalText(source.resource);
    if (!service || !resource) continue;
    items.push({ service, resource, tool: optionalText(source.tool), observedAt: optionalText(source.observedAt) });
  }
  return items;
}

function statusCounts(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid();
  return value.map(entry => {
    const row = record(entry);
    return { status: text(row.status), count: whole(row.count) };
  });
}

function workFigures(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid();
  return value.map(entry => {
    const work = record(entry);
    return {
      orderNumber: text(work.orderNumber),
      assignmentId: optionalText(work.assignmentId),
      executionStatus: text(work.executionStatus),
      advances: whole(work.advances),
      evidenceAvailable: whole(work.evidenceAvailable),
      evidencePending: whole(work.evidencePending),
      evidenceFailed: whole(work.evidenceFailed),
    };
  });
}

/**
 * Deterministic figures are never filled in by the BFF: a malformed figure fails closed instead of
 * publishing a zero the workshop would read as a real count.
 */
function projectAnswer(value: unknown): Record<string, unknown> {
  const body = record(value);
  return {
    answer: text(body.answer),
    refused: body.refused === true,
    toolsUsed: texts(body.toolsUsed),
    model: text(body.model),
    generatedAt: text(body.generatedAt),
    references: references(body.references),
    provenance: provenance(body.provenance),
    limitations: texts(body.limitations),
  };
}

function projectReport(value: unknown, from: string, to: string): Record<string, unknown> {
  const body = record(value);
  const period = record(body.period);
  // The period the owner computed must be the requested one, otherwise the figures belong elsewhere.
  if (period.from !== from || period.to !== to) throw invalid();
  const figures = record(body.figures);
  return {
    period: { from, to },
    generatedAt: text(body.generatedAt),
    model: text(body.model),
    narrative: text(body.narrative),
    figures: {
      byStatus: statusCounts(figures.byStatus),
      works: workFigures(figures.works),
      totalWorks: whole(figures.totalWorks),
    },
    references: references(body.references),
    provenance: provenance(body.provenance),
    limitations: texts(body.limitations),
  };
}
