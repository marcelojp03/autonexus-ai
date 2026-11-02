/**
 * Push an overlay: apply pending operations in dependency order, one owner call at a time.
 *
 * Rules enforced here (contracts/sync/overlay.md):
 *  - an operation is only attempted when every dependency is `applied`;
 *  - terminal states are never retried, so a rejection or a conflict stays visible;
 *  - a 401 keeps the operation pending (the client renews the session) and a 503 keeps it pending too;
 *  - the token is passed through per call and never stored.
 */

import { TERMINAL, classify, type StoredOperation, type SyncState } from '../domain/overlay.js';
import type { OverlayRepository, OwnerClient } from './ports.js';
import { sanitize } from '../infrastructure/owners/http-owner-client.js';

const sanitizeBody = (body: unknown): Record<string, unknown> | undefined => sanitize(body);

export interface OperationResult {
  readonly operationId: string;
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
}

export interface PushSummary {
  readonly overlayId: string;
  readonly results: OperationResult[];
  readonly applied: string[];
  readonly pending: string[];
  readonly failed: { operationId: string; state: SyncState; status: number; code: string }[];
  readonly operations: StoredOperation[];
}

export class PushOverlay {
  constructor(
    private readonly repository: OverlayRepository,
    private readonly owner: OwnerClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async push(subject: string, overlayId: string, token: string): Promise<PushSummary> {
    const operations = await this.repository.operationsByOverlay(subject, overlayId);
    const state = new Map(operations.map(item => [item.operationId, item.state]));
    const results: OperationResult[] = [];
    const applied: string[] = [];
    const pending: string[] = [];
    const failed: { operationId: string; state: SyncState; status: number; code: string }[] = [];
    const ordered = orderByDependencies(operations);

    for (const operation of ordered) {
      if (TERMINAL.includes(operation.state)) {
        if (operation.state === 'applied') applied.push(operation.operationId);
        else failed.push({ operationId: operation.operationId, state: operation.state, status: operation.lastResult?.status ?? 0, code: operation.lastResult?.code ?? '' });
        continue;
      }
      if (!operation.dependsOn.every(dependency => state.get(dependency) === 'applied')) {
        pending.push(operation.operationId);
        continue;
      }

      const attempt = { ...operation, state: 'sending' as SyncState, attempts: [...operation.attempts, { at: this.now().toISOString(), outcome: 'sending' }] };
      await this.repository.update(attempt);

      const result = await this.owner.apply(attempt, token);
      const next = classify(result.status, result.code);
      const updated: StoredOperation = {
        ...attempt,
        state: next,
        lastResult: { status: result.status, code: result.code },
        lastBody: sanitizeBody(result.body),
        attempts: [...attempt.attempts, { at: this.now().toISOString(), outcome: next }],
      };
      await this.repository.update(updated);
      state.set(updated.operationId, next);
      // The client gets the owner's body (e.g. the presigned upload) in this response only; the
      // stored copy is sanitized by the adapter.
      results.push({ operationId: updated.operationId, status: result.status, code: result.code, body: result.body });

      if (next === 'applied') applied.push(updated.operationId);
      else if (next === 'pending') pending.push(updated.operationId);
      else failed.push({ operationId: updated.operationId, state: next, status: result.status, code: result.code });
    }

    return { overlayId, results, applied, pending, failed, operations: await this.repository.operationsByOverlay(subject, overlayId) };
  }
}

/** Stable topological order; the overlay validation already rejected cycles. */
export function orderByDependencies(operations: readonly StoredOperation[]): StoredOperation[] {
  const byId = new Map(operations.map(item => [item.operationId, item]));
  const ordered: StoredOperation[] = [];
  const placed = new Set<string>();
  let progressed = true;
  while (ordered.length < operations.length && progressed) {
    progressed = false;
    for (const operation of operations) {
      if (placed.has(operation.operationId)) continue;
      if (operation.dependsOn.every(dependency => placed.has(dependency) || !byId.has(dependency))) {
        ordered.push(operation);
        placed.add(operation.operationId);
        progressed = true;
      }
    }
  }
  // Any operation left over is unreachable through its dependencies; keep it at the end so the state
  // stays visible instead of silently disappearing.
  for (const operation of operations) if (!placed.has(operation.operationId)) ordered.push(operation);
  return ordered;
}
