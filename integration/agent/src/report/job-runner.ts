/**
 * Executes CU26 report jobs inside the assistant process.
 *
 * The job is the only thing that outlives a request; the user's token does not. That asymmetry is the
 * whole design: a queued or running job holds the bearer token in memory, so when the process stops the
 * run cannot be resumed and the job is closed as `interrupted`. A succeeded job keeps its document on
 * disk and can be read again after a reload or a restart.
 *
 * An expired authorization is never retried: the owner answers 401, the job ends with
 * AUTHORIZATION_EXPIRED, and the caller decides whether to ask again with a fresh session. Restarting
 * the whole generation on its own would spend the workshop's reads on a token that cannot succeed.
 */
import type {LlmClient} from "../llm/ollama.js";
import type {ToolSource} from "../sources/mcp.js";
import {ReportError, TIME_ZONE} from "./narrative-report.js";
import {AUTHORIZATION_EXPIRED_CODE, INTERRUPTED_CODE, QUEUE_FULL_CODE, type ReportJob, type ReportJobStore} from "./jobs.js";

export interface JobDocumentOptions {
  readonly period: {readonly from: string; readonly to: string};
  readonly source: ToolSource;
  readonly llm: LlmClient | null;
  readonly now: () => Date;
}

export interface RunnerOptions {
  readonly store: ReportJobStore;
  readonly sourceFactory: (token: string) => ToolSource;
  readonly build: (options: JobDocumentOptions) => Promise<unknown>;
  readonly llm: LlmClient | null;
  readonly now?: () => Date;
  /** Jobs waiting plus running; beyond it the caller is told to come back instead of queueing forever. */
  readonly capacity?: number;
  readonly logger?: (entry: Readonly<Record<string, unknown>>) => void;
}

interface Pending {
  readonly jobId: string;
  readonly token: string;
}

const DEFAULT_CAPACITY = 4;

export class ReportJobRunner {
  private readonly store: ReportJobStore;
  private readonly sourceFactory: (token: string) => ToolSource;
  private readonly build: (options: JobDocumentOptions) => Promise<unknown>;
  private readonly llm: LlmClient | null;
  private readonly now: () => Date;
  private readonly capacity: number;
  private readonly logger: (entry: Readonly<Record<string, unknown>>) => void;
  private readonly queue: Pending[] = [];
  private active = false;

  constructor(options: RunnerOptions) {
    this.store = options.store;
    this.sourceFactory = options.sourceFactory;
    this.build = options.build;
    this.llm = options.llm;
    this.now = options.now ?? ((): Date => new Date());
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
    this.logger = options.logger ?? ((): void => { });
  }

  get pending(): number {
    return this.queue.length + (this.active ? 1 : 0);
  }

  /** Closes every job the previous process left open; their token is gone, so they cannot continue. */
  recover(): number {
    let closed = 0;
    for (const job of this.store.all()) {
      if (job.status !== "queued" && job.status !== "running") continue;
      this.store.save({...job, status: "interrupted", finishedAt: this.now().toISOString(),
        failure: {code: INTERRUPTED_CODE,
          message: "El proceso se reinició durante la generación y el trabajo no puede reanudarse sin una sesión nueva."}});
      closed += 1;
    }
    return closed;
  }

  /** Queues an already persisted job. Returns false when the queue is full. */
  submit(job: ReportJob, token: string): boolean {
    if (this.pending >= this.capacity) return false;
    this.queue.push({jobId: job.jobId, token});
    this.logger({at: this.now().toISOString(), outcome: "job-queued", jobId: job.jobId, pending: this.pending});
    // The drain promise must never reject: an unhandled rejection here stops the whole service, which
    // is what a locked job file did once (Windows EPERM on rename).
    void this.drain().catch(failure => this.logger({at: this.now().toISOString(), outcome: "drain-failed",
      error: String((failure as {code?: string})?.code ?? failure).slice(0, 120)}));
    return true;
  }

  private async drain(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift() as Pending;
        try {
          await this.run(next);
        } catch (failure) {
          // One job cannot break the queue: it is closed as failed and the next one runs.
          this.logger({at: this.now().toISOString(), outcome: "job-crashed", jobId: next.jobId,
            error: String((failure as {code?: string})?.code ?? failure).slice(0, 120)});
          try {
            const job = this.store.load(next.jobId);
            if (job !== null) this.finish(job, null, {code: "INTERNAL_ERROR",
              message: "La generación no se completó por un fallo interno del servicio."});
          } catch { /* the store itself failed: the job stays as it was, and the queue continues */ }
        }
      }
    } finally {
      this.active = false;
    }
  }

  private async run(pending: Pending): Promise<void> {
    const job = this.store.load(pending.jobId);
    if (job === null) return;
    if (job.tokenExpiresAt !== null && job.tokenExpiresAt <= this.now().getTime()) {
      // The token that created the job already expired: the owners would answer 401 for every read.
      this.finish(job, null, {code: AUTHORIZATION_EXPIRED_CODE,
        message: "La autorización venció antes de iniciar la generación; se requiere una sesión vigente."});
      return;
    }
    const startedAt = this.now().toISOString();
    this.store.save({...job, status: "running", startedAt});
    this.logger({at: startedAt, outcome: "job-started", jobId: job.jobId, from: job.from, to: job.to});
    let source: ToolSource | null = null;
    try {
      source = this.sourceFactory(pending.token);
      const document = await this.build({period: {from: job.from, to: job.to}, source, llm: this.llm, now: this.now});
      this.finish(job, document, null);
    } catch (failure) {
      this.finish(job, null, this.describe(failure));
    } finally {
      try { await source?.close(); } catch { /* the source is already unusable */ }
    }
  }

  /**
   * Maps a failure to a closed code. An expired or refused authorization is terminal on purpose: the
   * job is not restarted with the same token, because the token is what failed.
   */
  private describe(failure: unknown): {code: string; message: string} {
    if (failure instanceof ReportError) {
      if (failure.status === 401) {
        return {code: AUTHORIZATION_EXPIRED_CODE,
          message: "El propietario rechazó la autorización durante la generación; no se reintenta con el mismo token."};
      }
      if (failure.status === 403) {
        return {code: "FORBIDDEN", message: "La cuenta no conserva el permiso necesario para completar el reporte."};
      }
      return {code: failure.code, message: failure.message};
    }
    const code = typeof (failure as {code?: unknown})?.code === "string" ? String((failure as {code: string}).code) : "INTERNAL_ERROR";
    return {code, message: "La generación no se completó (" + code + ")."};
  }

  private finish(job: ReportJob, document: unknown, failure: {code: string; message: string} | null): void {
    const finishedAt = this.now().toISOString();
    this.store.save({...job, status: failure === null ? "succeeded" : "failed", finishedAt,
      document: document ?? null, failure});
    this.logger({at: finishedAt, outcome: failure === null ? "job-succeeded" : "job-failed",
      jobId: job.jobId, failureCode: failure?.code ?? null});
    this.store.sweep(Date.parse(finishedAt));
  }
}

/** The public view of a job: no subject, no token, no expiry. */
export function publicJob(job: ReportJob): Record<string, unknown> {
  return {
    jobId: job.jobId,
    status: job.status,
    period: {from: job.from, to: job.to, timeZone: TIME_ZONE},
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    ...(job.status === "succeeded" && job.document !== null ? {report: job.document} : {}),
    ...(job.failure === null ? {} : {failure: job.failure}),
  };
}

export const QUEUE_FULL = QUEUE_FULL_CODE;
