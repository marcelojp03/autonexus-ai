import {createTokenSource} from "../assistant/token-source.js";
import type {ToolOutcome} from "../agent.js";
import type {ToolSource} from "../sources/mcp.js";
import {checkReportContract} from "./contract.js";
import {ReportError, type NarrativeReport, validatePeriod} from "./narrative-report.js";

export type AuthorizeReport = (token: string, period: {readonly from: string; readonly to: string},
  document?: unknown) => Promise<void>;

export interface ReportAuthorizationOptions {
  readonly sourceFactory?: (token: string) => ToolSource;
  readonly employeesUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const unavailable = (): ReportError => new ReportError("REPORT_AUTHORIZATION_UNAVAILABLE",
  "No se pudo comprobar la autorización del reporte.", 503);
const denied = (): ReportError => new ReportError("REPORT_ACCESS_DENIED",
  "El propietario no autorizó el acceso al reporte.", 403);

function requireRead(result: ToolOutcome): void {
  if (result.ok) return;
  const status = result.error?.status;
  const code = result.error?.code;
  if (status === 401 || code === "OWNER_UNAUTHORIZED") {
    throw new ReportError("OWNER_UNAUTHORIZED", "El propietario rechazó el token.", 401);
  }
  if (status === 403 || status === 404 || code === "OWNER_FORBIDDEN"
    || code === "OWNER_NOT_FOUND" || code === "INSUFFICIENT_SCOPE") throw denied();
  throw unavailable();
}

export function createReportAuthorizer(options: ReportAuthorizationOptions = {}): AuthorizeReport {
  const sourceFactory = options.sourceFactory ?? createTokenSource;
  const fetchOwner = options.fetch ?? globalThis.fetch;
  const employees = (options.employeesUrl ?? process.env["EMPLOYEES_API_URL"] ?? "http://127.0.0.1:3002").replace(/\/+$/, "");

  return async (token, period, document): Promise<void> => {
    validatePeriod(period.from, period.to);
    let source: ToolSource | undefined;
    let failure: ReportError | undefined;
    try {
      // This uncached owner read checks current grants, not roles/scopes left in an issued JWT.
      const response = await fetchOwner(employees + "/security/permissions", {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: {accept: "application/json", authorization: "Bearer " + token},
      });
      if (response.status === 401) throw new ReportError("OWNER_UNAUTHORIZED", "El propietario rechazó el token.", 401);
      if (response.status === 403) throw denied();
      if (!response.ok) throw unavailable();
      const grants = record(await response.json());
      if (!Array.isArray(grants["effective"])) throw unavailable();
      // The report contract requires team execution permission even when its period is empty.
      if (grants["employeeStatus"] !== "active" || typeof grants["employeeId"] !== "string"
        || !UUID.test(grants["employeeId"])
        || !grants["effective"].includes("agenda:read:team")
        || !grants["effective"].includes("executions:read:team")) throw denied();

      source = sourceFactory(token);
      requireRead(await source.call("autonexus_list_team_agenda", {...period, limit: 1, responseFormat: "json"}));
      // Creation checks required scopes without fabricating a record; aggregation authorizes each real work.
      if (document === undefined || document === null) return;
      if (checkReportContract(document).length > 0) throw unavailable();
      const report = document as NarrativeReport;
      if (report.report !== "operations-narrative" || report.period.from !== period.from
        || report.period.to !== period.to || report.financialData.included !== false) throw unavailable();
      if (report.provenance.some(item => item.service !== "operations"
        || !["autonexus_list_team_agenda", "autonexus_get_team_execution"].includes(item.tool))
        || report.claims.some(item => !["autonexus_list_team_agenda", "autonexus_get_team_execution"].includes(item.tool))) {
        throw unavailable();
      }
      const assignments = new Set<string>();
      const withoutExecutionData = new Set(report.figures.perWork.filter(work => work.assignmentId !== null
        && work.advances === null && work.evidence === null
        && !work.references.some(reference => reference.kind === "execution")).map(work => work.assignmentId));
      const executionIds = new Set<string>();
      const references = [...report.references, ...report.claims.flatMap(claim => claim.recordRefs),
        ...report.figures.perWork.flatMap(work => work.references)];
      for (const work of report.figures.perWork) {
        if (work.assignmentId !== null) assignments.add(work.assignmentId);
        else if (work.advances !== null || work.evidence !== null) throw unavailable();
      }
      for (const reference of references) {
        if (reference.kind === "assignment") assignments.add(reference.id);
        if (reference.kind === "execution") executionIds.add(reference.id);
      }
      if ([...assignments].some(id => !UUID.test(id))) throw unavailable();
      if (assignments.size === 0 && (report.figures.executionsConsulted > 0 || executionIds.size > 0
        || (report.figures.advances !== null && report.figures.advances !== 0)
        || Object.values(report.figures.evidence ?? {}).some(value => value !== 0))) throw unavailable();
      const observedExecutionIds = new Set<string>();
      const visibleAgendaAssignments = new Set<string>();
      let agendaChecked = false;
      const authorizeAgendaAssignment = async (assignmentId: string): Promise<boolean> => {
        if (!agendaChecked) {
          let offset = 0;
          for (let page = 0; page < 100; page += 1) {
            const result = await source!.call("autonexus_list_team_agenda", {...period, limit: 100, offset, responseFormat: "json"});
            requireRead(result);
            const body = record(result.data), rows = body["data"], total = record(body["page"])["total"];
            if (!Array.isArray(rows) || !Number.isInteger(total) || (total as number) < 0) throw unavailable();
            for (const row of rows) {
              const id = record(row)["assignmentId"];
              if (typeof id !== "string" || !UUID.test(id)) throw unavailable();
              visibleAgendaAssignments.add(id);
            }
            offset += rows.length;
            if (offset >= (total as number)) { agendaChecked = true; break; }
            if (rows.length === 0 || page === 99) throw unavailable();
          }
        }
        return visibleAgendaAssignments.has(assignmentId);
      };
      // Saved assignments may no longer occur in today's agenda; authorize their original IDs directly.
      for (const assignmentId of assignments) {
        const result = await source.call("autonexus_get_team_execution",
          {assignmentId, advanceLimit: 1, responseFormat: "json"});
        // A selected assignment can legitimately have no execution yet. It carries no saved execution
        // metrics, so a 404 is acceptable only if this original assignment is still visible at the owner.
        const missing = !result.ok && (result.error?.status === 404 || result.error?.code === "OWNER_NOT_FOUND");
        if (missing && withoutExecutionData.has(assignmentId) && await authorizeAgendaAssignment(assignmentId)) continue;
        requireRead(result);
        const execution = record(record(result.data)["data"]);
        if (execution["assignmentId"] !== assignmentId) throw unavailable();
        if (typeof execution["id"] === "string") observedExecutionIds.add(execution["id"]);
      }
      if ([...executionIds].some(id => !observedExecutionIds.has(id))) throw unavailable();
    } catch (caught) {
      failure = caught instanceof ReportError ? caught : unavailable();
      throw failure;
    } finally {
      if (source !== undefined) {
        try { await source.close(); } catch { if (failure === undefined) throw unavailable(); }
      }
    }
  };
}

export const authorizeReport: AuthorizeReport = createReportAuthorizer();
