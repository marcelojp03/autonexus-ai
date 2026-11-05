import { validateOfflineRecords } from './transfer.ts';

export interface PreparedWork {
  subject: string;
  assignmentId: string;
  orderId: string;
  orderNumber: string;
  version: number;
  preparedAt: string;
  expiresAt: string;
}

export interface QueuedAdvance {
  operationId: string;
  subject: string;
  assignmentId: string;
  baseVersion: number;
  description: string;
  minutesWorked: number;
  createdAt: string;
  state: 'pending' | 'sending' | 'applied' | 'conflict' | 'rejected' | 'needs-reupload';
  photo?: Blob;
  photoSha256?: string;
  clientInference?: {
    runId: string;
    modelVersion: string;
    imageSha256: string;
    labels: { name: string; score: number }[];
    humanReview?: { modelVersion: string; labels: string[] };
  };
  overlayId?: string;
  lastCode?: string;
  progress?: Record<string, unknown>;
}

export interface OfflineStore {
  works(subject: string): Promise<PreparedWork[]>;
  saveWork(work: PreparedWork): Promise<void>;
  queue(subject: string): Promise<QueuedAdvance[]>;
  enqueue(item: QueuedAdvance): Promise<void>;
  update(item: QueuedAdvance): Promise<void>;
  forget(subject: string): Promise<void>;
  localSubject(): Promise<string | null>;
  setLocalSubject(subject: string): Promise<void>;
  recoverInterrupted(subject: string): Promise<void>;
  restoreCopy(copy: { subject: string; works: PreparedWork[]; queue: QueuedAdvance[] }): Promise<void>;
  close(): void;
}

function requireSubject(subject: string): void {
  if (typeof subject !== 'string' || !subject.trim()) throw new Error('OFFLINE_SUBJECT_REQUIRED');
}

export function withoutCredentials(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || value instanceof Blob || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (/token|authorization|password|credential|cookie|secret|presigned|signedurl/i.test(key)) {
      throw new Error('OFFLINE_CREDENTIAL_FIELD');
    }
    withoutCredentials(child, seen);
    if (key === 'operationsJson' && typeof child === 'string') withoutCredentials(JSON.parse(child), seen);
  }
}

function workRecord(work: PreparedWork): PreparedWork {
  requireSubject(work.subject);
  withoutCredentials(work);
  const { subject, assignmentId, orderId, orderNumber, version, preparedAt, expiresAt } = work;
  if (!assignmentId || !orderId || !orderNumber || !Number.isInteger(version)
    || !Number.isFinite(Date.parse(preparedAt)) || !Number.isFinite(Date.parse(expiresAt))) {
    throw new Error('OFFLINE_WORK_INVALID');
  }
  return { subject, assignmentId, orderId, orderNumber, version, preparedAt, expiresAt };
}

function advanceRecord(item: QueuedAdvance): QueuedAdvance {
  requireSubject(item.subject);
  withoutCredentials(item);
  const { operationId, subject, assignmentId, baseVersion, description, minutesWorked, createdAt,
    state, photo, photoSha256, clientInference, overlayId, lastCode, progress } = item;
  if (!operationId || !assignmentId || !Number.isInteger(baseVersion)
    || typeof description !== 'string' || !Number.isFinite(minutesWorked) || minutesWorked < 0
    || !Number.isFinite(Date.parse(createdAt))
    || !['pending', 'sending', 'applied', 'conflict', 'rejected', 'needs-reupload'].includes(state)
    || (photo !== undefined && !(photo instanceof Blob))) throw new Error('OFFLINE_ADVANCE_INVALID');
  return structuredClone({ operationId, subject, assignmentId, baseVersion, description, minutesWorked,
    createdAt, state, photo, photoSha256, clientInference, overlayId, lastCode, progress });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

export async function openOfflineStore(): Promise<OfflineStore> {
  const opening = indexedDB.open('autonexus-offline', 1);
  opening.onupgradeneeded = () => {
    const db = opening.result;
    db.createObjectStore('works', { keyPath: ['subject', 'assignmentId'] }).createIndex('subject', 'subject');
    db.createObjectStore('queue', { keyPath: 'operationId' }).createIndex('subject', 'subject');
    db.createObjectStore('local_state');
  };
  const db = await request(opening);
  db.onversionchange = () => db.close();

  async function transaction<T>(names: string[], mode: IDBTransactionMode,
    action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = db.transaction(names, mode);
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('OFFLINE_TRANSACTION_ABORTED'));
    });
    const result = (async () => {
      try { return await action(tx); }
      catch (error) { try { tx.abort(); } catch { /* Already aborted or completed. */ } throw error; }
    })();
    const [value] = await Promise.all([result, committed]);
    return value;
  }

  async function bySubject<T>(name: string, subject: string): Promise<T[]> {
    requireSubject(subject);
    return transaction([name], 'readonly', tx => request(tx.objectStore(name).index('subject').getAll(subject)));
  }

  async function writeAdvance(item: QueuedAdvance, replace: boolean): Promise<void> {
    const record = advanceRecord(item);
    return transaction(['queue'], 'readwrite', async tx => {
      const store = tx.objectStore('queue');
      const previous: QueuedAdvance | undefined = await request(store.get(record.operationId));
      if (previous && previous.subject !== record.subject) throw new Error('OFFLINE_OWNER_MISMATCH');
      if (!replace && previous) throw new Error('OFFLINE_DUPLICATE_OPERATION');
      if (replace && !previous) throw new Error('OFFLINE_OPERATION_NOT_FOUND');
      await request(replace ? store.put(record) : store.add(record));
    });
  }

  return {
    works: subject => bySubject<PreparedWork>('works', subject),
    async saveWork(work) {
      const record = workRecord(work);
      await transaction(['works'], 'readwrite', async tx => { await request(tx.objectStore('works').put(record)); });
    },
    queue: subject => bySubject<QueuedAdvance>('queue', subject),
    enqueue: item => writeAdvance(item, false),
    update: item => writeAdvance(item, true),
    async restoreCopy(copy) {
      const snapshot = structuredClone(copy);
      await validateOfflineRecords(snapshot);
      const works = snapshot.works.map(workRecord);
      const queue = snapshot.queue.map(advanceRecord);
      await transaction(['works', 'queue', 'local_state'], 'readwrite', async tx => {
        const workStore = tx.objectStore('works');
        const queueStore = tx.objectStore('queue');
        const state = tx.objectStore('local_state');
        const [workCount, queueCount, localSubject, collisions] = await Promise.all([
          request(workStore.index('subject').count(snapshot.subject)),
          request(queueStore.index('subject').count(snapshot.subject)),
          request(state.get('subject')),
          Promise.all(queue.map(item => request(queueStore.count(item.operationId)))),
        ]);
        if (workCount || queueCount) throw new Error('OFFLINE_COPY_TARGET_NOT_EMPTY');
        if (localSubject && localSubject !== snapshot.subject) throw new Error('OFFLINE_OWNER_MISMATCH');
        if (collisions.some(Boolean)) throw new Error('OFFLINE_DUPLICATE_OPERATION');
        await Promise.all([
          ...works.map(work => request(workStore.add(work))),
          ...queue.map(item => request(queueStore.add(item))),
          request(state.put(snapshot.subject, 'subject')),
        ]);
      });
    },
    async forget(subject) {
      requireSubject(subject);
      await transaction(['works', 'queue', 'local_state'], 'readwrite', async tx => {
        const removals = ['works', 'queue'].map(async name => {
          const store = tx.objectStore(name);
          const keys = await request(store.index('subject').getAllKeys(subject));
          await Promise.all(keys.map(key => request(store.delete(key))));
        });
        const state = tx.objectStore('local_state');
        removals.push((async () => {
          if (await request(state.get('subject')) === subject) await request(state.delete('subject'));
        })());
        await Promise.all(removals);
      });
    },
    localSubject: () => transaction(['local_state'], 'readonly', async tx => (await request(tx.objectStore('local_state').get('subject'))) ?? null),
    async setLocalSubject(subject) {
      requireSubject(subject);
      await transaction(['local_state'], 'readwrite', async tx => { await request(tx.objectStore('local_state').put(subject, 'subject')); });
    },
    async recoverInterrupted(subject) {
      requireSubject(subject);
      await transaction(['queue'], 'readwrite', async tx => {
        const store = tx.objectStore('queue');
        const items: QueuedAdvance[] = await request(store.index('subject').getAll(subject));
        await Promise.all(items.filter(item => item.state === 'sending').map(item => request(store.put({ ...item, state: 'pending' }))));
      });
    },
    close: () => db.close(),
  };
}
