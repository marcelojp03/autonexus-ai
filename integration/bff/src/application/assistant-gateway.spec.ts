import { describe, expect, it, vi } from 'vitest';
import { ASSISTANT_TIMEOUT_MS, HttpAssistantGateway, MAX_ASSISTANT_QUERY } from './assistant-gateway.js';

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

const REPORT = {
  narrative: 'En el período se cerraron dos trabajos y uno quedó en revisión.',
  period: { from: '2026-11-01', to: '2026-11-30' },
  generatedAt: '2026-11-06T12:00:00Z',
  model: 'qwen3.5:4b',
  toolsUsed: ['operations_report'],
  figures: {
    byStatus: [{ status: 'completed', count: 2 }, { status: 'pending_verification', count: 1 }],
    works: [
      { orderNumber: 'OT-1', assignmentId: '11111111-1111-4111-8111-111111111111', executionStatus: 'completed', advances: 3, evidenceAvailable: 2, evidencePending: 0, evidenceFailed: 0 },
    ],
    totalWorks: 3,
  },
  references: [{ kind: 'assignment', id: '11111111-1111-4111-8111-111111111111', label: 'OT-1' }],
  provenance: [{ service: 'operations', resource: '/executions/team', tool: 'team_execution', observedAt: '2026-11-06T11:59:00Z' }],
  limitations: [],
};

function gatewayReturning(body: unknown, status = 200, transport = vi.fn<typeof fetch>()) {
  transport.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  return { transport, gateway: new HttpAssistantGateway('http://127.0.0.1:3099', transport) };
}

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
  it('forwards the requested period and never recomputes the deterministic figures', async () => {
    const { transport, gateway } = gatewayReturning(REPORT);
    const report = (await gateway.report('2026-11-01', '2026-11-30', 'head-token')) as Record<string, unknown>;
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3099/report');
    expect(init?.body).toBe(JSON.stringify({ from: '2026-11-01', to: '2026-11-30' }));
    expect(init?.headers).toEqual({ Authorization: 'Bearer head-token', 'Content-Type': 'application/json' });
    expect(report).toEqual({
      period: REPORT.period,
      generatedAt: REPORT.generatedAt,
      model: REPORT.model,
      narrative: REPORT.narrative,
      figures: REPORT.figures,
      references: REPORT.references,
      provenance: REPORT.provenance,
      limitations: [],
    });
    // The figures are the owner's own numbers: totalWorks is neither derived from works nor adjusted.
    expect((report.figures as { totalWorks: number }).totalWorks).toBe(3);
  });

  it('fails closed when the owner answers another period or malformed figures', async () => {
    const otherPeriod = gatewayReturning({ ...REPORT, period: { from: '2026-10-01', to: '2026-10-31' } });
    await expect(otherPeriod.gateway.report('2026-11-01', '2026-11-30', 'head-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const missingFigure = gatewayReturning({ ...REPORT, figures: { ...REPORT.figures, works: [{ ...REPORT.figures.works[0], advances: undefined }] } });
    await expect(missingFigure.gateway.report('2026-11-01', '2026-11-30', 'head-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const negative = gatewayReturning({ ...REPORT, figures: { ...REPORT.figures, totalWorks: -1 } });
    await expect(negative.gateway.report('2026-11-01', '2026-11-30', 'head-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const noFigures = gatewayReturning({ ...REPORT, figures: undefined });
    await expect(noFigures.gateway.report('2026-11-01', '2026-11-30', 'head-token')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
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
