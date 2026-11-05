import { withoutCredentials } from './store.ts';
import type { OfflineStore, PreparedWork, QueuedAdvance } from './store.ts';

type Copy = { subject: string; works: PreparedWork[]; queue: QueuedAdvance[] };
type Shape = string | { [key: string]: Shape } | Shape[];
const limit = 32 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inferenceShape: Shape = {
  runId: 'text', modelVersion: 'text', imageSha256: 'hash', labels: [{ name: 'text', score: 'score' }],
  'humanReview?': { modelVersion: 'text', labels: ['text'] },
};
const operationShape: Shape = {
  operationId: 'uuid', entity: 'entity', target: { assignmentId: 'uuid', 'advanceId?': 'uuid', 'evidenceId?': 'uuid' },
  baseVersion: 'integer', dependsOn: ['uuid'],
  payload: { operationId: 'uuid', 'expectedVersion?': 'integer', 'description?': 'description',
    'minutesWorked?': 'minutes', 'fileName?': 'text', 'contentType?': 'mime', 'sizeBytes?': 'bytes', 'checksumSha256?': 'text' },
  'file?': { sha256: 'hash', bytes: 'bytes', contentType: 'mime' }, 'clientInference?': inferenceShape,
};
const workShape: Shape = { subject: 'text', assignmentId: 'uuid', orderId: 'uuid', orderNumber: 'text',
  version: 'integer', preparedAt: 'date', expiresAt: 'date' };
const queueShape: Record<string, Shape> = {
  operationId: 'uuid', subject: 'text', assignmentId: 'uuid', baseVersion: 'integer', description: 'description',
  minutesWorked: 'minutes', createdAt: 'date', state: 'state', 'photo?': 'blob', 'photoSha256?': 'hash',
  'clientInference?': inferenceShape, 'overlayId?': 'uuid', 'lastCode?': 'text',
  'progress?': { 'steps?': { '*': { input: { overlayId: 'uuid', deviceId: 'text', createdAt: 'date', operationsJson: 'operations' },
    'registered?': 'boolean' } }, 'advanceId?': 'uuid', 'evidenceId?': 'uuid', 'attempt?': 'attempt',
  'evidenceState?': 'evidenceState', 'inferenceApplied?': 'boolean' },
};

function check(value: unknown, shape: Shape): void {
  if (Array.isArray(shape)) {
    if (!Array.isArray(value) || value.length > 50) throw new Error('OFFLINE_COPY_INVALID');
    for (const child of value) check(child, shape[0]!);
  } else if (typeof shape === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('OFFLINE_COPY_INVALID');
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('OFFLINE_COPY_INVALID');
      if ('*' in shape) { check(key, 'uuid'); check(record[key], shape['*']!); }
      else if (key.endsWith('?') || (!Object.hasOwn(shape, key) && !Object.hasOwn(shape, key + '?'))) throw new Error('OFFLINE_COPY_INVALID');
    }
    if (!('*' in shape)) for (const [key, child] of Object.entries(shape)) {
      const optional = key.endsWith('?');
      const field = optional ? key.slice(0, -1) : key;
      if (!optional || record[field] !== undefined) check(record[field], child);
    }
  } else {
    let valid = false;
    switch (shape) {
      case 'text': valid = typeof value === 'string' && !!value.trim() && value.length <= 2000
        && !/(?:https?:|javascript:|data:|blob:|bearer\s)/i.test(value); break;
      case 'origin': valid = typeof value === 'string' && value.length <= 2000; break;
      case 'description': valid = typeof value === 'string' && value.length >= 3 && value.length <= 2000; break;
      case 'uuid': valid = typeof value === 'string' && uuid.test(value); break;
      case 'hash': valid = typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); break;
      case 'date': valid = typeof value === 'string' && Number.isFinite(Date.parse(value)); break;
      case 'integer': valid = Number.isSafeInteger(value) && (value as number) >= 0; break;
      case 'minutes': valid = Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 1440; break;
      case 'bytes': valid = Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5 * 1024 * 1024; break;
      case 'attempt': valid = Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5; break;
      case 'score': valid = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; break;
      case 'boolean': valid = typeof value === 'boolean'; break;
      case 'blob': valid = value instanceof Blob && value.size > 0 && value.size <= 5 * 1024 * 1024
        && ['image/jpeg', 'image/png'].includes(value.type); break;
      case 'base64': valid = typeof value === 'string' && value.length > 0 && value.length <= 6990508
        && value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value); break;
      case 'mime': valid = value === 'image/jpeg' || value === 'image/png'; break;
      case 'state': valid = ['pending', 'sending', 'applied', 'conflict', 'rejected', 'needs-reupload'].includes(value as string); break;
      case 'evidenceState': valid = ['authorized', 'put-started', 'failed', 'available'].includes(value as string); break;
      case 'entity': valid = ['advance', 'evidence-authorize', 'evidence-reauthorize', 'evidence-confirm', 'client-inference'].includes(value as string); break;
      case 'operations':
        if (typeof value === 'string') {
          const operations: unknown = JSON.parse(value);
          check(operations, [operationShape]);
          valid = Array.isArray(operations) && operations.length === 1;
        }
        break;
    }
    if (!valid) throw new Error('OFFLINE_COPY_INVALID');
  }
}

export async function validateOfflineRecords(copy: Copy): Promise<void> {
  withoutCredentials(copy);
  check(copy, { subject: 'text', works: [workShape], queue: [queueShape] });
  const assignments = new Set<string>();
  const operations = new Set<string>();
  for (const work of copy.works) {
    if (work.subject !== copy.subject || assignments.has(work.assignmentId)) throw new Error('OFFLINE_COPY_OWNER_OR_DUPLICATE');
    assignments.add(work.assignmentId);
  }
  for (const item of copy.queue) {
    if (item.subject !== copy.subject || operations.has(item.operationId)) throw new Error('OFFLINE_COPY_OWNER_OR_DUPLICATE');
    operations.add(item.operationId);
    if (item.photo) {
      const bytes = new Uint8Array(await item.photo.arrayBuffer());
      const signature = item.photo.type === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
      if (!signature || hash !== item.photoSha256 || (item.clientInference && hash !== item.clientInference.imageSha256)) {
        throw new Error('OFFLINE_COPY_PHOTO_MISMATCH');
      }
    } else if (item.photoSha256 || item.clientInference) throw new Error('OFFLINE_COPY_PHOTO_REQUIRED');
    if (item.clientInference?.humanReview && item.clientInference.humanReview.modelVersion !== item.clientInference.modelVersion) {
      throw new Error('OFFLINE_COPY_MODEL_MISMATCH');
    }
    const steps = item.progress?.steps as Record<string, { input: { operationsJson: string } }> | undefined;
    for (const [id, step] of Object.entries(steps ?? {})) {
      const [operation] = JSON.parse(step.input.operationsJson);
      if (id !== operation.operationId || operation.payload.operationId !== id || operation.target.assignmentId !== item.assignmentId) {
        throw new Error('OFFLINE_COPY_OPERATION_MISMATCH');
      }
      const inference = operation.clientInference as QueuedAdvance['clientInference'];
      if (inference && (inference.imageSha256 !== item.photoSha256
        || (inference.humanReview && inference.humanReview.modelVersion !== inference.modelVersion))) throw new Error('OFFLINE_COPY_MODEL_MISMATCH');
      if (operation.file && (operation.file.sha256 !== item.photoSha256 || operation.file.bytes !== item.photo?.size
        || operation.file.contentType !== item.photo?.type)) throw new Error('OFFLINE_COPY_PHOTO_MISMATCH');
    }
  }
}

export async function createOfflineCopy(store: OfflineStore, subject: string, sourceOrigin: string): Promise<Blob> {
  const origin = new URL(sourceOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== sourceOrigin) throw new Error('OFFLINE_COPY_ORIGIN_INVALID');
  const [works, queue] = await Promise.all([store.works(subject), store.queue(subject)]);
  await validateOfflineRecords({ subject, works, queue });
  const serialized = [];
  for (const item of queue) {
    let photo;
    if (item.photo) {
      const bytes = new Uint8Array(await item.photo.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      photo = { mime: item.photo.type, base64: btoa(binary) };
    }
    serialized.push({ ...item, photo });
  }
  const blob = new Blob([JSON.stringify({ version: 1, subject, sourceOrigin, createdAt: new Date().toISOString(), works, queue: serialized })], { type: 'application/json' });
  if (blob.size > limit) throw new Error('OFFLINE_COPY_TOO_LARGE');
  return blob;
}

export async function decodeOfflineCopy(blob: Blob, expectedSubject: string): Promise<Copy> {
  if (!(blob instanceof Blob) || blob.size < 1 || blob.size > limit) throw new Error('OFFLINE_COPY_TOO_LARGE');
  const raw = JSON.parse(await blob.text());
  withoutCredentials(raw);
  check(raw, { version: 'integer', subject: 'text', sourceOrigin: 'origin', createdAt: 'date', works: [workShape],
    queue: [{ ...queueShape, 'photo?': { mime: 'mime', base64: 'base64' } }] });
  if (raw.version !== 1 || raw.subject !== expectedSubject) throw new Error('OFFLINE_COPY_SUBJECT_OR_VERSION');
  const origin = new URL(raw.sourceOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== raw.sourceOrigin) throw new Error('OFFLINE_COPY_ORIGIN_INVALID');
  for (const item of raw.queue) if (item.photo) {
    const { mime, base64 } = item.photo;
    const binary = atob(base64);
    if (btoa(binary) !== base64) throw new Error('OFFLINE_COPY_PHOTO_INVALID');
    item.photo = new Blob([Uint8Array.from(binary, byte => byte.charCodeAt(0))], { type: mime });
  }
  const copy: Copy = { subject: raw.subject, works: raw.works, queue: raw.queue };
  await validateOfflineRecords(copy);
  return copy;
}
