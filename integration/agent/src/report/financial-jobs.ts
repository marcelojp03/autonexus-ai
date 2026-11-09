/**
 * CU26 financial jobs (S2.15) — isolated from the operational jobs.
 *
 * The store lives in its own directory under `REPORT_JOBS_DIR` (`financial-jobs/`), so a financial
 * `operationId` or `jobId` can never resolve to an operational job or the reverse. The runner class is
 * the same one the operational report uses, but it is a *separate instance* over the separate store:
 * recovering it only closes financial jobs, and it never touches the historical operational jobs or the
 * CU28 weekly deliveries.
 *
 * Same subject + operationId returns the same jobId and the same document; another body under the same
 * identifier is a conflict. The user's token is never written, so a job open at restart becomes
 * INTERRUPTED and is not resumed.
 */
import {resolve} from "node:path";
import {INTERRUPTED_CODE, ReportJobStore, type ReportJob, type ReportJobStore as JobStore} from "./jobs.js";
import {TIME_ZONE} from "./narrative-report.js";

export const FINANCIAL_JOBS_DIRECTORY = "financial-jobs";
export const OPERATION_CONFLICT_CODE = "OPERATION_CONFLICT";

/** The financial store directory: always a subdirectory of the shared jobs root, never that root. */
export function financialJobDirectory(jobsRoot: string): string {
  return resolve(jobsRoot, FINANCIAL_JOBS_DIRECTORY);
}

export interface FinancialJobStore {
  readonly store: JobStore;
  readonly directory: string;
}

export function createFinancialJobStore(jobsRoot: string, keep?: number): FinancialJobStore {
  const directory = financialJobDirectory(jobsRoot);
  return {directory, store: new ReportJobStore({directory, ...(keep === undefined ? {} : {keep})})};
}

/**
 * Same-subject lookup, bounded to the financial store. `null` means "no financial job", which is also
 * the answer for an operational identifier: the two stores cannot see each other.
 */
export function findFinancialJob(store: JobStore, subject: string, operationId: string): ReportJob | null {
  return store.findByOperation(subject, operationId);
}

/** Published view of a financial job: no subject, no token, no expiry. */
export function publicFinancialJob(job: ReportJob): Record<string, unknown> {
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

export {INTERRUPTED_CODE};

/** Kept for callers that resolve the directory from the environment the same way the server does. */
export function defaultFinancialJobDirectory(): string {
  const root = process.env["REPORT_JOBS_DIR"] ?? resolve(process.cwd(), "output/agent/jobs");
  return financialJobDirectory(root);
}
