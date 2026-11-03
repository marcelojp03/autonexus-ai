/** Ports of MS05: the store keeps intent/results, the owner applies the business rules. */

import type { Overlay, OverlayOperation, StoredOperation } from '../domain/overlay.js';

export interface OwnerResult {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;
}

export interface OwnerClient {
  /** Applies one operation with the *user's* token. It never receives or returns credentials. */
  apply(operation: StoredOperation, token: string): Promise<OwnerResult>;
}

export interface OverlayRepository {
  /** Readiness probe: the store answered, nothing else. */
  ready(): Promise<boolean>;
  /** Creates the table when it does not exist (DynamoDB Local has no migrations). */
  ensureTable(): Promise<void>;
  /** Stores the overlay; returns `replayed: true` when the overlayId already existed for this subject. */
  save(overlay: Overlay, expiresAt: number): Promise<{ replayed: boolean; replayedOperations: string[] }>;
  byId(subject: string, overlayId: string): Promise<{ overlay: Overlay; operations: StoredOperation[] } | undefined>;
  operationsByOverlay(subject: string, overlayId: string): Promise<StoredOperation[]>;
  operation(subject: string, operationId: string): Promise<StoredOperation | undefined>;
  update(operation: StoredOperation): Promise<void>;
}
