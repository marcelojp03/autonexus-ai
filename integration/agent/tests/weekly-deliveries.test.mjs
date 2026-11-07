import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {WeeklyDeliveryStore, WeeklyDeliveryStoreError} from "../dist/report/weekly-deliveries.js";
import {ReportJobStore} from "../dist/report/jobs.js";
import {periodIds} from "../../../scripts/n8n/scheduled-functions.mjs";

const NOW = "2026-11-09T12:00:00.000Z";
const LATER = "2026-11-16T12:00:00.000Z";
const WEEK = {from: "2026-11-02", to: "2026-11-08", timeZone: "America/La_Paz"};
const NEXT = {from: "2026-11-09", to: "2026-11-15"};
const SUBJECT = "employee/../../chief";
const file = (directory, subject = SUBJECT) => join(directory, createHash("sha256").update(subject).digest("hex") + ".json");
const error = (code, status) => e => e instanceof WeeklyDeliveryStoreError && e.code === code
  && e.message === code && e.status === status;
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "weekly-delivery-"));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const directory = join(root, "weekly-deliveries");
  return {root, directory, store: new WeeklyDeliveryStore({directory})};
}

test("failed first delivery survives restart, job TTL sweep and next week until acknowledged", t => {
  const {root, directory, store} = setup(t);
  const entry = store.select(SUBJECT, WEEK, NOW);
  assert.deepEqual({operationId: entry.operationId, eventId: entry.eventId}, periodIds(WEEK));
  const jobId = randomUUID();
  const report = {period: WEEK, narrative: {text: "validated original", verified: true}, claims: [{value: 2}]};
  const snapshot = structuredClone(report);
  store.bindJob(SUBJECT, entry.operationId, jobId);
  store.saveReady(SUBJECT, entry.operationId, jobId, report);
  report.narrative.text = "mutated caller";
  const jobs = new ReportJobStore({directory: root});
  jobs.save({jobId, operationId: entry.operationId, subject: SUBJECT, from: WEEK.from, to: WEEK.to,
    tokenExpiresAt: null, requestedAt: NOW, startedAt: NOW, finishedAt: NOW, status: "succeeded", document: snapshot, failure: null});
  assert.equal(jobs.sweep(Date.parse("2027-01-01T00:00:00Z")), 1);
  const restarted = new WeeklyDeliveryStore({directory});
  const retry = restarted.select(SUBJECT, NEXT, LATER);
  assert.equal(retry.operationId, entry.operationId);
  assert.equal(retry.eventId, entry.eventId);
  assert.equal(retry.jobId, jobId);
  assert.deepEqual(retry.report, snapshot);
  assert.equal(retry.status, "pending");
  retry.report.narrative.text = "mutated reader";
  assert.deepEqual(restarted.pending(SUBJECT).report, snapshot);
  assert.deepEqual(restarted.saveReady(SUBJECT, entry.operationId, jobId, {replacement: true}).report, snapshot);
  const delivered = restarted.acknowledge(SUBJECT, entry.operationId, entry.eventId, "recorded", LATER);
  assert.equal(delivered.status, "delivered");
  assert.equal(restarted.pending(SUBJECT), null);
  assert.deepEqual(restarted.acknowledge(SUBJECT, entry.operationId, entry.eventId, "duplicate", "2026-12-01T00:00:00Z"), delivered);
  assert.deepEqual(restarted.select(SUBJECT, WEEK, LATER), delivered);
  const next = restarted.select(SUBJECT, NEXT, LATER);
  assert.notEqual(next.operationId, entry.operationId);
  assert.deepEqual(next.period, {...NEXT, timeZone: "America/La_Paz"});
  assert.equal(JSON.parse(readFileSync(file(directory), "utf8")).deliveries.length, 2);
});

test("duplicate acquisition is one entry and subjects are isolated with hashed filenames", t => {
  const {directory, store} = setup(t);
  const first = store.select(SUBJECT, WEEK, NOW);
  assert.deepEqual(store.select(SUBJECT, WEEK, LATER), first);
  assert.equal(JSON.parse(readFileSync(file(directory), "utf8")).deliveries.length, 1);
  assert.equal(store.find("other", first.operationId), null);
  assert.equal(store.pending("other"), null);
  const other = store.select("other", WEEK, NOW);
  store.saveReady(SUBJECT, first.operationId, "job", {document: "private"});
  assert.equal(store.find("other", other.operationId).report, null);
  assert.equal(readdirSync(directory).length, 2);
  assert.ok(readdirSync(directory).every(name => /^[a-f0-9]{64}[.]json$/.test(name)));
  assert.ok(!readFileSync(file(directory), "utf8").includes("accessToken"));
  if (process.platform !== "win32") assert.equal(statSync(file(directory)).mode & 0o777, 0o600);
});

test("unready, mismatched and unconfirmed acknowledgements reject without changing pending", t => {
  const {store} = setup(t);
  const entry = store.select(SUBJECT, WEEK, NOW);
  assert.throws(() => store.acknowledge(SUBJECT, entry.operationId, entry.eventId, "recorded", NOW), error("WEEKLY_DELIVERY_NOT_READY", 409));
  store.bindJob(SUBJECT, entry.operationId, "running-or-failed-job");
  assert.throws(() => store.bindJob(SUBJECT, entry.operationId, "replacement"), error("WEEKLY_DELIVERY_JOB_MISMATCH", 409));
  assert.throws(() => store.saveReady(SUBJECT, entry.operationId, "replacement", {}), error("WEEKLY_DELIVERY_JOB_MISMATCH", 409));
  assert.equal(store.select(SUBJECT, NEXT, LATER).jobId, "running-or-failed-job");
  store.saveReady(SUBJECT, entry.operationId, "running-or-failed-job", {});
  assert.throws(() => store.acknowledge(SUBJECT, entry.operationId, "wrong-event", "recorded", NOW), error("WEEKLY_DELIVERY_EVENT_MISMATCH", 409));
  assert.throws(() => store.acknowledge(SUBJECT, entry.operationId, entry.eventId, "sent", NOW), error("WEEKLY_DELIVERY_INVALID_RECEIPT", 400));
  assert.throws(() => store.acknowledge("other", entry.operationId, entry.eventId, "recorded", NOW), error("WEEKLY_DELIVERY_NOT_FOUND", 404));
  assert.equal(store.pending(SUBJECT).status, "pending");
  assert.equal(store.acknowledge(SUBJECT, entry.operationId, entry.eventId, "duplicate", NOW).status, "delivered");
});

for (const corrupt of ["{truncated secret", "null", '{"version":1,"deliveries":[{}]}']) {
  test("corruption fails closed without overwriting: " + corrupt.slice(0, 15), t => {
    const {directory, store} = setup(t);
    store.select(SUBJECT, WEEK, NOW);
    writeFileSync(file(directory), corrupt);
    const restarted = new WeeklyDeliveryStore({directory});
    for (const action of [() => restarted.select(SUBJECT, NEXT, LATER), () => restarted.pending(SUBJECT),
      () => restarted.find(SUBJECT, "id"), () => restarted.saveReady(SUBJECT, "id", "job", {}),
      () => restarted.acknowledge(SUBJECT, "id", "event", "recorded", NOW)]) {
      assert.throws(action, error("WEEKLY_DELIVERY_CORRUPT", 503));
    }
    assert.equal(readFileSync(file(directory), "utf8"), corrupt);
  });
}

test("unreadable ledger is a sanitized failure, never an empty reset", t => {
  const {directory, store} = setup(t);
  mkdirSync(file(directory));
  assert.throws(() => store.select(SUBJECT, WEEK, NOW), error("WEEKLY_DELIVERY_READ_FAILED", 503));
  rmSync(directory, {recursive: true});
  assert.throws(() => store.pending(SUBJECT), error("WEEKLY_DELIVERY_READ_FAILED", 503));
});

test("invalid civil weeks and zones reject before persistence", t => {
  const {directory, store} = setup(t);
  for (const period of [{from: "2026-11-03", to: "2026-11-09"}, {...WEEK, to: "2026-11-09"},
    {...WEEK, from: "2026-02-30"}, {...WEEK, timeZone: "UTC"}]) {
    assert.throws(() => store.select(SUBJECT, period, NOW), error("CU28_INVALID_PERIOD", 400));
  }
  assert.deepEqual(readdirSync(directory), []);
});
