/**
 * Deterministic fallback for CU25: the planner that already existed keeps the assistant usable when
 * the local model is off, slow or unreachable. It reads the same token-derived catalogue and never
 * widens scope.
 */
import {createHash} from "node:crypto";
import {plan} from "../planner.js";
import {compose} from "../answer.js";
import {FINANCIAL_TOOL, FINANCIAL_RESPONSE_VERSION, financialIntent} from "./financial-summary.js";
import type {AssistantAnswer} from "./llm-assistant.js";
import type {ToolInfo, ToolResult} from "../agent.js";
import type {ToolSource} from "../sources/mcp.js";

export interface DeterministicOptions {
  readonly query: string;
  readonly tools: readonly ToolInfo[];
  readonly source: ToolSource;
  readonly promptVersion: string;
  readonly fallbackFrom?: string;
}

export async function answerDeterministically(options: DeterministicOptions): Promise<AssistantAnswer> {
  const started = Date.now();
  const meta = {
    querySha256: createHash("sha256").update(options.query).digest("hex"),
    queryLength: options.query.length,
    promptVersion: financialIntent(options.query) ? FINANCIAL_RESPONSE_VERSION : options.promptVersion,
    elapsedMs: 0,
  };
  const finish = (answer: Omit<AssistantAnswer, keyof typeof meta | "fallbackFrom">): AssistantAnswer =>
    ({...answer, ...meta, elapsedMs: Date.now() - started,
      ...(options.fallbackFrom === undefined ? {} : {fallbackFrom: options.fallbackFrom})});

  const safety = plan({query: options.query, tools: [], phase: "safety"});
  if (safety.kind === "refuse") {
    return finish({kind: "refused", text: safety.message, path: "deterministic", model: null, steps: 0,
      tools: [], warnings: [], stopReason: "safety_precheck"});
  }
  const decision = plan({query: options.query, tools: options.tools.map(tool => tool.name), phase: "intent"});
  if (decision.kind === "refuse") {
    return finish({kind: "refused", text: decision.message, path: "deterministic", model: null, steps: 0,
      tools: [], warnings: [], stopReason: decision.reason});
  }
  if (decision.kind === "continue") {
    return finish({kind: "unavailable", text: "No pude determinar una consulta autorizada para esa pregunta.", path: "deterministic",
      model: null, steps: 0, tools: [], warnings: [], stopReason: "planner_state"});
  }

  try {
    const outcome = await options.source.call(decision.tool, decision.arguments);
    const result: ToolResult = {...outcome, tool: decision.tool, arguments: decision.arguments, source: "rest"};
    const record = {tool: decision.tool, ok: outcome.ok, error: outcome.ok ? null : outcome.error?.code ?? "TOOL_ERROR"};
    const text = compose(result);
    return finish({kind: "answer", text, path: "deterministic", model: null, steps: 1, tools: [record],
      warnings: outcome.ok ? [] : ["deterministic_fallback_partial"],
      stopReason: decision.tool === FINANCIAL_TOOL
        ? (outcome.ok ? "financial_summary_deterministic" : "financial_summary_tool_error")
        : (outcome.ok ? "deterministic_fallback" : "deterministic_fallback_tool_error")});
  } catch (error) {
    const code = (error as {code?: string}).code ?? "TOOL_SOURCE_UNAVAILABLE";
    return finish({kind: "unavailable", path: "deterministic", model: null, steps: 1,
      tools: [{tool: decision.tool, ok: false, error: code}], warnings: ["tool_source_unavailable"],
      stopReason: code,
      text: "No pude consultar datos autorizados: la fuente de herramientas no está disponible (" + code + "). No invento resultados."});
  }
}
