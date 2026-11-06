/**
 * Local LLM transport (Ollama `/api/chat`, non-streaming, native tool calling).
 *
 * The transport never decides what is allowed: it only carries messages and maps tool calls.
 * A tool name that the caller did not declare is rejected here, so a model cannot widen its own
 * catalogue. No token, prompt or tool payload is ever logged by this module.
 */
const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen3.5:4b";
const DEFAULT_CALL_TIMEOUT_MS = 90_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 240_000;
const DEFAULT_NUM_PREDICT = 512;
const MIN_NUM_PREDICT = 32;
const MAX_NUM_PREDICT = 2_048;

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Message as returned by the model, re-injected verbatim so Ollama keeps the call identifiers. */
export interface RawToolCall {
  readonly id?: string;
  readonly function?: {readonly index?: number; readonly name?: string; readonly arguments?: unknown};
}

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  readonly thinking?: string;
  readonly tool_calls?: readonly RawToolCall[];
}

export interface JsonSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

export interface JsonSchemaProperty {
  readonly type: "string" | "integer" | "boolean";
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
}

export interface OllamaToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonSchema;
  };
}

/** Normalized call: the model's name/arguments after validation, safe to hand to a tool source. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly OllamaToolDefinition[];
  /** Absolute epoch ms for the whole conversation; a step never outlives it. */
  readonly deadlineMs?: number;
}

export interface ChatResult {
  readonly content: string;
  readonly thinking: string;
  readonly toolCalls: readonly ToolCall[];
  /** Exactly what the model returned; echo this back instead of rebuilding it. */
  readonly rawToolCalls: readonly RawToolCall[];
  readonly model: string;
  readonly latencyMs: number;
  readonly evalCount: number;
}

export type LlmErrorCode =
  | "LLM_UNAVAILABLE"
  | "LLM_TIMEOUT"
  | "LLM_HTTP_ERROR"
  | "LLM_BAD_RESPONSE"
  | "TOOL_NOT_IN_CATALOGUE";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly status: number | null;
  constructor(code: LlmErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.status = status;
  }
}

export interface OllamaConfig {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly callTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly numPredict?: number;
  readonly temperature?: number;
  readonly keepAlive?: string;
}

/** Anything that can answer a chat turn; tests substitute a controlled double for it. */
export interface LlmClient {
  readonly model: string;
  readonly totalTimeoutMs: number;
  chat(request: ChatRequest): Promise<ChatResult>;
}

const integer = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const record = (value: unknown): Record<string, unknown> =>
  (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** Model output can be an object or a JSON string depending on the runtime; both are accepted once. */
function readArguments(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    if (value.trim().length === 0) return {};
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* fall through: reported as a bad response below */ }
  }
  throw new LlmError("LLM_BAD_RESPONSE", "Tool call arguments are not a JSON object.");
}

export function createOllamaClient(overrides: OllamaConfig = {}): LlmClient {
  const baseUrl = (overrides.baseUrl ?? process.env["OLLAMA_URL"] ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = overrides.model ?? process.env["OLLAMA_MODEL"] ?? DEFAULT_MODEL;
  const callTimeoutMs = overrides.callTimeoutMs
    ?? integer(process.env["OLLAMA_CALL_TIMEOUT_MS"], DEFAULT_CALL_TIMEOUT_MS, 1_000, 600_000);
  const totalTimeoutMs = overrides.totalTimeoutMs
    ?? integer(process.env["OLLAMA_TOTAL_TIMEOUT_MS"], DEFAULT_TOTAL_TIMEOUT_MS, 1_000, 1_800_000);
  const numPredict = integer(
    overrides.numPredict === undefined ? process.env["OLLAMA_NUM_PREDICT"] : String(overrides.numPredict),
    DEFAULT_NUM_PREDICT, MIN_NUM_PREDICT, MAX_NUM_PREDICT);
  const temperature = overrides.temperature ?? 0;
  const keepAlive = overrides.keepAlive ?? "10m";

  const chat = async (request: ChatRequest): Promise<ChatResult> => {
    const started = Date.now();
    const remaining = request.deadlineMs === undefined ? callTimeoutMs : request.deadlineMs - started;
    if (remaining <= 0) throw new LlmError("LLM_TIMEOUT", "The conversation deadline elapsed before this step.");
    const budget = Math.min(callTimeoutMs, remaining);
    const declared = new Set((request.tools ?? []).map(tool => tool.function.name));
    const body = {
      model,
      messages: request.messages,
      stream: false,
      ...(request.tools === undefined || request.tools.length === 0 ? {} : {tools: request.tools}),
      keep_alive: keepAlive,
      options: {temperature, num_predict: numPredict},
    };

    let response: Response;
    try {
      response = await fetch(baseUrl + "/api/chat", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(budget),
        headers: {accept: "application/json", "content-type": "application/json"},
        body: JSON.stringify(body),
      });
    } catch (error) {
      const name = (error as {name?: string}).name ?? "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new LlmError("LLM_TIMEOUT", "The local model did not answer within " + String(budget) + " ms.");
      }
      throw new LlmError("LLM_UNAVAILABLE", "The local model endpoint is not reachable.");
    }

    if (!response.ok) {
      // The upstream error body is not echoed: it can contain the prompt.
      throw new LlmError("LLM_HTTP_ERROR", "The local model rejected the request.", response.status);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new LlmError("LLM_BAD_RESPONSE", "The local model returned a non-JSON body.");
    }
    const answer = record(payload);
    const message = record(answer["message"]);
    const content = typeof message["content"] === "string" ? message["content"] : null;
    if (content === null) throw new LlmError("LLM_BAD_RESPONSE", "The local model response has no message.content.");

    const rawToolCalls: RawToolCall[] = Array.isArray(message["tool_calls"])
      ? message["tool_calls"].map(entry => record(entry) as RawToolCall) : [];
    const toolCalls: ToolCall[] = [];
    for (const [index, raw] of rawToolCalls.entries()) {
      const fn = record(raw.function);
      const name = typeof fn["name"] === "string" ? fn["name"] : "";
      if (name.length === 0) throw new LlmError("LLM_BAD_RESPONSE", "A tool call has no function name.");
      if (!declared.has(name)) {
        throw new LlmError("TOOL_NOT_IN_CATALOGUE", "The model requested a tool outside the catalogue: " + name);
      }
      toolCalls.push({id: raw.id ?? "call_" + String(index), name, arguments: readArguments(fn["arguments"])});
    }
    const evalCount = typeof answer["eval_count"] === "number" ? answer["eval_count"] : 0;
    return {
      content,
      thinking: typeof message["thinking"] === "string" ? message["thinking"] : "",
      toolCalls,
      rawToolCalls,
      model: typeof answer["model"] === "string" ? answer["model"] : model,
      latencyMs: Date.now() - started,
      evalCount,
    };
  };

  return {model, totalTimeoutMs, chat};
}
