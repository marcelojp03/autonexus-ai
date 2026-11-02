import { describe, expect, it } from 'vitest';

import { PushOverlay, orderByDependencies } from '../src/application/push-overlay.js';
import type { OverlayRepository, OwnerClient, OwnerResult } from '../src/application/ports.js';
import { overlay, type Overlay, type StoredOperation } from '../src/domain/overlay.js';

const OVERLAY = '33333333-3333-4333-8333-333333333333';
const ADVANCE = '44444444-4444-4444-8444-444444444444';
const AUTHORIZE = '55555555-5555-4555-8555-555555555555';
const CONFIRM = '66666666-6666-4666-8666-666666666666';
const ASSIGNMENT = '77777777-7777-4777-8777-777777777777';
const ADVANCE_ID = '88888888-8888-4888-8888-888888888888';
const EVIDENCE_ID = '99999999-9999-4999-8999-999999999999';

/** In-memory store with the same subject scoping as the DynamoDB adapter. */
class MemoryRepository implements OverlayRepository {
  private readonly overlays = new Map<string, StoredOperation[]>();

  async ready(): Promise<boolean> {
    return true;
  }

  async ensureTable(): Promise<void> {
    // The in-memory double needs no schema.
  }

  async save(input: Overlay): Promise<{ replayed: boolean }> {
    const key = input.subject;
    const existing = this.overlays.get(key) ?? [];
    if (existing.some(operation => operation.overlayId === input.overlayId)) return { replayed: true };
    this.overlays.set(key, [
      ...existing,
      ...input.operations.map(operation => ({ ...operation, overlayId: input.overlayId, subject: input.subject, state: 'pending' as const, attempts: [], expiresAt: 0 })),
    ]);
    return { replayed: false };
  }

  async byId(subject: string, overlayId: string) {
    const operations = (this.overlays.get(subject) ?? []).filter(operation => operation.overlayId === overlayId);
    if (operations.length === 0) return undefined;
    return { overlay: { overlayId, subject, deviceId: 'd1', createdAt: '2026-11-02T10:00:00Z', operations } as Overlay, operations };
  }

  async operationsByOverlay(subject: string, overlayId: string): Promise<StoredOperation[]> {
    return (this.overlays.get(subject) ?? []).filter(operation => operation.overlayId === overlayId);
  }

  async operation(subject: string, operationId: string): Promise<StoredOperation | undefined> {
    return (this.overlays.get(subject) ?? []).find(operation => operation.operationId === operationId);
  }

  async update(operation: StoredOperation): Promise<void> {
    const list = this.overlays.get(operation.subject) ?? [];
    this.overlays.set(operation.subject, list.map(item => (item.operationId === operation.operationId ? operation : item)));
  }
}

/** Owner double that records calls and can be told to fail, lose the response or reject. */
class ScriptedOwner implements OwnerClient {
  readonly calls: string[] = [];
  private readonly script = new Map<string, OwnerResult[]>();
  private readonly applied = new Map<string, number>();

  respond(operationId: string, ...results: OwnerResult[]): this {
    this.script.set(operationId, results);
    return this;
  }

  count(operationId: string): number {
    return this.applied.get(operationId) ?? 0;
  }

  async apply(operation: StoredOperation, token: string): Promise<OwnerResult> {
    expect(token).toBe('user-token');
    this.calls.push(operation.operationId);
    const queue = this.script.get(operation.operationId) ?? [{ status: 200, code: 'OK', body: {} }];
    const result = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (result.status < 300) this.applied.set(operation.operationId, (this.applied.get(operation.operationId) ?? 0) + 1);
    return result;
  }
}

function threeStepOverlay() {
  return overlay(
    {
      overlayId: OVERLAY,
      deviceId: 'd1',
      createdAt: '2026-11-02T10:00:00Z',
      operations: [
        { operationId: ADVANCE, entity: 'advance', target: { assignmentId: ASSIGNMENT }, baseVersion: 1, dependsOn: [], payload: {} },
        { operationId: AUTHORIZE, entity: 'evidence-authorize', target: { assignmentId: ASSIGNMENT, advanceId: ADVANCE_ID }, baseVersion: 2, dependsOn: [ADVANCE], payload: {} },
        { operationId: CONFIRM, entity: 'evidence-confirm', target: { assignmentId: ASSIGNMENT, evidenceId: EVIDENCE_ID }, baseVersion: 3, dependsOn: [AUTHORIZE], payload: {} },
      ],
    },
    'subject-1',
  );
}

describe('push overlay', () => {
  it('applies operations in dependency order', async () => {
    const repository = new MemoryRepository();
    const owner = new ScriptedOwner();
    const push = new PushOverlay(repository, owner);
    await repository.save(threeStepOverlay());

    const summary = await push.push('subject-1', OVERLAY, 'user-token');
    expect(owner.calls).toEqual([ADVANCE, AUTHORIZE, CONFIRM]);
    expect(summary.applied).toEqual([ADVANCE, AUTHORIZE, CONFIRM]);
    expect(summary.failed).toEqual([]);
  });

  it('never skips ahead when the first step is rejected', async () => {
    const repository = new MemoryRepository();
    const owner = new ScriptedOwner().respond(ADVANCE, { status: 403, code: 'EXECUTION_ACCESS_DENIED', body: { code: 'EXECUTION_ACCESS_DENIED' } });
    const push = new PushOverlay(repository, owner);
    await repository.save(threeStepOverlay());

    const summary = await push.push('subject-1', OVERLAY, 'user-token');
    expect(owner.calls).toEqual([ADVANCE]);
    expect(summary.failed).toEqual([{ operationId: ADVANCE, state: 'rejected', status: 403, code: 'EXECUTION_ACCESS_DENIED' }]);
    expect(summary.pending).toEqual([AUTHORIZE, CONFIRM]);
  });

  it('keeps a session failure pending so it can be retried', async () => {
    const repository = new MemoryRepository();
    const owner = new ScriptedOwner().respond(ADVANCE, { status: 401, code: 'UNAUTHENTICATED', body: {} }, { status: 200, code: 'OK', body: {} });
    const push = new PushOverlay(repository, owner);
    await repository.save(threeStepOverlay());

    const first = await push.push('subject-1', OVERLAY, 'user-token');
    expect(first.pending).toContain(ADVANCE);
    expect(first.applied).toEqual([]);

    const second = await push.push('subject-1', OVERLAY, 'user-token');
    expect(second.applied).toContain(ADVANCE);
    expect(owner.count(ADVANCE)).toBe(1);
  });

  it('does not duplicate when the owner applied the change but the response was lost', async () => {
    const repository = new MemoryRepository();
    // The owner applied it; the coordinator only saw a transport error. The retry returns a replay.
    const owner = new ScriptedOwner().respond(
      ADVANCE,
      { status: 503, code: 'SERVICE_UNAVAILABLE', body: {} },
      { status: 200, code: 'OK', body: { replayed: true } },
    );
    const push = new PushOverlay(repository, owner);
    await repository.save(threeStepOverlay());

    const first = await push.push('subject-1', OVERLAY, 'user-token');
    expect(first.pending).toContain(ADVANCE);
    const retry = await push.push('subject-1', OVERLAY, 'user-token');
    expect(retry.applied).toContain(ADVANCE);
    expect(retry.operations.find(operation => operation.operationId === ADVANCE)?.attempts.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps a version conflict visible and never retries it', async () => {
    const repository = new MemoryRepository();
    const owner = new ScriptedOwner().respond(ADVANCE, { status: 409, code: 'VERSION_CONFLICT', body: {} });
    const push = new PushOverlay(repository, owner);
    await repository.save(threeStepOverlay());

    const first = await push.push('subject-1', OVERLAY, 'user-token');
    const second = await push.push('subject-1', OVERLAY, 'user-token');
    expect(first.failed[0]).toMatchObject({ operationId: ADVANCE, state: 'conflict' });
    expect(second.failed[0]).toMatchObject({ operationId: ADVANCE, state: 'conflict' });
    expect(owner.calls.filter(id => id === ADVANCE)).toHaveLength(1);
  });

  it('does not expose another subject overlay', async () => {
    const repository = new MemoryRepository();
    await repository.save(threeStepOverlay());
    expect(await repository.byId('subject-2', OVERLAY)).toBeUndefined();
    expect(await repository.operationsByOverlay('subject-2', OVERLAY)).toEqual([]);
  });

  it('orders operations deterministically even with independent branches', () => {
    const operations = [
      { operationId: 'b', dependsOn: [], state: 'pending' },
      { operationId: 'a', dependsOn: [], state: 'pending' },
    ] as unknown as StoredOperation[];
    expect(orderByDependencies(operations).map(operation => operation.operationId)).toEqual(['b', 'a']);
  });
});
