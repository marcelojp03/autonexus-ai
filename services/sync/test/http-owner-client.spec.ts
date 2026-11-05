import { describe, expect, it } from 'vitest';
import { HttpOwnerClient } from '../src/infrastructure/owners/http-owner-client.js';
import type { StoredOperation } from '../src/domain/overlay.js';

describe('MS05 client-inference forwarding', () => {
  it('sends prediction and human review as separate fields to MS04 with the actor token', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const client = new HttpOwnerClient(
      { operationsUrl: 'http://operations', intelligenceUrl: 'http://intelligence' },
      async (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return new Response(JSON.stringify({ analysisId: 'analysis-1' }), { status: 201 });
      },
    );
    const operation: StoredOperation = {
      operationId: '11111111-1111-4111-8111-111111111111',
      overlayId: '22222222-2222-4222-8222-222222222222',
      subject: 'mechanic-subject',
      entity: 'client-inference',
      target: { assignmentId: '33333333-3333-4333-8333-333333333333', evidenceId: '44444444-4444-4444-8444-444444444444' },
      baseVersion: 5,
      dependsOn: [],
      payload: {},
      clientInference: {
        runId: 'run-1',
        modelVersion: 'mobile-v1',
        imageSha256: 'a'.repeat(64),
        labels: [{ name: 'dent', score: 0.8 }],
        humanReview: { modelVersion: 'mobile-v1', labels: [] },
      },
      state: 'pending',
      attempts: [],
      expiresAt: 0,
    };

    await client.apply(operation, 'actor-token');

    expect(requestedUrl).toBe('http://intelligence/vision/client-analyses');
    expect(new Headers(requestedInit?.headers).get('authorization')).toBe('Bearer actor-token');
    expect(JSON.parse(String(requestedInit?.body))).toEqual({
      assignmentId: operation.target.assignmentId,
      evidenceId: operation.target.evidenceId,
      ...operation.clientInference,
    });
  });
});
