/** Domain types and validation for the offline overlay contract (contracts/sync/overlay.md). */

export const ENTITIES = ['advance', 'evidence-authorize', 'evidence-reauthorize', 'evidence-confirm', 'client-inference'] as const;
export type Entity = (typeof ENTITIES)[number];

export const STATES = ['pending', 'sending', 'applied', 'needs-reupload', 'conflict', 'rejected'] as const;
export type SyncState = (typeof STATES)[number];

export const TERMINAL: readonly SyncState[] = ['applied', 'conflict', 'rejected'];

export interface OverlayFile {
  readonly sha256: string;
  readonly bytes: number;
  readonly contentType: string;
}

export interface ClientInference {
  readonly runId: string;
  readonly modelVersion: string;
  readonly imageSha256: string;
  readonly labels: readonly { readonly name: string; readonly score: number }[];
  readonly humanReview?: { readonly modelVersion: string; readonly labels: readonly string[] };
}

export interface OverlayOperation {
  readonly operationId: string;
  readonly entity: Entity;
  readonly target: { readonly assignmentId: string; readonly advanceId?: string; readonly evidenceId?: string };
  readonly baseVersion: number;
  readonly dependsOn: readonly string[];
  readonly payload: Record<string, unknown>;
  readonly file?: OverlayFile;
  readonly clientInference?: ClientInference;
}

export interface Overlay {
  readonly overlayId: string;
  readonly subject: string;
  readonly deviceId: string;
  readonly createdAt: string;
  readonly operations: readonly OverlayOperation[];
}

/** Stored shape: intent plus the coordinator's bookkeeping. Never contains a bearer token. */
export interface StoredOperation extends OverlayOperation {
  readonly overlayId: string;
  readonly subject: string;
  readonly state: SyncState;
  readonly attempts: readonly { readonly at: string; readonly outcome: string }[];
  readonly lastResult?: { readonly status: number; readonly code: string };
  readonly lastBody?: Record<string, unknown>;
  readonly expiresAt: number;
}

export class SyncError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: string) {
    super(code);
    this.name = 'SyncError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64 = /^[a-f0-9]{64}$/i;

function fail(details: string): never {
  throw new SyncError(400, 'VALIDATION_ERROR', details);
}

function closedKeys(value: unknown, allowed: readonly string[], where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${where} must be an object`);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!allowed.includes(key)) fail(`${where}.${key} is not allowed`);
  return record;
}

function uuid(value: unknown, where: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) fail(`${where} must be a UUID`);
  return value;
}

function text(value: unknown, where: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${where} must be a non-empty string`);
  return value;
}

function version(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) fail(`${where} must be a non-negative integer`);
  return value;
}

const OPERATION_KEYS = ['operationId', 'entity', 'target', 'baseVersion', 'dependsOn', 'payload', 'file', 'clientInference'] as const;

export function operation(value: unknown, overlayId: string): OverlayOperation {
  const record = closedKeys(value, OPERATION_KEYS, 'operation');
  const entity = record['entity'];
  if (typeof entity !== 'string' || !ENTITIES.includes(entity as Entity)) fail('operation.entity is not published');
  const target = closedKeys(record['target'], ['assignmentId', 'advanceId', 'evidenceId'], 'operation.target');
  const dependsOn = Array.isArray(record['dependsOn']) ? record['dependsOn'] : fail('operation.dependsOn must be an array');
  const payload = record['payload'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('operation.payload must be an object');

  let file: OverlayFile | undefined;
  if (record['file'] !== undefined) {
    const raw = closedKeys(record['file'], ['sha256', 'bytes', 'contentType'], 'operation.file');
    if (typeof raw['sha256'] !== 'string' || !HEX64.test(raw['sha256'])) fail('operation.file.sha256 must be a sha256 hex');
    if (typeof raw['bytes'] !== 'number' || !Number.isInteger(raw['bytes']) || raw['bytes'] <= 0) fail('operation.file.bytes must be positive');
    file = { sha256: raw['sha256'], bytes: raw['bytes'], contentType: text(raw['contentType'], 'operation.file.contentType', 64) };
  }
  const fileEntities: readonly Entity[] = ['evidence-authorize', 'evidence-reauthorize'];
  if (file && !fileEntities.includes(entity as Entity)) fail('operation.file only belongs to evidence authorization');
  if (fileEntities.includes(entity as Entity) && !file) fail('evidence authorization requires operation.file');
  if (entity === 'evidence-authorize' && target['advanceId'] === undefined) fail('evidence-authorize requires target.advanceId');
  if (['evidence-reauthorize', 'evidence-confirm', 'client-inference'].includes(entity as string) && target['evidenceId'] === undefined) fail('operation requires target.evidenceId');

  let clientInference: ClientInference | undefined;
  if (record['clientInference'] !== undefined) {
    const raw = closedKeys(record['clientInference'], ['runId', 'modelVersion', 'imageSha256', 'labels', 'humanReview'], 'operation.clientInference');
    if (typeof raw['imageSha256'] !== 'string' || !HEX64.test(raw['imageSha256'])) fail('operation.clientInference.imageSha256 must be a sha256 hex');
    if (!Array.isArray(raw['labels'])) fail('operation.clientInference.labels must be an array');
    const modelVersion = text(raw['modelVersion'], 'operation.clientInference.modelVersion', 80);
    let humanReview: ClientInference['humanReview'];
    if (raw['humanReview'] !== undefined) {
      const review = closedKeys(raw['humanReview'], ['modelVersion', 'labels'], 'operation.clientInference.humanReview');
      const reviewVersion = text(review['modelVersion'], 'operation.clientInference.humanReview.modelVersion', 80);
      if (reviewVersion !== modelVersion) fail('human review modelVersion must match the prediction');
      if (!Array.isArray(review['labels']) || review['labels'].length > 32) fail('human review labels must be an array of at most 32 items');
      const labels = review['labels'].map(label => text(label, 'human review label', 40));
      if (new Set(labels).size !== labels.length) fail('human review labels must be unique');
      humanReview = { modelVersion: reviewVersion, labels };
    }
    clientInference = {
      runId: text(raw['runId'], 'operation.clientInference.runId', 64),
      modelVersion,
      imageSha256: raw['imageSha256'],
      labels: raw['labels'].map(label => {
        const entry = closedKeys(label, ['name', 'score'], 'operation.clientInference.labels[]');
        if (typeof entry['score'] !== 'number' || entry['score'] < 0 || entry['score'] > 1) fail('label score must be within [0,1]');
        return { name: text(entry['name'], 'label.name', 40), score: entry['score'] };
      }),
      ...(humanReview ? { humanReview } : {}),
    };
    if (entity !== 'client-inference') fail('clientInference only belongs to the client-inference entity');
  }
  if (entity === 'client-inference' && !clientInference) fail('client-inference requires clientInference');

  return {
    operationId: uuid(record['operationId'], 'operation.operationId'),
    entity: entity as Entity,
    target: {
      assignmentId: uuid(target['assignmentId'], 'operation.target.assignmentId'),
      ...(target['advanceId'] === undefined ? {} : { advanceId: uuid(target['advanceId'], 'operation.target.advanceId') }),
      ...(target['evidenceId'] === undefined ? {} : { evidenceId: uuid(target['evidenceId'], 'operation.target.evidenceId') }),
    },
    baseVersion: version(record['baseVersion'], 'operation.baseVersion'),
    dependsOn: dependsOn.map(item => uuid(item, 'operation.dependsOn[]')),
    payload: payload as Record<string, unknown>,
    ...(file ? { file } : {}),
    ...(clientInference ? { clientInference } : {}),
  };
}

export function overlay(value: unknown, subject: string): Overlay {
  const record = closedKeys(value, ['overlayId', 'deviceId', 'createdAt', 'operations'], 'overlay');
  if (!Array.isArray(record['operations']) || record['operations'].length === 0) fail('overlay.operations must not be empty');
  if (record['operations'].length > 50) fail('overlay.operations exceeds 50 items');
  const overlayId = uuid(record['overlayId'], 'overlay.overlayId');
  const operations = record['operations'].map(item => operation(item, overlayId));

  const ids = new Set<string>();
  for (const item of operations) {
    if (ids.has(item.operationId)) fail('operationId must be unique inside an overlay');
    ids.add(item.operationId);
  }
  for (const item of operations) {
    for (const dependency of item.dependsOn) {
      if (!ids.has(dependency)) fail('dependsOn must reference an operation of the same overlay');
      if (dependency === item.operationId) fail('an operation cannot depend on itself');
    }
  }
  assertAcyclic(operations);

  const createdAt = record['createdAt'];
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) fail('overlay.createdAt must be an ISO-8601 instant');
  return { overlayId, subject, deviceId: text(record['deviceId'], 'overlay.deviceId', 64), createdAt, operations };
}

/** Kahn's algorithm: a cycle would make every push ambiguous. */
function assertAcyclic(operations: readonly OverlayOperation[]): void {
  const remaining = new Map(operations.map(item => [item.operationId, new Set(item.dependsOn)]));
  let progressed = true;
  while (progressed && remaining.size > 0) {
    progressed = false;
    for (const [id, dependencies] of [...remaining]) {
      const pending = [...dependencies].filter(dependency => remaining.has(dependency));
      if (pending.length === 0) {
        remaining.delete(id);
        progressed = true;
      }
    }
  }
  if (remaining.size > 0) fail('dependsOn contains a cycle');
}

/** Classification shared by the coordinator and its tests (contracts/sync/overlay.md). */
export function classify(status: number, code: string): SyncState {
  if (status === 401) return 'pending';
  if (status === 503) return 'pending';
  if (code === 'VERSION_CONFLICT' || code === 'IDEMPOTENCY_CONFLICT') return 'conflict';
  if (code === 'EVIDENCE_UPLOAD_EXPIRED' || code === 'EVIDENCE_NOT_PENDING' || code === 'EVIDENCE_OBJECT_MISSING') return 'needs-reupload';
  if (status === 403 || status === 404) return 'rejected';
  if (status === 409) return 'conflict';
  if (status >= 400) return 'rejected';
  return 'applied';
}
