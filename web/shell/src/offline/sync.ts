import type { EvidenceUploadTarget, SessionPort } from '../../../../contracts/auth/session.ts';
import type { OfflineStore, QueuedAdvance } from './store.ts';

export const REGISTER_SYNC = `mutation RegisterOfflineSync($input: RegisterOfflineSyncInput!) {
  registerOfflineSync(input: $input) { overlay { overlayId } replayed replayedOperations }
}`;
export const PUSH_SYNC = `mutation PushOfflineSync($overlayId: UUID!) {
  pushOfflineSync(overlayId: $overlayId) {
    overlayId operations { operationId entity state attemptCount lastStatus lastCode }
    applied pending failed { operationId state status code } resultsJson
  }
}`;
export const LOOKUP_SYNC = `query OfflineSyncOperation($operationId: UUID!) {
  offlineSyncOperation(operationId: $operationId) {
    overlayId operation { operationId entity state attemptCount lastStatus lastCode resultJson }
  }
}`;
export const EXECUTION_VERSION = `query OfflineSyncExecution($assignmentId: UUID!) {
  myExecution(assignmentId: $assignmentId) {
    assignmentId version advances { id evidences { id version state attempt failureCode } }
  }
}`;

type Json = Record<string, unknown>;
type State = QueuedAdvance['state'];
type Outcome = { applied: number; pending: number; failed: number };
type Operation = { operationId: string; entity: string; target: Json; baseVersion: number;
  dependsOn: string[]; payload: Json; file?: Json; clientInference?: QueuedAdvance['clientInference'] };
type Step = { input: { overlayId: string; deviceId: string; createdAt: string; operationsJson: string }; registered?: boolean };
type Progress = { steps: Record<string, Step>; advanceId?: string; evidenceId?: string;
  attempt?: number; evidenceState?: string; inferenceApplied?: boolean };

class Paused extends Error {
  state: State;
  code: string;
  constructor(state: State, code: string) { super(code); this.state = state; this.code = code; }
}
class SessionChanged extends Error {}
const active = new WeakMap<OfflineStore, Map<string, Promise<Outcome>>>();
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const rows = (value: unknown): Json[] => Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const malformed = (): never => { throw new Paused('pending', 'SYNC_RESULT_UNAVAILABLE'); };
const terminal = (state: State) => ['applied', 'conflict', 'rejected'].includes(state);

function classify(status: number, code: string): State {
  if (status === 401 || status >= 500 || status === 0) return 'pending';
  if (['EVIDENCE_UPLOAD_EXPIRED', 'EVIDENCE_NOT_PENDING', 'EVIDENCE_OBJECT_MISSING'].includes(code)) return 'needs-reupload';
  if (['CHECKLIST_INCOMPLETE', 'EVIDENCE_STATE_CONFLICT', 'EVIDENCE_ATTEMPTS_EXHAUSTED', 'VALIDATION_ERROR'].includes(code)) return 'rejected';
  return status === 409 ? 'conflict' : 'rejected';
}

async function derivedId(seed: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))).slice(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function syncPending(store: OfflineStore, session: SessionPort, subject: string): Promise<Outcome> {
  let subjects = active.get(store);
  if (!subjects) { subjects = new Map(); active.set(store, subjects); }
  const running = subjects.get(subject);
  if (running) return running;
  const result = synchronize(store, session, subject).finally(() => subjects.delete(subject));
  subjects.set(subject, result);
  return result;
}

async function synchronize(store: OfflineStore, session: SessionPort, subject: string): Promise<Outcome> {
  const outcome: Outcome = { applied: 0, pending: 0, failed: 0 };
  let changed = false;
  const isCurrent = () => {
    const snapshot = session.snapshot();
    return snapshot.authenticated && snapshot.phase === 'authenticated' && snapshot.identity?.subject === subject;
  };
  if (!isCurrent()) return outcome;
  const unsubscribe = session.subscribe(snapshot => {
    if (!snapshot.authenticated || snapshot.phase !== 'authenticated' || snapshot.identity?.subject !== subject) changed = true;
  });
  const guard = () => { if (changed || !isCurrent()) throw new SessionChanged(); };
  async function checked<T>(action: () => Promise<T>): Promise<T> {
    guard();
    try { const result = await action(); guard(); return result; }
    catch (error) { guard(); throw error; }
  }
  async function business(query: string, variables: Json, field: string): Promise<Json> {
    const result = await checked(() => session.requestBusiness(query, variables));
    const failure = result.errors?.[0];
    if (failure) throw new Paused(classify(failure.statusCode, failure.code), failure.code);
    const body = record(record(result.data)[field]);
    if (!Object.keys(body).length) malformed();
    return body;
  }

  try {
    const queue = await checked(() => store.queue(subject));
    for (const item of queue) {
      guard();
      if (item.subject !== subject || terminal(item.state)) continue;
      const progress = (item.progress ?? { steps: {} }) as Progress;
      progress.steps ??= {};
      async function save(state: State = 'sending', code?: string): Promise<void> {
        await checked(() => store.update({ ...item, state, lastCode: code, progress }));
        item.state = state;
      }
      async function fresh(): Promise<void> {
        const works = await checked(() => store.works(subject));
        const work = works.find(work => work.subject === subject && work.assignmentId === item.assignmentId);
        if (!work || !(Date.parse(work.expiresAt) > Date.now())) throw new Paused('pending', 'OFFLINE_WORK_EXPIRED');
      }
      async function network(query: string, variables: Json, field: string): Promise<Json> {
        await fresh();
        return business(query, variables, field);
      }
      async function lookup(operation: Operation, step: Step): Promise<Json | undefined> {
        let found: Json;
        try { found = await network(LOOKUP_SYNC, { operationId: operation.operationId }, 'offlineSyncOperation'); }
        catch (error) {
          if (error instanceof Paused && error.code === 'OPERATION_NOT_FOUND') return undefined;
          throw error;
        }
        const stored = record(found.operation);
        if (stored.operationId !== operation.operationId || stored.entity !== operation.entity || !text(found.overlayId)) malformed();
        if (step.input.overlayId !== found.overlayId || !step.registered) {
          step.input.overlayId = found.overlayId as string;
          step.registered = true;
          await save();
        }
        const state = text(stored.state);
        if (state === 'applied') return record(JSON.parse(text(stored.resultJson) ?? '{}'));
        if (state === 'conflict' || state === 'rejected' || state === 'needs-reupload') {
          throw new Paused(state, text(stored.lastCode) ?? 'SYNC_REJECTED');
        }
        if (state !== 'pending' && state !== 'sending') malformed();
        return undefined;
      }
      async function apply(operation: Operation): Promise<Json> {
        const id = operation.operationId;
        let step = progress.steps[id];
        if (step) {
          // The stored body is immutable, including optimistic versions, across an ambiguous retry.
          operation = JSON.parse(step.input.operationsJson)[0] as Operation;
          const recovered = await lookup(operation, step);
          if (recovered) return recovered;
        } else {
          step = { input: { overlayId: crypto.randomUUID(), deviceId: 'shell-offline',
            createdAt: item.createdAt, operationsJson: JSON.stringify([operation]) } };
          progress.steps[id] = step;
          item.overlayId ??= step.input.overlayId;
          await save();
        }
        if (!step.registered) {
          const registered = await network(REGISTER_SYNC, { input: step.input }, 'registerOfflineSync');
          if (record(registered.overlay).overlayId !== step.input.overlayId || !Array.isArray(registered.replayedOperations)) malformed();
          step.registered = true;
          await save();
          if (Array.isArray(registered.replayedOperations) && registered.replayedOperations.includes(id)) {
            const recovered = await lookup(operation, step);
            if (recovered) return recovered;
          }
        }
        const pushed = await network(PUSH_SYNC, { overlayId: step.input.overlayId }, 'pushOfflineSync');
        if (pushed.overlayId !== step.input.overlayId) malformed();
        const failure = rows(pushed.failed).find(row => row.operationId === id);
        if (failure) {
          const status = typeof failure.status === 'number' ? failure.status : 0;
          const code = text(failure.code) ?? 'SYNC_REJECTED';
          throw new Paused(classify(status, code), code);
        }
        const results: unknown = JSON.parse(text(pushed.resultsJson) ?? 'null');
        const result = rows(results).find(row => row.operationId === id);
        if (Array.isArray(pushed.applied) && pushed.applied.includes(id)) {
          if (result && typeof result.status === 'number' && result.status >= 200 && result.status < 300) return record(result.body);
          const recovered = await lookup(operation, step);
          if (recovered) return recovered;
          malformed();
        }
        throw new Paused('pending', text(result?.code) ?? 'SYNC_RESULT_UNAVAILABLE');
      }
      async function op(entity: string, suffix: string, target: Json, payload: Json, version = item.baseVersion, extra: Json = {}): Promise<Json> {
        const operationId = suffix === 'advance' ? item.operationId : await checked(() => derivedId(`${item.operationId}:${suffix}`));
        return apply({ operationId, entity, target: { assignmentId: item.assignmentId, ...target },
          baseVersion: version, dependsOn: [], payload: { operationId, ...payload }, ...extra });
      }
      async function evidenceVersion(): Promise<{ execution: number; evidence: number }> {
        const execution = await network(EXECUTION_VERSION, { assignmentId: item.assignmentId }, 'myExecution');
        const advance = rows(execution.advances).find(row => row.id === progress.advanceId);
        const evidence = rows(advance?.evidences).find(row => row.id === progress.evidenceId);
        if (execution.assignmentId !== item.assignmentId || !integer(execution.version) || !integer(evidence?.version)) malformed();
        return { execution: execution.version as number, evidence: evidence!.version as number };
      }
      async function versionedOp(entity: string, suffix: string, payload: Json, extra: Json = {}): Promise<Json> {
        const id = await checked(() => derivedId(`${item.operationId}:${suffix}`));
        const existing = progress.steps[id];
        if (existing) return apply(JSON.parse(existing.input.operationsJson)[0] as Operation);
        const version = await evidenceVersion();
        return op(entity, suffix, { evidenceId: progress.evidenceId },
          { ...payload, expectedVersion: version.evidence }, version.execution, extra);
      }
      try {
        await fresh();
        let file: Json | undefined;
        let filePayload: Json = {};
        if (item.photo) {
          const bytes = await checked(() => item.photo!.arrayBuffer());
          const digest = new Uint8Array(await checked(() => crypto.subtle.digest('SHA-256', bytes)));
          const hash = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
          if ((item.photoSha256 && item.photoSha256 !== hash) || (item.clientInference && item.clientInference.imageSha256 !== hash)) {
            throw new Paused('rejected', 'LOCAL_EVIDENCE_CHECKSUM_MISMATCH');
          }
          file = { sha256: hash, bytes: item.photo.size, contentType: item.photo.type || 'image/jpeg' };
          filePayload = { fileName: 'inspection.jpg', contentType: file.contentType, sizeBytes: item.photo.size,
            checksumSha256: btoa(String.fromCharCode(...digest)) };
        } else if (item.clientInference) throw new Paused('rejected', 'LOCAL_EVIDENCE_MISSING');
        if (!progress.advanceId) {
          const body = await op('advance', 'advance', {}, { expectedVersion: item.baseVersion,
            description: item.description, minutesWorked: item.minutesWorked });
          const id = text(record(body.advance).id);
          if (!id) malformed();
          progress.advanceId = id;
          await save();
        }
        if (item.photo) {
          let upload: EvidenceUploadTarget | undefined;
          function acceptEvidence(body: Json, expectedAttempt: number): void {
            const evidence = record(body.evidence);
            const id = text(evidence.id);
            if (!id || !integer(evidence.attempt) || evidence.attempt !== expectedAttempt || evidence.attempt > 5 || !integer(evidence.version)
              || (progress.evidenceId && progress.evidenceId !== id)) malformed();
            progress.evidenceId = id;
            progress.attempt = evidence.attempt as number;
            progress.evidenceState = 'authorized';
            const raw = record(body.upload);
            const headers = record(typeof raw.headersJson === 'string' ? JSON.parse(raw.headersJson) : raw.headers);
            if (text(raw.url) && raw.url !== '[redacted]' && raw.method === 'PUT' && text(raw.expiresAt)
              && Object.entries(headers).every(([key, value]) => key.toLowerCase() !== 'authorization' && typeof value === 'string')) {
              upload = { url: raw.url as string, method: 'PUT', expiresAt: raw.expiresAt as string, headers: headers as Record<string, string> };
            }
          }
          if (!progress.evidenceId) {
            acceptEvidence(await op('evidence-authorize', 'evidence-authorize', { advanceId: progress.advanceId }, filePayload, item.baseVersion, { file }), 1);
            await save();
          }
          if (progress.evidenceState === 'failed') {
            if (progress.attempt! >= 5) throw new Paused('rejected', 'EVIDENCE_ATTEMPTS_EXHAUSTED');
            const nextAttempt = progress.attempt! + 1;
            acceptEvidence(await versionedOp('evidence-reauthorize', `evidence-reauthorize:${nextAttempt}`, filePayload, { file }), nextAttempt);
            await save();
          }
          if (progress.evidenceState !== 'available') {
            if (upload) {
              // Persist uncertainty before PUT: a crash must confirm this evidence, not create a new one.
              progress.evidenceState = 'put-started';
              await save();
              await fresh();
              const uploaded = await checked(() => session.uploadEvidence(upload!, item.photo!));
              if (!(uploaded.completed && uploaded.status >= 200 && uploaded.status < 300) && uploaded.status !== 412) {
                throw new Paused('pending', 'EVIDENCE_UPLOAD_UNCONFIRMED');
              }
            }
            try {
              const body = await versionedOp('evidence-confirm', `evidence-confirm:${progress.attempt}`, {});
              const evidence = record(body.evidence);
              if (evidence.id !== progress.evidenceId || evidence.state !== 'available' || !integer(evidence.version)) malformed();
              progress.evidenceState = 'available';
              await save();
            } catch (error) {
              if (error instanceof Paused && error.state === 'needs-reupload') { progress.evidenceState = 'failed'; await save('needs-reupload', error.code); }
              throw error;
            }
          }
          if (item.clientInference && !progress.inferenceApplied) {
            const body = await op('client-inference', 'client-inference', { evidenceId: progress.evidenceId }, {}, item.baseVersion,
              { clientInference: item.clientInference });
            if (!text(body.analysisId) || body.assignmentId !== item.assignmentId || body.evidenceId !== progress.evidenceId) malformed();
            progress.inferenceApplied = true;
            await save();
          }
        }
        await save('applied');
        outcome.applied++;
      } catch (error) {
        guard();
        const failure = error instanceof Paused ? error : new Paused('pending', 'SERVICE_UNAVAILABLE');
        await save(failure.state, failure.code);
        if (failure.state === 'rejected' || failure.state === 'conflict') outcome.failed++;
        else outcome.pending++;
      }
    }
  } catch (error) {
    if (!(error instanceof SessionChanged)) throw error;
  } finally { unsubscribe(); }
  return outcome;
}
