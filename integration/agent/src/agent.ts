/**
 * CU25 — internal read-only assistant.
 *
 * Tool source is pluggable: the CU29 MCP server (preferred) or a direct REST path so the
 * assistant keeps working when MCP is not running. Tool output is treated strictly as data:
 * the planner never derives new capabilities, never writes, and never follows instructions
 * embedded in payloads. Every refusal or answer states which source produced the data.
 */
import {createHash} from "node:crypto";
import {connectMcp, type ToolSource} from "./sources/mcp.js";
import {createRestSource} from "./sources/rest.js";
import {plan} from "./planner.js";
import {compose} from "./answer.js";
import {writeFileSync, mkdirSync} from "node:fs";
import {resolve} from "node:path";

export type SourceKind = "mcp" | "rest";
export interface ToolInfo { readonly name: string; readonly description: string; }
export interface ToolOutcome { readonly ok: boolean; readonly data?: unknown; readonly error?: {code: string; status?: number}; }
export interface ToolResult extends ToolOutcome {
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
  readonly source: SourceKind;
}

export interface Answer {
  readonly query: string;
  readonly source: SourceKind | null;
  readonly refused?: { readonly reason: string };
  readonly tools: readonly ToolResult[];
  readonly text: string;
}

export interface AssistOptions {
  readonly query: string;
  readonly account: "chief" | "mechanicA";
  readonly source: SourceKind;
  readonly assignmentId?: string;
}

function auditPath(): string {
  const file = process.env["AGENT_AUDIT_FILE"] ?? resolve("output/agent/audit.jsonl");
  mkdirSync(resolve(file, ".."), {recursive: true, mode: 0o700});
  return file;
}

/** Queries are free text and may carry personal data: only a digest and length are stored. */
function queryDigest(query: string): {querySha256: string; queryLength: number} {
  return {querySha256: createHash("sha256").update(query).digest("hex"), queryLength: query.length};
}

function audit(entry: Record<string, unknown>): void {
  writeFileSync(auditPath(), JSON.stringify({at: new Date().toISOString(), ...entry}) + String.fromCharCode(10), {encoding: "utf8", flag: "a", mode: 0o600});
}

export async function assist(options: AssistOptions): Promise<Answer> {
  const started = Date.now();
  const clearance = plan({query: options.query, tools: [], phase: "safety"});
  if (clearance.kind === "refuse") {
    audit({...queryDigest(options.query), account: options.account, outcome: "REFUSED", reason: clearance.reason});
    return {query: options.query, source: null, refused: {reason: clearance.reason}, tools: [], text: clearance.message};
  }

  let source: ToolSource | null = null;
  try {
    const active = options.source === "mcp" ? await connectMcp(options.account) : await createRestSource(options.account);
    source = active;
    const tools = await active.listTools();
    const decision = plan({query: options.query, tools: tools.map(t => t.name), phase: "intent", ...(options.assignmentId ? {assignmentId: options.assignmentId} : {})});
    if (decision.kind === "refuse") {
      audit({...queryDigest(options.query), account: options.account, source: options.source, outcome: "REFUSED", reason: decision.reason});
      return {query: options.query, source: options.source, refused: {reason: decision.reason}, tools: [], text: decision.message};
    }
    if (decision.kind === "continue") throw Object.assign(new Error("UNEXPECTED_CONTINUE"), {code: "PLANNER_STATE"});
    const outcome = await active.call(decision.tool, decision.arguments);
    const result: ToolResult = {...outcome, tool: decision.tool, arguments: decision.arguments, source: options.source};
    const text = compose(result);
    audit({...queryDigest(options.query), account: options.account, source: options.source, tool: decision.tool,
      outcome: outcome.ok ? "OK" : outcome.error?.code ?? "ERROR", durationMs: Date.now() - started});
    return {query: options.query, source: options.source, tools: [result], text};
  } catch (error) {
    const code = (error as {code?: string}).code ?? "TOOL_SOURCE_UNAVAILABLE";
    audit({...queryDigest(options.query), account: options.account, source: options.source, outcome: code, durationMs: Date.now() - started});
    return {query: options.query, source: options.source, tools: [],
      text: "No pude consultar datos autorizados: la fuente de herramientas no está disponible (" + code + "). No invento resultados."};
  } finally {
    await source?.close();
  }
}
