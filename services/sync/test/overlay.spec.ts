import { describe, expect, it } from 'vitest';

import { SyncError, classify, operation, overlay } from '../src/domain/overlay.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const HEX = 'a'.repeat(64);

const advance = (overrides: Record<string, unknown> = {}) => ({
  operationId: UUID_A,
  entity: 'advance',
  target: { assignmentId: UUID_B },
  baseVersion: 3,
  dependsOn: [],
  payload: { operationId: UUID_A, expectedVersion: 3, description: 'Cambio de aceite', minutesWorked: 30 },
  ...overrides,
});

const expectValidation = (action: () => unknown, pattern: RegExp): void => {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SyncError);
    expect(String((error as SyncError).details ?? '')).toMatch(pattern);
    return;
  }
  throw new Error('the call was expected to fail');
};

const envelope = (operations: unknown[], extra: Record<string, unknown> = {}) => ({
  overlayId: UUID_B,
  deviceId: 'pixel-7',
  createdAt: '2026-11-02T10:00:00Z',
  operations,
  ...extra,
});

describe('overlay validation', () => {
  it('accepts a well formed overlay and derives the subject from the token', () => {
    const parsed = overlay(envelope([advance()]), 'subject-1');
    expect(parsed.subject).toBe('subject-1');
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0]!.entity).toBe('advance');
  });

  it('rejects client supplied identity fields', () => {
    expectValidation(() => overlay(envelope([advance()], { subject: 'other' }), 'subject-1'), /not allowed/);
    expectValidation(() => overlay(envelope([advance({ subject: 'other' })]), 'subject-1'), /not allowed/);
  });

  it('rejects unknown entity, unknown fields and bad UUIDs', () => {
    expectValidation(() => overlay(envelope([advance({ entity: 'payment' })]), 's'), /not published/);
    expectValidation(() => overlay(envelope([advance({ extra: true })]), 's'), /not allowed/);
    expectValidation(() => overlay(envelope([advance({ operationId: 'not-a-uuid' })]), 's'), /UUID/);
  });

  it('rejects a dependency on an operation outside the overlay and cycles', () => {
    expectValidation(() => overlay(envelope([advance({ dependsOn: [UUID_B] })]), 's'), /same overlay/);
    const cyclic = [
      advance({ operationId: UUID_A, dependsOn: [UUID_B] }),
      advance({ operationId: UUID_B, dependsOn: [UUID_A] }),
    ];
    expectValidation(() => overlay(envelope(cyclic), 's'), /cycle/);
  });

  it('requires the client inference block exactly on the client-inference entity', () => {
    const clientInference = { runId: 'r1', modelVersion: 'm1', imageSha256: HEX, labels: [{ name: 'scratch', score: 0.4 }] };
    expectValidation(() => overlay(envelope([advance({ entity: 'client-inference' })]), 's'), /requires clientInference/);
    expectValidation(() => overlay(envelope([advance({ clientInference })]), 's'), /only belongs/);
    const parsed = overlay(envelope([advance({ entity: 'client-inference', clientInference })]), 's');
    expect(parsed.operations[0]!.clientInference?.imageSha256).toBe(HEX);
  });

  it('validates the file descriptor', () => {
    expectValidation(() => overlay(envelope([advance({ file: { sha256: 'short', bytes: 10, contentType: 'image/jpeg' } })]), 's'), /sha256/);
    expectValidation(() => overlay(envelope([advance({ file: { sha256: HEX, bytes: 0, contentType: 'image/jpeg' } })]), 's'), /positive/);
  });
});

describe('owner result classification', () => {
  it('keeps version conflicts distinct from access rejections', () => {
    expect(classify(409, 'VERSION_CONFLICT')).toBe('conflict');
    expect(classify(409, 'IDEMPOTENCY_CONFLICT')).toBe('conflict');
    expect(classify(403, 'EXECUTION_ACCESS_DENIED')).toBe('rejected');
    expect(classify(404, 'ASSIGNMENT_NOT_FOUND')).toBe('rejected');
    expect(classify(400, 'VALIDATION_ERROR')).toBe('rejected');
  });

  it('does not treat a lost session or an unavailable owner as a final answer', () => {
    expect(classify(401, 'UNAUTHENTICATED')).toBe('pending');
    expect(classify(503, 'SERVICE_UNAVAILABLE')).toBe('pending');
    expect(classify(503, 'PERSISTENCE_UNAVAILABLE')).toBe('pending');
  });

  it('marks an expired upload authorization as needing a new one', () => {
    expect(classify(409, 'EVIDENCE_UPLOAD_EXPIRED')).toBe('needs-reupload');
  });

  it('treats 2xx as applied', () => {
    expect(classify(200, 'ANY')).toBe('applied');
    expect(classify(201, 'ANY')).toBe('applied');
  });
});

describe('operation parsing', () => {
  it('keeps optional ids absent instead of undefined keys', () => {
    const parsed = operation(advance(), UUID_B);
    expect(Object.keys(parsed.target)).toEqual(['assignmentId']);
  });
});
