#!/usr/bin/env node
/**
 * Checks the contract of a REAL report response.
 *
 * The unit tests cover the document this service builds from a fake source; this script checks what the
 * running service answers with a real user token, which is where a drifting DTO shows up. It reports
 * every violation and never fills a missing figure with a zero. The token is read from AGENT_TOKEN and
 * is never printed.
 *
 *   AGENT_TOKEN=<token> node scripts/check-report-contract.mjs
 *   AGENT_TOKEN=<token> PROBE_FROM=2026-11-01 PROBE_TO=2026-11-30 node scripts/check-report-contract.mjs
 *
 * Exit codes: 0 = the document satisfies the contract; 1 = violations or a failed request.
 */
import {checkReportContract} from "../dist/report/contract.js";

const url = (process.env["AGENT_URL"] ?? "http://127.0.0.1:3099").replace(/\/+$/, "");
const token = process.env["AGENT_TOKEN"] ?? "";
const from = process.env["PROBE_FROM"] ?? "2026-11-01";
const to = process.env["PROBE_TO"] ?? "2026-11-30";

if (token.length < 20) {
  process.stderr.write("AGENT_TOKEN is required (a user access token, never printed)." + String.fromCharCode(10));
  process.exit(1);
}

const started = Date.now();
let response;
try {
  response = await fetch(url + "/report", {
    method: "POST",
    headers: {authorization: "Bearer " + token, "content-type": "application/json"},
    body: JSON.stringify({from, to}),
    signal: AbortSignal.timeout(300_000),
  });
} catch (failure) {
  process.stderr.write("the report request failed: " + String(failure?.message ?? failure).slice(0, 200) + String.fromCharCode(10));
  process.exit(1);
}
const elapsedMs = Date.now() - started;
const text = await response.text();
let body = null;
try { body = JSON.parse(text); } catch { body = null; }

if (response.status !== 200 || body === null) {
  const code = body !== null && typeof body === "object" && "error" in body
    ? (body.error?.code ?? "UNKNOWN") : "NON_JSON";
  process.stderr.write("HTTP " + String(response.status) + " " + String(code) + String.fromCharCode(10));
  process.exit(1);
}

const problems = checkReportContract(body);
const summary = {
  url: url + "/report",
  status: response.status,
  elapsedMs,
  period: body.period,
  figures: {
    totalWorks: body.figures?.totalWorks,
    byStatus: body.figures?.byStatus,
    perWork: Array.isArray(body.figures?.perWork) ? body.figures.perWork.length : null,
    advances: body.figures?.advances,
    evidence: body.figures?.evidence,
    complete: body.figures?.complete,
  },
  narrative: {path: body.narrative?.path, model: body.narrative?.model,
    generative: body.narrative?.generative, verified: body.narrative?.verified},
  claims: Array.isArray(body.claims) ? body.claims.length : null,
  provenance: Array.isArray(body.provenance) ? body.provenance.length : null,
  limitations: body.limitations,
  violations: problems.length,
};
process.stdout.write(JSON.stringify({...summary, problems}, null, 2) + String.fromCharCode(10));
process.exit(problems.length === 0 ? 0 : 1);
