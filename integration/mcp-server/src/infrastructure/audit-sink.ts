import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

export interface AuditEvent {
  readonly actorSubject: string | null;
  readonly clientId: string | null;
  readonly tool: string;
  readonly correlationId: string;
  readonly outcome: string;
  readonly durationMs: number;
}
export interface AuditSink { write(event: AuditEvent): Promise<void>; }
export class AuditUnavailable extends Error {
  readonly status = 503;
  readonly code = 'AUDIT_UNAVAILABLE';
  constructor() { super('Audit storage is unavailable'); }
}

/** Only operational metadata is serialized; extra caller properties never reach the log. */
export class JsonLineAuditSink implements AuditSink {
  constructor(private readonly file: string) {
    if (!isAbsolute(file) || !file.endsWith('.jsonl')) throw new AuditUnavailable();
  }
  async write(event: AuditEvent): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(event.tool) || !/^[A-Z0-9_]{1,80}$/.test(event.outcome)
      || !/^[a-f0-9-]{36}$/i.test(event.correlationId)
      || !Number.isFinite(event.durationMs) || event.durationMs < 0
      || [event.actorSubject, event.clientId].some(value => value !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(value))) {
      throw new AuditUnavailable();
    }
    const record = { at: new Date().toISOString(), actorSubject: event.actorSubject, clientId: event.clientId,
      tool: event.tool, correlationId: event.correlationId, outcome: event.outcome, durationMs: Math.round(event.durationMs) };
    try {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      await appendFile(this.file, JSON.stringify(record) + String.fromCharCode(10), { encoding: 'utf8', mode: 0o600 });
    } catch { throw new AuditUnavailable(); }
  }
}
