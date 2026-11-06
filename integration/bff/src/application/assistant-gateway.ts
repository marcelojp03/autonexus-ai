import { BusinessError, isPublicBusinessCode } from './business-error.js';

/** One LLM turn plus its authorised tool calls: the slowest read in the platform. */
export const ASSISTANT_TIMEOUT_MS = 120_000;
/**
 * Creating a report job and reading its state are short by design: the generation happens in the
 * background, so the browser never waits minutes on a single request. A polling read that takes
 * longer than this is a service problem, not a slow report.
 */
export const REPORT_JOB_TIMEOUT_MS = 15_000;
/** A prompt, not a document: the BFF rejects anything longer before reaching the assistant. */
export const MAX_ASSISTANT_QUERY = 2000;
/** Only codes the assistant owner may publish leave this BFF. */
const PUBLIC_CODES = new Set(['VALIDATION_ERROR', 'SERVICE_UNAVAILABLE', 'PERSISTENCE_UNAVAILABLE']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Codes a finished job may publish, each with the message this BFF writes for it. The owner's own text
 * is never forwarded: it could carry figures or identifiers the reader is not authorised to see.
 */
export const REPORT_FAILURE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  AUTHORIZATION_EXPIRED: 'La autorización venció durante la generación: se requiere una sesión vigente para volver a generar el reporte.',
  FORBIDDEN: 'La cuenta no conserva el permiso necesario para completar el reporte.',
  INTERRUPTED_BY_RESTART: 'El servicio se reinició durante la generación del reporte; el trabajo no puede reanudarse.',
  QUEUE_FULL: 'Hay reportes pendientes en el servicio: vuelva a intentarlo en unos minutos.',
  INVALID_PERIOD: 'El período solicitado no es válido para el propietario.',
  AGENDA_UNAVAILABLE: 'La agenda autorizada no respondió durante la generación del reporte.',
  AGENDA_INCOMPLETE: 'La agenda devolvió menos trabajos de los que informó: no se publica un total parcial.',
  FIGURE_RANGE_EXCEEDED: 'El período tiene más trabajos de los que el reporte puede detallar.',
  INCOHERENT_FIGURES: 'Las cifras del reporte no son coherentes entre sí; no se publica un total que el documento contradiga.',
  INTERNAL_ERROR: 'La generación del reporte no se completó.',
});

/** Service status → published enum. An unknown status is not published as if it were known. */
const JOB_STATUS: Readonly<Record<string, string>> = Object.freeze({
  queued: 'QUEUED', running: 'RUNNING', succeeded: 'SUCCEEDED', failed: 'FAILED', interrupted: 'INTERRUPTED',
});

export interface AssistantGateway {
  ask(query: string, token: string): Promise<unknown>;
  report(from: string, to: string, token: string): Promise<unknown>;
  startReport(from: string, to: string, operationId: string, token: string): Promise<unknown>;
  reportJob(jobId: string, token: string): Promise<unknown>;
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
    private readonly jobTimeoutMs = REPORT_JOB_TIMEOUT_MS,
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

  async startReport(from: string, to: string, operationId: string, token: string): Promise<unknown> {
    if (typeof from !== 'string' || typeof to !== 'string' || !from.trim() || !to.trim()) {
      throw new BusinessError(400, 'VALIDATION_ERROR');
    }
    // The client's identifier is what makes a retried creation return the same job instead of a new run.
    if (typeof operationId !== 'string' || !UUID.test(operationId)) {
      throw new BusinessError(400, 'VALIDATION_ERROR');
    }
    return projectJob(await this.request('/report/jobs', { from, to, operationId }, token, this.jobTimeoutMs));
  }

  async reportJob(jobId: string, token: string): Promise<unknown> {
    if (typeof jobId !== 'string' || !UUID.test(jobId)) throw new BusinessError(400, 'VALIDATION_ERROR');
    return projectJob(await this.request('/report/jobs/' + jobId, null, token, this.jobTimeoutMs));
  }

  private async request(path: string, body: Readonly<Record<string, string>> | null, token: string,
    timeoutMs = this.timeoutMs): Promise<unknown> {
    const controller = new AbortController();
    // A timeout is not a confirmed rejection: both cases publish the same safe code.
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.transport(this.baseUrl + path, {
        method: body === null ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(body === null ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      throw new BusinessError(503, 'SERVICE_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    const payload = await this.payload(response);
    if (response.status === 200 || response.status === 202) return payload;
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
  // The owner publishes the counts as an object keyed by status; the contract publishes them as a
  // list, ordered by status so two calls describe the same document.
  const counts = record(value);
  return Object.keys(counts).sort().map(status => {
    if (!status.trim()) throw invalid();
    return { status, count: whole(counts[status]) };
  });
}

/** A figure the owner must publish: omitted is an error, `null` means "not available", never zero. */
function requiredFigure(source: Record<string, unknown>, key: string): number | null {
  if (!Object.hasOwn(source, key)) throw invalid();
  const value = source[key];
  return value === null ? null : whole(value);
}

function workFigures(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw invalid();
  return value.map(entry => {
    const work = record(entry);
    if (!Object.hasOwn(work, 'evidence')) throw invalid();
    const evidence = work.evidence === null ? null : record(work.evidence);
    const evidenceFigure = (key: string): number | null => (evidence === null ? null : whole(evidence[key]));
    return {
      orderNumber: text(work.orderNumber),
      assignmentId: optionalText(work.assignmentId),
      executionStatus: text(work.executionStatus),
      advances: requiredFigure(work, 'advances'),
      evidenceAvailable: evidenceFigure('available'),
      evidencePending: evidenceFigure('pending'),
      evidenceFailed: evidenceFigure('failed'),
    };
  });
}

function narrativePathOf(value: unknown): string {
  const path = text(value);
  if (path !== 'llm' && path !== 'deterministic') throw invalid();
  return path;
}

/** `llm` prose must name its model; the deterministic template must not claim one. */
function modelOf(value: unknown, path: string): string | null {
  if (value === null) {
    if (path === 'llm') throw invalid();
    return null;
  }
  const model = text(value);
  if (path !== 'llm') throw invalid();
  return model;
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalid();
  return value;
}

const STATUS_PREFIX = 'works.byStatus.';

/** Every published claim must carry the figure the report actually computed for that indicator. */
function claimValue(
  indicator: string,
  figures: { totalWorks: number; byStatus: ReadonlyMap<string, number>; advances: number | null;
    evidence: { available: number | null; pending: number | null; failed: number | null };
    consulted: number; failed: number },
): number | null {
  if (indicator === 'works.total') return figures.totalWorks;
  if (indicator.startsWith(STATUS_PREFIX)) return figures.byStatus.get(indicator.slice(STATUS_PREFIX.length)) ?? null;
  if (indicator === 'execution.advances') return figures.advances;
  if (indicator === 'evidence.available') return figures.evidence.available;
  if (indicator === 'evidence.pending') return figures.evidence.pending;
  if (indicator === 'evidence.failed') return figures.evidence.failed;
  if (indicator === 'executions.consulted') return figures.consulted;
  if (indicator === 'executions.failed') return figures.failed;
  // An indicator this BFF does not know cannot be checked against the figures: fail closed.
  return null;
}

function claims(
  value: unknown,
  period: { from: string; to: string },
  figures: { totalWorks: number; byStatus: ReadonlyMap<string, number>; advances: number | null;
    evidence: { available: number | null; pending: number | null; failed: number | null };
    consulted: number; failed: number },
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw invalid();
  return value.map(entry => {
    const claim = record(entry);
    const claimPeriod = record(claim.period);
    // A claim bound to another period belongs to another report.
    if (claimPeriod.from !== period.from || claimPeriod.to !== period.to) throw invalid();
    const indicator = text(claim.indicator);
    const claimSource = text(claim.source);
    if (claimSource !== 'operations') throw invalid();
    const expected = claimValue(indicator, figures);
    if (expected === null) throw invalid();
    const figure = whole(claim.value);
    if (figure !== expected) throw invalid();
    return {
      indicator,
      label: text(claim.label),
      value: figure,
      unit: text(claim.unit),
      period: { from: period.from, to: period.to },
      source: claimSource,
      tool: text(claim.tool),
      recordRefs: references(claim.recordRefs),
    };
  });
}

function financialDeclaration(value: unknown): { included: boolean; note: string } {
  const declaration = record(value);
  return { included: flag(declaration.included), note: text(declaration.note) };
}

/**
 * A job is published as a state machine, not as a bag of optional fields: the status decides which
 * fields may appear, so the interface never has to guess whether an absent report means "still
 * working" or "failed silently".
 */
function projectJob(value: unknown): Record<string, unknown> {
  const body = record(value);
  const jobId = text(body.jobId);
  if (!UUID.test(jobId)) throw invalid();
  const status = JOB_STATUS[text(body.status)];
  if (status === undefined) throw invalid();
  const period = record(body.period);
  const from = text(period.from);
  const to = text(period.to);
  const timeZone = text(period.timeZone);
  const requestedAt = text(body.requestedAt);
  const startedAt = optionalText(body.startedAt);
  const finishedAt = optionalText(body.finishedAt);
  const job: Record<string, unknown> = {
    jobId,
    status,
    period: { from, to, timeZone },
    requestedAt,
    startedAt,
    finishedAt,
    report: null,
    failureCode: null,
    failureMessage: null,
  };
  if (status === 'SUCCEEDED') {
    // The document must be the complete report of this very period; anything else is a broken job.
    job.report = projectReport(body.report, from, to);
    return job;
  }
  if (status === 'FAILED' || status === 'INTERRUPTED') {
    if (body.report !== undefined && body.report !== null) throw invalid();
    const failure = record(body.failure);
    const published = text(failure.code);
    // An unknown code is not invented away: it is published as the generic failure, never as success.
    const code = Object.hasOwn(REPORT_FAILURE_MESSAGES, published) ? published : 'INTERNAL_ERROR';
    job.failureCode = code;
    job.failureMessage = REPORT_FAILURE_MESSAGES[code];
    // QUEUED/RUNNING jobs that carry a report or a failure would contradict their own status.
  } else if (body.report !== undefined && body.report !== null) {
    throw invalid();
  } else if (body.failure !== undefined && body.failure !== null) {
    throw invalid();
  }
  return job;
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
  const totalWorks = whole(figures.totalWorks);
  const byStatus = statusCounts(figures.byStatus);
  const works = workFigures(figures.perWork);
  const statusSum = byStatus.reduce((total, row) => total + (row.count as number), 0);
  // One population only: the total, the status counts and the itemised works must agree.
  if (statusSum !== totalWorks || works.length !== totalWorks) throw invalid();
  if (!Object.hasOwn(figures, 'advances') || !Object.hasOwn(figures, 'evidence')) throw invalid();
  const advances = figures.advances === null ? null : whole(figures.advances);
  const evidence = figures.evidence === null ? null : record(figures.evidence);
  const evidenceFigure = (key: string): number | null => (evidence === null ? null : whole(evidence[key]));
  const consultedExecutions = whole(figures.executionsConsulted);
  const failedExecutions = whole(figures.executionsFailed);
  const complete = flag(figures.complete);
  if (complete !== (failedExecutions === 0)) throw invalid();
  const narrative = record(body.narrative);
  const path = narrativePathOf(narrative.path);
  const totals = {
    totalWorks,
    byStatus: new Map<string, number>(byStatus.map(row => [String(row.status), Number(row.count)] as [string, number])),
    advances,
    evidence: { available: evidenceFigure('available'), pending: evidenceFigure('pending'), failed: evidenceFigure('failed') },
    consulted: consultedExecutions,
    failed: failedExecutions,
  };
  return {
    period: { from, to, timeZone: text(period.timeZone) },
    generatedAt: text(body.generatedAt),
    narrativePath: path,
    model: modelOf(narrative.model, path),
    narrativeVerified: flag(narrative.verified),
    promptVersion: text(body.promptVersion),
    narrative: text(narrative.text),
    figures: {
      byStatus,
      works,
      totalWorks,
      advances,
      evidenceAvailable: totals.evidence.available,
      evidencePending: totals.evidence.pending,
      evidenceFailed: totals.evidence.failed,
      complete,
      consultedExecutions,
      failedExecutions,
    },
    claims: claims(body.claims, { from, to }, totals),
    references: references(body.references),
    provenance: provenance(body.provenance),
    limitations: texts(body.limitations),
    financialData: financialDeclaration(body.financialData),
  };
}

