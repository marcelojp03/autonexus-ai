/**
 * Durable job store for the CU26 report.
 *
 * The report takes minutes on the hardware this runs on, so the UI cannot wait for it in one request.
 * A job is written to disk before it starts, which is what lets the browser reload and keep polling the
 * same identifier instead of asking for a second generation.
 *
 * What is durable: the job record, its state and, once it succeeds, the whole report document.
 * What is never durable: the user's access token. A job that was running when the process stopped can
 * therefore not resume — it is marked interrupted and the caller has to ask again. The store refuses to
 * guess a state it cannot prove.
 */
import {mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync} from "node:fs";
import {join} from "node:path";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "interrupted";

export interface JobFailure {
  readonly code: string;
  readonly message: string;
}

export interface ReportJob<Document = unknown> {
  readonly jobId: string;
  readonly operationId: string;
  readonly subject: string;
  readonly from: string;
  readonly to: string;
  /** Absolute epoch ms of the token that created the job: an expired token is never reused. */
  readonly tokenExpiresAt: number | null;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly status: JobStatus;
  readonly document: Document | null;
  readonly failure: JobFailure | null;
}

export interface JobStoreOptions {
  readonly directory: string;
  /** Jobs kept on disk; the oldest finished ones are removed first. */
  readonly keep?: number;
  /** Finished jobs older than this are removed even when the count is below `keep`. */
  readonly ttlMs?: number;
}

const DEFAULT_KEEP = 50;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Reads a stored job defensively: a truncated file is discarded instead of published as a state. */
export function parseJob(value: unknown): ReportJob | null {
  if (!isRecord(value)) return null;
  const jobId = value["jobId"];
  const status = value["status"];
  if (typeof jobId !== "string" || jobId.length === 0) return null;
  if (status !== "queued" && status !== "running" && status !== "succeeded" && status !== "failed" && status !== "interrupted") return null;
  const failure = isRecord(value["failure"]) && typeof value["failure"]["code"] === "string"
    ? {code: String(value["failure"]["code"]), message: String(value["failure"]["message"] ?? "")} : null;
  return {
    jobId,
    operationId: String(value["operationId"] ?? ""),
    subject: String(value["subject"] ?? ""),
    from: String(value["from"] ?? ""),
    to: String(value["to"] ?? ""),
    tokenExpiresAt: typeof value["tokenExpiresAt"] === "number" ? value["tokenExpiresAt"] : null,
    requestedAt: String(value["requestedAt"] ?? ""),
    startedAt: typeof value["startedAt"] === "string" ? value["startedAt"] : null,
    finishedAt: typeof value["finishedAt"] === "string" ? value["finishedAt"] : null,
    status,
    document: value["document"] === undefined ? null : value["document"],
    failure,
  };
}

const file = (directory: string, jobId: string): string => join(directory, jobId + ".json");

/** A store failure is a service failure: it is reported, never swallowed and never guessed away. */
export class JobStoreError extends Error {
  readonly code: string;
  constructor(code: string, cause: unknown) {
    super(code + ": " + String((cause as {message?: string})?.message ?? cause));
    this.name = "JobStoreError";
    this.code = code;
  }
}

export class ReportJobStore {
  private readonly directory: string;
  private readonly keep: number;
  private readonly ttlMs: number;

  constructor(options: JobStoreOptions) {
    this.directory = options.directory;
    this.keep = Math.max(1, options.keep ?? DEFAULT_KEEP);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    mkdirSync(this.directory, {recursive: true});
  }

  /**
   * Writes through a temporary file so a crash never leaves a half-written job behind. On Windows the
   * rename can fail with EPERM/EBUSY while another handle holds the target (an indexer, a reader), so it
   * is retried a few times instead of turning a transient lock into a lost job.
   */
  save(job: ReportJob): void {
    const target = file(this.directory, job.jobId);
    const temporary = target + ".tmp";
    writeFileSync(temporary, JSON.stringify(job, null, 2), {encoding: "utf8", mode: 0o600});
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        renameSync(temporary, target);
        return;
      } catch (failure) {
        lastError = failure;
        const code = (failure as {code?: string}).code;
        if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (attempt + 1));
      }
    }
    try { unlinkSync(temporary); } catch { /* nothing to clean */ }
    throw new JobStoreError("REPORT_JOB_WRITE_FAILED", lastError);
  }

  load(jobId: string): ReportJob | null {
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
    try {
      return parseJob(JSON.parse(readFileSync(file(this.directory, jobId), "utf8")));
    } catch {
      return null;
    }
  }

  /** Every readable job, newest first. A damaged file is skipped, never published. */
  all(): ReportJob[] {
    let names: string[];
    try {
      names = readdirSync(this.directory).filter(name => name.endsWith(".json"));
    } catch {
      return [];
    }
    const jobs: ReportJob[] = [];
    for (const name of names) {
      const job = this.load(name.slice(0, -".json".length));
      if (job !== null) jobs.push(job);
    }
    return jobs.sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  }

  /** The job this caller already created for that operation, so a retry cannot start a second run. */
  findByOperation(subject: string, operationId: string): ReportJob | null {
    return this.all().find(job => job.subject === subject && job.operationId === operationId) ?? null;
  }

  /** Removes finished jobs beyond `keep` or past the TTL; running jobs are never removed. */
  sweep(nowMs: number): number {
    const finished = this.all().filter(job => job.status === "succeeded" || job.status === "failed" || job.status === "interrupted");
    let removed = 0;
    for (const [index, job] of finished.entries()) {
      const expired = this.ttlMs > 0 && job.finishedAt !== null
        && nowMs - Date.parse(job.finishedAt) > this.ttlMs;
      if (index < this.keep && !expired) continue;
      try {
        unlinkSync(file(this.directory, job.jobId));
        removed += 1;
      } catch { /* already gone: nothing to do */ }
    }
    return removed;
  }
}

/** Terminal by definition: a job that was running when the process stopped cannot resume. */
export const INTERRUPTED_CODE = "INTERRUPTED_BY_RESTART";
export const AUTHORIZATION_EXPIRED_CODE = "AUTHORIZATION_EXPIRED";
export const QUEUE_FULL_CODE = "QUEUE_FULL";
