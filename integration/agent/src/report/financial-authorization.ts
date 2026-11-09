/**
 * CU26 financial authorization (S2.15) — its own check, not the operational one.
 *
 * The financial report is authorized by the caller's *current* employee grants: an active employee
 * with `employeeId` and BOTH `payments:read` and `expenses:read`, fetched uncached from Employees with
 * the caller's own bearer. It deliberately does not reuse the operational `executions:read:team`, does
 * not accept `mcp_read_*` JWT roles as financial authority, and never mints an identity: Finance
 * re-authorizes the same session when it is read.
 *
 * It runs at creation, at execution and on every read/replay of a stored document, so a revoked
 * permission answers 403 and publishes no figures.
 */
import type {ToolSource} from "../sources/mcp.js";
import {createTokenSource} from "../assistant/token-source.js";
import {ReportError, validatePeriod} from "./narrative-report.js";
import {checkFinancialReportContract, FINANCIAL_DISCRIMINATOR} from "./financial-report.js";

export type AuthorizeFinancialReport = (token: string,
  period: {readonly from: string; readonly to: string}, document?: unknown) => Promise<void>;

export interface FinancialAuthorizationOptions {
  readonly employeesUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FINANCIAL_PERMISSIONS: readonly string[] = Object.freeze(["payments:read", "expenses:read"]);

const record = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const unavailable = (): ReportError => new ReportError("FINANCIAL_AUTHORIZATION_UNAVAILABLE",
  "No se pudo comprobar la autorización financiera de esta sesión.", 503);
const denied = (): ReportError => new ReportError("FINANCIAL_ACCESS_DENIED",
  "La cuenta no es un empleado vigente con los dos permisos financieros requeridos.", 403);

export function createFinancialAuthorizer(options: FinancialAuthorizationOptions = {}): AuthorizeFinancialReport {
  const fetchOwner = options.fetch ?? globalThis.fetch;
  const employees = (options.employeesUrl ?? process.env["EMPLOYEES_API_URL"] ?? "http://127.0.0.1:3002")
    .replace(/\/+$/, "");

  return async (token, period, document): Promise<void> => {
    validatePeriod(period.from, period.to);
    let response: Response;
    try {
      // Uncached on purpose: current grants decide, not the roles left inside an issued JWT.
      response = await fetchOwner(employees + "/security/permissions", {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: {accept: "application/json", authorization: "Bearer " + token},
      });
    } catch {
      throw unavailable();
    }
    if (response.status === 401) throw new ReportError("OWNER_UNAUTHORIZED", "El propietario rechazó el token.", 401);
    if (response.status === 403 || response.status === 404) throw denied();
    if (!response.ok) throw unavailable();
    let grants: Record<string, unknown>;
    try {
      grants = record(await response.json());
    } catch {
      throw unavailable();
    }
    const effective = grants["effective"];
    if (!Array.isArray(effective)) throw unavailable();
    if (grants["employeeStatus"] !== "active" || typeof grants["employeeId"] !== "string"
      || !UUID.test(grants["employeeId"])
      || FINANCIAL_PERMISSIONS.some(permission => !effective.includes(permission))) throw denied();

    // A stored document is re-checked against this type's own contract on every read.
    if (document === undefined || document === null) return;
    const violations = checkFinancialReportContract(document, period);
    if (violations.length > 0) throw unavailable();
    if (record(document)["report"] !== FINANCIAL_DISCRIMINATOR) throw unavailable();
  };
}

export const authorizeFinancialReport: AuthorizeFinancialReport = createFinancialAuthorizer();

/** A source is not needed to authorize, but creation and execution share one signature with it. */
export type FinancialSourceFactory = (token: string) => ToolSource;
export const defaultFinancialSourceFactory: FinancialSourceFactory = (token: string) => createTokenSource(token);
