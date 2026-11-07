import {createHash, randomUUID} from "node:crypto";
import {closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync} from "node:fs";
import {join} from "node:path";

export interface WeeklyDelivery {
  readonly subject: string;
  readonly period: {readonly from: string; readonly to: string; readonly timeZone: "America/La_Paz"};
  readonly operationId: string;
  readonly eventId: string;
  readonly jobId: string | null;
  readonly report: unknown | null;
  readonly status: "pending" | "delivered";
  readonly createdAt: string;
  readonly deliveredAt: string | null;
}

export class WeeklyDeliveryStoreError extends Error {
  readonly status: number;
  constructor(readonly code: string) {
    super(code);
    this.name = "WeeklyDeliveryStoreError";
    this.status = code === "CU28_INVALID_PERIOD" || code === "WEEKLY_DELIVERY_INVALID_RECEIPT" || code === "WEEKLY_DELIVERY_INVALID_TIME" ? 400
      : code === "WEEKLY_DELIVERY_NOT_FOUND" ? 404
      : ["WEEKLY_DELIVERY_CORRUPT", "WEEKLY_DELIVERY_READ_FAILED", "WEEKLY_DELIVERY_WRITE_FAILED"].includes(code) ? 503 : 409;
  }
}
const fail = (code: string): never => { throw new WeeklyDeliveryStoreError(code); };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function normalizePeriod(period: {from: string; to: string; timeZone?: string}): WeeklyDelivery["period"] {
  const start = new Date(period.from + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(period.from) || !Number.isFinite(start.getTime())
      || start.toISOString().slice(0, 10) !== period.from || start.getUTCDay() !== 1
      || end.toISOString().slice(0, 10) !== period.to
      || (period.timeZone !== undefined && period.timeZone !== "America/La_Paz")) fail("CU28_INVALID_PERIOD");
  return {from: period.from, to: period.to, timeZone: "America/La_Paz"};
}
function ids(period: WeeklyDelivery["period"]): {operationId: string; eventId: string} {
  const prefix = "a0280001-0000-8000-8000-" + period.from.replaceAll("-", "");
  return {operationId: prefix + "0001", eventId: prefix + "0002"};
}

export class WeeklyDeliveryStore {
  private readonly directory: string;
  constructor(options: {directory: string}) {
    this.directory = options.directory;
    try { mkdirSync(this.directory, {recursive: true, mode: 0o700}); }
    catch { fail("WEEKLY_DELIVERY_WRITE_FAILED"); }
  }

  select(subject: string, period: {from: string; to: string; timeZone?: string}, now: string): WeeklyDelivery {
    const normalized = normalizePeriod(period);
    if (!timestamp(now)) fail("WEEKLY_DELIVERY_INVALID_TIME");
    const entries = this.read(subject);
    const existing = this.oldestPending(entries) ?? entries.find(entry => entry.period.from === normalized.from);
    if (existing) return existing;
    const delivery: WeeklyDelivery = {subject, period: normalized, ...ids(normalized), jobId: null,
      report: null, status: "pending", createdAt: now, deliveredAt: null};
    this.write(subject, [...entries, delivery]);
    return delivery;
  }
  pending(subject: string): WeeklyDelivery | null { return this.oldestPending(this.read(subject)); }
  find(subject: string, operationId: string): WeeklyDelivery | null {
    return this.read(subject).find(entry => entry.operationId === operationId) ?? null;
  }
  bindJob(subject: string, operationId: string, jobId: string): WeeklyDelivery {
    return this.update(subject, operationId, entry => {
      if (!jobId || (entry.jobId !== null && entry.jobId !== jobId)) fail("WEEKLY_DELIVERY_JOB_MISMATCH");
      if (entry.jobId === jobId) return entry;
      if (entry.status !== "pending") fail("WEEKLY_DELIVERY_NOT_PENDING");
      return {...entry, jobId};
    });
  }
  saveReady(subject: string, operationId: string, jobId: string, report: unknown): WeeklyDelivery {
    return this.update(subject, operationId, entry => {
      if (!jobId || (entry.jobId !== null && entry.jobId !== jobId)) fail("WEEKLY_DELIVERY_JOB_MISMATCH");
      if (entry.report !== null) return entry;
      if (entry.status !== "pending" || report === null || report === undefined) fail("WEEKLY_DELIVERY_NOT_READY");
      // Authorization and document validation belong to the caller; this snapshot is write-once.
      let snapshot: unknown;
      try { snapshot = JSON.parse(JSON.stringify(report)); }
      catch { return fail("WEEKLY_DELIVERY_INVALID_REPORT"); }
      if (snapshot === null) fail("WEEKLY_DELIVERY_INVALID_REPORT");
      return {...entry, jobId, report: snapshot};
    });
  }
  acknowledge(subject: string, operationId: string, eventId: string, receipt: "recorded" | "duplicate", now: string): WeeklyDelivery {
    if (receipt !== "recorded" && receipt !== "duplicate") fail("WEEKLY_DELIVERY_INVALID_RECEIPT");
    if (!timestamp(now)) fail("WEEKLY_DELIVERY_INVALID_TIME");
    return this.update(subject, operationId, entry => {
      if (entry.eventId !== eventId) fail("WEEKLY_DELIVERY_EVENT_MISMATCH");
      if (entry.jobId === null || entry.report === null) fail("WEEKLY_DELIVERY_NOT_READY");
      if (entry.status === "delivered") return entry;
      return {...entry, status: "delivered", deliveredAt: now};
    });
  }
  private oldestPending(entries: WeeklyDelivery[]): WeeklyDelivery | null {
    return entries.filter(entry => entry.status === "pending")
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0] ?? null;
  }
  private target(subject: string): string {
    return join(this.directory, createHash("sha256").update(subject).digest("hex") + ".json");
  }
  private read(subject: string): WeeklyDelivery[] {
    let text: string;
    try { text = readFileSync(this.target(subject), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        try { if (!statSync(this.directory).isDirectory()) throw new Error(); }
        catch { return fail("WEEKLY_DELIVERY_READ_FAILED"); }
        return [];
      }
      return fail("WEEKLY_DELIVERY_READ_FAILED");
    }
    try {
      const value: unknown = JSON.parse(text);
      if (!record(value) || value["version"] !== 1 || !Array.isArray(value["deliveries"])) throw new Error();
      const operations = new Set<string>();
      for (const entry of value["deliveries"]) {
        if (!record(entry) || entry["subject"] !== subject || !record(entry["period"])) throw new Error();
        const period = entry["period"];
        if (typeof period["from"] !== "string" || typeof period["to"] !== "string" || period["timeZone"] !== "America/La_Paz") throw new Error();
        const expected = ids(normalizePeriod({from: period["from"], to: period["to"], timeZone: period["timeZone"]}));
        if (entry["operationId"] !== expected.operationId || entry["eventId"] !== expected.eventId
            || operations.has(expected.operationId) || !timestamp(entry["createdAt"])
            || !(entry["jobId"] === null || (typeof entry["jobId"] === "string" && entry["jobId"].length > 0))
            || !("report" in entry) || (entry["report"] !== null && entry["jobId"] === null)
            || !["pending", "delivered"].includes(String(entry["status"]))
            || (entry["status"] === "pending" ? entry["deliveredAt"] !== null
              : !timestamp(entry["deliveredAt"]) || entry["report"] === null || entry["jobId"] === null)) throw new Error();
        operations.add(expected.operationId);
      }
      return value["deliveries"] as WeeklyDelivery[];
    } catch { return fail("WEEKLY_DELIVERY_CORRUPT"); }
  }
  private update(subject: string, operationId: string, change: (entry: WeeklyDelivery) => WeeklyDelivery): WeeklyDelivery {
    const entries = this.read(subject);
    const index = entries.findIndex(entry => entry.operationId === operationId);
    const entry = entries[index];
    if (!entry) return fail("WEEKLY_DELIVERY_NOT_FOUND");
    const updated = change(entry);
    if (updated !== entry) { entries[index] = updated; this.write(subject, entries); }
    return updated;
  }
  private write(subject: string, deliveries: WeeklyDelivery[]): void {
    const target = this.target(subject);
    const temporary = target + "." + randomUUID() + ".tmp";
    try {
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({version: 1, deliveries}), {encoding: "utf8"});
        fsyncSync(fd);
      } finally { closeSync(fd); }
      for (let attempt = 0; ; attempt += 1) {
        try { renameSync(temporary, target); break; }
        catch (error) {
          if (attempt >= 4 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (attempt + 1));
        }
      }
    } catch {
      try { unlinkSync(temporary); } catch { /* A failed open may not have created a temporary file. */ }
      fail("WEEKLY_DELIVERY_WRITE_FAILED");
    }
  }
}
