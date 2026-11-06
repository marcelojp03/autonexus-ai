import { describe, expect, it, vi } from 'vitest';
import { ASSISTANT_TIMEOUT_MS, HttpAssistantGateway, MAX_ASSISTANT_QUERY, REPORT_FAILURE_MESSAGES, REPORT_JOB_TIMEOUT_MS } from './assistant-gateway.js';

const ANSWER = {
  answer: 'Hay dos trabajos en curso en la agenda del equipo.',
  refused: false,
  toolsUsed: ['list_orders', 'team_execution'],
  model: 'qwen3.5:4b',
  generatedAt: '2026-11-06T12:00:00Z',
  references: [{ kind: 'order', id: 'OT-1', label: 'Orden OT-1' }, { kind: 7, id: 'OT-2' }],
  provenance: [{ service: 'operations', resource: '/orders', tool: 'list_orders', observedAt: '2026-11-06T11:59:00Z' }, { service: '' }],
  limitations: ['El alcance es el taller completo, no la agenda personal.'],
};

const ORDER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const ORDER_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const ASSIGNMENT_A = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT_B = '22222222-2222-4222-8222-222222222222';
const PERIOD = { from: '2026-11-01', to: '2026-11-30', timeZone: 'America/La_Paz' };

/** Body published by the real CU26 service (`integration/agent`, POST /report). */
const REPORT = {
  report: 'operations-narrative',
  promptVersion: 'cu26-report-v2',
  period: PERIOD,
  generatedAt: '2026-11-06T12:00:00Z',
  figures: {
    totalWorks: 2,
    byStatus: { pending_verification: 1, completed: 1 },
    advances: 4,
    evidence: { pending: 0, available: 3, failed: 1 },
    perWork: [
      { orderNumber: 'OT-1', orderId: ORDER_A, assignmentId: ASSIGNMENT_A, executionStatus: 'completed',
        startsAt: '2026-11-02T13:00:00Z', advances: 4, evidence: { pending: 0, available: 3, failed: 1 },
        references: [{ kind: 'order', id: ORDER_A }, { kind: 'assignment', id: ASSIGNMENT_A }] },
      { orderNumber: 'OT-2', orderId: ORDER_B, assignmentId: ASSIGNMENT_B, executionStatus: 'pending_verification',
        startsAt: '2026-11-03T13:00:00Z', advances: null, evidence: null,
        references: [{ kind: 'order', id: ORDER_B }, { kind: 'assignment', id: ASSIGNMENT_B }] },
    ],
    complete: false,
    executionsConsulted: 1,
    executionsFailed: 1,
  },
  claims: [
    { indicator: 'works.total', label: 'trabajos programados', value: 2, unit: 'trabajos',
      period: { from: PERIOD.from, to: PERIOD.to }, source: 'operations', tool: 'autonexus_list_team_agenda',
      recordRefs: [{ kind: 'order', id: ORDER_A }, { kind: 'assignment', id: ASSIGNMENT_A }] },
    { indicator: 'works.byStatus.completed', label: 'trabajos en completed', value: 1, unit: 'trabajos',
      period: { from: PERIOD.from, to: PERIOD.to }, source: 'operations', tool: 'autonexus_list_team_agenda',
      recordRefs: [{ kind: 'order', id: ORDER_A }] },
    { indicator: 'execution.advances', label: 'avances en las ejecuciones consultadas', value: 4, unit: 'avances',
      period: { from: PERIOD.from, to: PERIOD.to }, source: 'operations', tool: 'autonexus_get_team_execution',
      recordRefs: [{ kind: 'assignment', id: ASSIGNMENT_A }] },
  ],
  narrative: {
    text: 'Entre el 2026-11-01 y el 2026-11-30 la agenda autorizada registró 2 trabajos programados.',
    path: 'deterministic',
    model: null,
    verified: true,
    generative: false,
  },
  references: [{ kind: 'order', id: ORDER_A }, { kind: 'assignment', id: ASSIGNMENT_A }],
  provenance: [{ service: 'operations', resource: '/agenda/team', tool: 'autonexus_list_team_agenda',
    observedAt: '2026-11-06T11:59:00Z' }],
  financialData: { included: false, note: 'Este reporte no incluye datos financieros.' },
  limitations: ['execution_unavailable:OWNER_UNAVAILABLE'],
};

/** What the GraphQL contract publishes for that body: one source field per published field. */
const PROJECTED = {
  period: { from: PERIOD.from, to: PERIOD.to, timeZone: 'America/La_Paz' },
  generatedAt: '2026-11-06T12:00:00Z',
  narrativePath: 'deterministic',
  model: null,
  narrativeVerified: true,
  promptVersion: 'cu26-report-v2',
  narrative: REPORT.narrative.text,
  figures: {
    byStatus: [{ status: 'completed', count: 1 }, { status: 'pending_verification', count: 1 }],
    works: [
      { orderNumber: 'OT-1', assignmentId: ASSIGNMENT_A, executionStatus: 'completed',
        advances: 4, evidenceAvailable: 3, evidencePending: 0, evidenceFailed: 1 },
      { orderNumber: 'OT-2', assignmentId: ASSIGNMENT_B, executionStatus: 'pending_verification',
        advances: null, evidenceAvailable: null, evidencePending: null, evidenceFailed: null },
    ],
    totalWorks: 2,
    advances: 4,
    evidenceAvailable: 3,
    evidencePending: 0,
    evidenceFailed: 1,
    complete: false,
    consultedExecutions: 1,
    failedExecutions: 1,
  },
  claims: REPORT.claims.map(claim => ({
    indicator: claim.indicator,
    label: claim.label,
    value: claim.value,
    unit: claim.unit,
    period: { from: PERIOD.from, to: PERIOD.to },
    source: 'operations',
    tool: claim.tool,
    recordRefs: claim.recordRefs.map(reference => ({ kind: reference.kind, id: reference.id, label: null })),
  })),
  references: [{ kind: 'order', id: ORDER_A, label: null }, { kind: 'assignment', id: ASSIGNMENT_A, label: null }],
  provenance: REPORT.provenance,
  limitations: REPORT.limitations,
  financialData: REPORT.financialData,
};

function gatewayReturning(body: unknown, status = 200, transport = vi.fn<typeof fetch>()) {
  transport.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  return { transport, gateway: new HttpAssistantGateway('http://127.0.0.1:3099', transport) };
}

const reportOf = (body: unknown) => gatewayReturning(body);
const clone = () => JSON.parse(JSON.stringify(REPORT)) as typeof REPORT;

describe('CU25 assistant boundary', () => {
  it('forwards the user token and body, and projects only the contract fields', async () => {
    const { transport, gateway } = gatewayReturning({ ...ANSWER, totalAmount: 1200, currency: 'BOB', token: 'leaked' });
    const answer = (await gateway.ask('¿Qué trabajos están en curso?', 'user-token')) as Record<string, unknown>;
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3099/assistant');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ query: '¿Qué trabajos están en curso?' }));
    // The forwarded credential is the user's own token: no technical identity and no second header.
    expect(init?.headers).toEqual({ Authorization: 'Bearer user-token', 'Content-Type': 'application/json' });
    expect(init?.redirect).toBe('error');
    expect(answer).toEqual({
      answer: ANSWER.answer,
      refused: false,
      toolsUsed: ANSWER.toolsUsed,
      model: 'qwen3.5:4b',
      generatedAt: '2026-11-06T12:00:00Z',
      // Entries without kind/id or without service/resource are dropped, never repaired.
      references: [{ kind: 'order', id: 'OT-1', label: 'Orden OT-1' }],
      provenance: [{ service: 'operations', resource: '/orders', tool: 'list_orders', observedAt: '2026-11-06T11:59:00Z' }],
      limitations: ANSWER.limitations,
    });
    expect(Object.keys(answer)).not.toContain('totalAmount');
    expect(JSON.stringify(answer)).not.toContain('leaked');
  });

  it('keeps the refusal state separate from a transport failure', async () => {
    const { gateway } = gatewayReturning({
      answer: 'No puedo responder: la cuenta no tiene permiso para consultar órdenes.',
      refused: true,
      toolsUsed: [],
      model: 'qwen3.5:4b',
      generatedAt: '2026-11-06T12:00:00Z',
      limitations: ['Sin permiso orders:read.'],
    });
    const answer = (await gateway.ask('Órdenes de noviembre', 'mechanic-token')) as Record<string, unknown>;
    expect(answer.refused).toBe(true);
    expect(answer.limitations).toEqual(['Sin permiso orders:read.']);
    expect(answer.references).toEqual([]);
  });

  it('rejects an oversized prompt without reaching the assistant', async () => {
    const transport = vi.fn<typeof fetch>();
    const gateway = new HttpAssistantGateway('http://127.0.0.1:3099', transport);
    await expect(gateway.ask('x'.repeat(MAX_ASSISTANT_QUERY + 1), 'user-token')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(gateway.ask('   ', 'user-token')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    expect(transport).not.toHaveBeenCalled();
  });

  it('fails closed when the answer text or model is missing', async () => {
    for (const body of [{ ...ANSWER, answer: '' }, { ...ANSWER, model: undefined }, { ...ANSWER, generatedAt: 12 }, null, 'text']) {
      const { gateway } = gatewayReturning(body);
      await expect(gateway.ask('¿Estado?', 'user-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    }
  });
});

describe('CU26 report boundary', () => {
  it('forwards the requested period and projects the service DTO field by field', async () => {
    const { transport, gateway } = gatewayReturning(REPORT);
    const report = (await gateway.report('2026-11-01', '2026-11-30', 'head-token')) as Record<string, unknown>;
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3099/report');
    expect(init?.body).toBe(JSON.stringify({ from: '2026-11-01', to: '2026-11-30' }));
    expect(init?.headers).toEqual({ Authorization: 'Bearer head-token', 'Content-Type': 'application/json' });
    expect(report).toEqual(PROJECTED);
  });

  it('publishes the figures of the owner, never a derived or adjusted total', async () => {
    const { gateway } = reportOf(REPORT);
    const report = (await gateway.report('2026-11-01', '2026-11-30', 'head-token')) as {
      figures: { totalWorks: number; byStatus: Array<{ count: number }>; works: unknown[] };
    };
    expect(report.figures.totalWorks).toBe(REPORT.figures.totalWorks);
    expect(report.figures.byStatus.reduce((total, row) => total + row.count, 0)).toBe(REPORT.figures.totalWorks);
    expect(report.figures.works).toHaveLength(REPORT.figures.totalWorks);
  });

  it('publishes an unavailable execution figure as null, never as zero', async () => {
    const { gateway } = reportOf(REPORT);
    const report = (await gateway.report('2026-11-01', '2026-11-30', 'head-token')) as {
      figures: { works: Array<Record<string, unknown>> };
    };
    expect(report.figures.works[1]).toMatchObject({ advances: null, evidenceAvailable: null, evidencePending: null, evidenceFailed: null });
  });

  it('fails closed when a figure is omitted instead of publishing a zero', async () => {
    const omitted = clone() as unknown as { figures: Record<string, unknown> };
    delete omitted.figures.advances;
    await expect(reportOf(omitted).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const noTotal = clone() as unknown as { figures: Record<string, unknown> };
    delete noTotal.figures.totalWorks;
    await expect(reportOf(noTotal).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const noEvidence = clone() as unknown as { figures: { perWork: Array<Record<string, unknown>> } };
    delete noEvidence.figures.perWork[1].evidence;
    await expect(reportOf(noEvidence).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const noAdvance = clone() as unknown as { figures: { perWork: Array<Record<string, unknown>> } };
    delete noAdvance.figures.perWork[1].advances;
    await expect(reportOf(noAdvance).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('fails closed when the total, the status counts and the works disagree', async () => {
    const drifted = clone() as unknown as { figures: Record<string, unknown> };
    drifted.figures.totalWorks = 3;
    await expect(reportOf(drifted).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const missingWork = clone();
    missingWork.figures.perWork = [missingWork.figures.perWork[0]!];
    await expect(reportOf(missingWork).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('fails closed when a claim contradicts a figure or belongs to another period', async () => {
    const wrongValue = clone();
    wrongValue.claims[0]!.value = 99;
    await expect(reportOf(wrongValue).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const wrongPeriod = clone();
    wrongPeriod.claims[0]!.period = { from: '2026-10-01', to: '2026-10-31' };
    await expect(reportOf(wrongPeriod).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const unknownIndicator = clone();
    unknownIndicator.claims[0]!.indicator = 'works.revenue';
    await expect(reportOf(unknownIndicator).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('marks the deterministic narrative and refuses a model on it', async () => {
    const { gateway } = reportOf(REPORT);
    const report = (await gateway.report('2026-11-01', '2026-11-30', 'head-token')) as Record<string, unknown>;
    expect(report).toMatchObject({ narrativePath: 'deterministic', model: null, narrativeVerified: true });

    const claimed = clone() as unknown as { narrative: Record<string, unknown> };
    claimed.narrative['model'] = 'qwen3.5:4b';
    await expect(reportOf(claimed).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const unverified = clone() as unknown as { narrative: Record<string, unknown> };
    unverified.narrative['path'] = 'llm';
    unverified.narrative['model'] = null;
    await expect(reportOf(unverified).gateway.report('2026-11-01', '2026-11-30', 'head-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('fails closed when the owner answers another period or malformed figures', async () => {
    const otherPeriod = gatewayReturning({ ...REPORT, period: { ...PERIOD, from: '2026-10-01', to: '2026-10-31' } });
    await expect(otherPeriod.gateway.report('2026-11-01', '2026-11-30', 'head-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const negative = clone() as unknown as { figures: Record<string, unknown> };
    negative.figures.totalWorks = -1;
    await expect(reportOf(negative).gateway.report('2026-11-01', '2026-11-30', 'head-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const noFigures = gatewayReturning({ ...REPORT, figures: undefined });
    await expect(noFigures.gateway.report('2026-11-01', '2026-11-30', 'head-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const badFinancial = clone();
    (badFinancial.financialData as { included: unknown }).included = 'no';
    await expect(reportOf(badFinancial).gateway.report('2026-11-01', '2026-11-30', 'head-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('closed error mapping', () => {
  it.each([
    [401, 'UNAUTHENTICATED', 401],
    [403, 'FORBIDDEN', 403],
    [503, 'SERVICE_UNAVAILABLE', 503],
    [500, 'SERVICE_UNAVAILABLE', 503],
    [429, 'SERVICE_UNAVAILABLE', 503],
  ])('maps HTTP %i to %s', async (status, code, statusCode) => {
    const { gateway } = gatewayReturning({ code: 'INTERNAL_LLM_STACK', message: 'private upstream detail' }, status);
    const failure = await gateway.ask('¿Estado?', 'user-token').catch(error => error);
    expect(failure).toMatchObject({ code, statusCode, message: code });
    expect(JSON.stringify(failure)).not.toContain('private upstream detail');
  });

  it('publishes VALIDATION_ERROR for a rejected prompt and ignores unpublished codes', async () => {
    const { gateway } = gatewayReturning({ code: 'PROMPT_TOO_LONG', message: 'private' }, 400);
    await expect(gateway.ask('¿Estado?', 'user-token')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    const published = gatewayReturning({ code: 'VALIDATION_ERROR' }, 422);
    await expect(published.gateway.report('2026-11-01', '2026-11-30', 'user-token')).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });

  it('publishes SERVICE_UNAVAILABLE for a transport failure or an unreadable body', async () => {
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(new HttpAssistantGateway('http://127.0.0.1:3099', offline).ask('¿Estado?', 'user-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    const unreadable = vi.fn<typeof fetch>().mockResolvedValue(new Response('not json', { status: 200 }));
    await expect(new HttpAssistantGateway('http://127.0.0.1:3099', unreadable).ask('¿Estado?', 'user-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
  });

  it('creates the report job with the client operationId and a short budget', async () => {
    expect(REPORT_JOB_TIMEOUT_MS).toBe(15_000);
    const queued = {jobId: ORDER_B, status: 'queued', period: PERIOD, requestedAt: '2026-11-06T12:00:00Z',
      startedAt: null, finishedAt: null};
    const { transport, gateway } = gatewayReturning(queued, 202);
    const job = (await gateway.startReport(PERIOD.from, PERIOD.to, ASSIGNMENT_A, 'user-token')) as Record<string, unknown>;
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3099/report/jobs');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({from: PERIOD.from, to: PERIOD.to, operationId: ASSIGNMENT_A});
    expect(job).toMatchObject({jobId: ORDER_B, status: 'QUEUED', report: null, failureCode: null});
  });
  it('waits the full 120 s for the LLM and then publishes SERVICE_UNAVAILABLE', async () => {
    expect(ASSISTANT_TIMEOUT_MS).toBe(120_000);
    vi.useFakeTimers();
    try {
      const transport = vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
          }),
      );
      const gateway = new HttpAssistantGateway('http://127.0.0.1:3099', transport);
      const pending = gateway.ask('¿Qué pasó en el taller esta semana?', 'user-token');
      const failure = pending.catch(error => error);
      await vi.advanceTimersByTimeAsync(ASSISTANT_TIMEOUT_MS - 1);
      expect(transport).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await failure).toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CU26 report job boundary', () => {
  const JOB = { jobId: ORDER_B, period: PERIOD, requestedAt: '2026-11-06T12:00:00Z', startedAt: null, finishedAt: null };

  it('creates the job with the client operationId and reads it by identifier', async () => {
    const { transport, gateway } = gatewayReturning({ ...JOB, status: 'queued' }, 202);
    const job = (await gateway.startReport(PERIOD.from, PERIOD.to, ASSIGNMENT_A, 'user-token')) as Record<string, unknown>;
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3099/report/jobs');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ from: PERIOD.from, to: PERIOD.to, operationId: ASSIGNMENT_A });
    expect(job).toMatchObject({ jobId: ORDER_B, status: 'QUEUED', report: null, failureCode: null, failureMessage: null });

    const reading = gatewayReturning({ ...JOB, status: 'running', startedAt: '2026-11-06T12:00:05Z' });
    const state = (await reading.gateway.reportJob(ORDER_B, 'user-token')) as Record<string, unknown>;
    expect(reading.transport.mock.calls[0][0]).toBe('http://127.0.0.1:3099/report/jobs/' + ORDER_B);
    expect(reading.transport.mock.calls[0][1]?.method).toBe('GET');
    expect(state).toMatchObject({ status: 'RUNNING', startedAt: '2026-11-06T12:00:05Z', report: null });
  });

  it('publishes the document of a succeeded job exactly as the direct report', async () => {
    const { gateway } = gatewayReturning({ ...JOB, status: 'succeeded', finishedAt: '2026-11-06T12:02:00Z', report: clone() });
    const job = (await gateway.reportJob(ORDER_B, 'user-token')) as Record<string, unknown>;
    expect(job.status).toBe('SUCCEEDED');
    expect(job.report).toEqual(PROJECTED);
    expect(job.failureCode).toBeNull();
  });

  it('publishes its own message for a known failure and never the owner text', async () => {
    const { gateway } = gatewayReturning({ ...JOB, status: 'failed', finishedAt: '2026-11-06T12:02:00Z',
      failure: { code: 'AUTHORIZATION_EXPIRED', message: 'token eyJhbGciOi... del usuario' } });
    const job = (await gateway.reportJob(ORDER_B, 'user-token')) as Record<string, unknown>;
    expect(job.failureCode).toBe('AUTHORIZATION_EXPIRED');
    expect(job.failureMessage).toBe(REPORT_FAILURE_MESSAGES['AUTHORIZATION_EXPIRED']);
    expect(JSON.stringify(job)).not.toContain('eyJhbGciOi');
  });

  it('publishes an unknown failure code as the generic failure, never as success', async () => {
    const { gateway } = gatewayReturning({ ...JOB, status: 'failed', failure: { code: 'ALGO_NUEVO', message: 'x' } });
    const job = (await gateway.reportJob(ORDER_B, 'user-token')) as Record<string, unknown>;
    expect(job.failureCode).toBe('INTERNAL_ERROR');
    expect(job.report).toBeNull();
  });

  it('refuses a job whose state contradicts its own fields', async () => {
    const succeededWithoutReport = gatewayReturning({ ...JOB, status: 'succeeded' });
    await expect(succeededWithoutReport.gateway.reportJob(ORDER_B, 'user-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    const queuedWithReport = gatewayReturning({ ...JOB, status: 'queued', report: clone() });
    await expect(queuedWithReport.gateway.reportJob(ORDER_B, 'user-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    const unknownStatus = gatewayReturning({ ...JOB, status: 'inventado' });
    await expect(unknownStatus.gateway.reportJob(ORDER_B, 'user-token'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
  });

  it('rejects an identifier that is not a UUID before reaching the owner', async () => {
    const { transport, gateway } = gatewayReturning({});
    await expect(gateway.reportJob('../../etc/passwd', 'user-token'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    await expect(gateway.startReport(PERIOD.from, PERIOD.to, 'no-es-uuid', 'user-token'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    expect(transport).not.toHaveBeenCalled();
  });

  it('bounds the polling read with its own short budget', async () => {
    expect(REPORT_JOB_TIMEOUT_MS).toBe(15_000);
    vi.useFakeTimers();
    try {
      const transport = vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
          }),
      );
      const gateway = new HttpAssistantGateway('http://127.0.0.1:3099', transport);
      const pending = gateway.reportJob(ORDER_B, 'user-token');
      const failure = pending.catch(error => error);
      await vi.advanceTimersByTimeAsync(REPORT_JOB_TIMEOUT_MS);
      expect(await failure).toMatchObject({ code: 'SERVICE_UNAVAILABLE', statusCode: 503 });
    } finally {
      vi.useRealTimers();
    }
  });
});
