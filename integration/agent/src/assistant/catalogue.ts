import {FINANCIAL_TOOL, financialPeriod} from "./financial-summary.js";
/**
 * Closed tool catalogue (CU25).
 *
 * The catalogue is the intersection of two closed sets: the tools the caller's token enables and
 * the read-only definitions known here. A tool that the token does not enable is never declared to
 * the model, and a tool that has no definition here is never offered, so the model cannot reach an
 * undeclared capability by naming it.
 */
import type {JsonSchema, OllamaToolDefinition} from "../llm/ollama.js";
import type {ToolInfo} from "../agent.js";

export type ArgumentCheck =
  | {readonly kind: "ok"; readonly args: Readonly<Record<string, unknown>>}
  | {readonly kind: "missing_reference"; readonly message: string}
  | {readonly kind: "invalid"; readonly message: string};

interface Definition {
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly check: (args: Readonly<Record<string, unknown>>) => ArgumentCheck;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_STATUS = ["pending_quote", "quote_requested", "quote_approved", "cancelled", "confirmation_pending", "confirmed"] as const;

const reference = (value: unknown): string | null =>
  (typeof value === "string" && UUID.test(value.trim()) ? value.trim() : null);

const int = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const validDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !DATE.test(value)) return null;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
};

const periodCheck = (args: Readonly<Record<string, unknown>>): ArgumentCheck => {
  const from = validDate(args["from"]);
  const to = validDate(args["to"]);
  if (from === null || to === null) {
    return {kind: "missing_reference",
      message: "Necesito el período que querés consultar en formato AAAA-MM-DD (desde y hasta); no lo invento."};
  }
  if (from > to) return {kind: "invalid", message: "El período está invertido: \"desde\" es posterior a \"hasta\"."};
  const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000 + 1;
  if (days > 31) return {kind: "invalid", message: "El período autorizado no puede superar 31 días."};
  return {kind: "ok", args: {from, to, limit: int(args["limit"], 20, 1, 50), responseFormat: "json"}};
};

const orderListCheck = (args: Readonly<Record<string, unknown>>): ArgumentCheck => {
  const status = args["status"];
  const allowed = typeof status === "string" && (ORDER_STATUS as readonly string[]).includes(status);
  return {kind: "ok", args: {
    limit: int(args["limit"], 20, 1, 50),
    offset: int(args["offset"], 0, 0, 100_000),
    ...(allowed ? {status} : {}),
    responseFormat: "json",
  }};
};

const orderCheck = (args: Readonly<Record<string, unknown>>): ArgumentCheck => {
  const id = reference(args["orderId"] ?? args["id"]);
  if (id === null) return {kind: "missing_reference", message: "Necesito el identificador de la orden (UUID) para consultarla; no lo adivino."};
  return {kind: "ok", args: {orderId: id, responseFormat: "json"}};
};

const executionCheck = (args: Readonly<Record<string, unknown>>): ArgumentCheck => {
  const assignmentId = reference(args["assignmentId"]);
  if (assignmentId === null) {
    return {kind: "missing_reference",
      message: "Necesito el identificador de la asignación (assignmentId, UUID) para consultar avances y evidencias; no lo adivino."};
  }
  return {kind: "ok", args: {
    assignmentId,
    advanceLimit: int(args["advanceLimit"], 20, 1, 50),
    advanceOffset: int(args["advanceOffset"], 0, 0, 100_000),
    responseFormat: "json",
  }};
};

const DEFINITIONS: Readonly<Record<string, Definition>> = {
  [FINANCIAL_TOOL]: {
    description: "Resumen de cobros recibidos y gastos reales de Finance, no rentabilidad ni saldo bancario.",
    parameters: {type: "object", additionalProperties: false, properties: {from: {type: "string"}, to: {type: "string"}}, required: ["from", "to"]},
    check: args => { const period = financialPeriod(args); return period ? {kind: "ok", args: {...period, responseFormat: "json"}}
      : {kind: "missing_reference", message: "Sólo from/to válidos, período explícito de hasta 31 días, sin filtros adicionales."}; },
  },
  autonexus_list_orders: {
    description: "Lista órdenes del taller autorizadas globalmente: número, estado, prioridad, versiones y servicios sin tarifas.",
    parameters: {type: "object", additionalProperties: false,
      properties: {
        limit: {type: "integer", minimum: 1, maximum: 50, description: "Tamaño de página."},
        offset: {type: "integer", minimum: 0, maximum: 100_000},
        status: {type: "string", enum: ORDER_STATUS, description: "Filtro opcional por estado."},
      },
      required: []},
    check: orderListCheck,
  },
  autonexus_get_order: {
    description: "Lee una orden autorizada por identificador.",
    parameters: {type: "object", additionalProperties: false,
      properties: {orderId: {type: "string", pattern: UUID.source, description: "UUID de la orden."}},
      required: ["orderId"]},
    check: orderCheck,
  },
  autonexus_list_my_agenda: {
    description: "Lee la agenda de trabajos propios del empleado autenticado en un período.",
    parameters: {type: "object", additionalProperties: false,
      properties: {from: {type: "string"}, to: {type: "string"}, limit: {type: "integer", minimum: 1, maximum: 50}},
      required: ["from", "to"]},
    check: periodCheck,
  },
  autonexus_list_team_agenda: {
    description: "Lee la agenda de trabajos del equipo autorizado en un período.",
    parameters: {type: "object", additionalProperties: false,
      properties: {from: {type: "string"}, to: {type: "string"}, limit: {type: "integer", minimum: 1, maximum: 50}},
      required: ["from", "to"]},
    check: periodCheck,
  },
  autonexus_get_my_execution: {
    description: "Lee la ejecución propia de una asignación: estado, avances y conteo de evidencias.",
    parameters: {type: "object", additionalProperties: false,
      properties: {assignmentId: {type: "string", pattern: UUID.source}, advanceLimit: {type: "integer", minimum: 1, maximum: 50}},
      required: ["assignmentId"]},
    check: executionCheck,
  },
  autonexus_get_team_execution: {
    description: "Lee la ejecución autorizada del equipo para una asignación: estado, avances y conteo de evidencias.",
    parameters: {type: "object", additionalProperties: false,
      properties: {assignmentId: {type: "string", pattern: UUID.source}, advanceLimit: {type: "integer", minimum: 1, maximum: 50}},
      required: ["assignmentId"]},
    check: executionCheck,
  },
};

export interface CatalogueEntry {
  readonly name: string;
  readonly description: string;
  readonly definition: OllamaToolDefinition;
}

export interface Catalogue {
  readonly entries: readonly CatalogueEntry[];
  readonly names: readonly string[];
  readonly tools: readonly OllamaToolDefinition[];
  /** Re-validates and bounds arguments; never invents a mandatory identifier. */
  check(name: string, args: Readonly<Record<string, unknown>>): ArgumentCheck;
}

export function buildCatalogue(tools: readonly ToolInfo[]): Catalogue {
  const entries: CatalogueEntry[] = [];
  for (const tool of tools) {
    const definition = DEFINITIONS[tool.name];
    if (definition === undefined) continue;
    if (entries.some(entry => entry.name === tool.name)) continue;
    entries.push({name: tool.name, description: definition.description, definition: {
      type: "function",
      function: {name: tool.name, description: definition.description, parameters: definition.parameters},
    }});
  }
  return {
    entries,
    names: entries.map(entry => entry.name),
    tools: entries.map(entry => entry.definition),
    check(name, args) {
      const definition = DEFINITIONS[name];
      if (definition === undefined || !entries.some(entry => entry.name === name)) {
        return {kind: "invalid", message: "La herramienta solicitada no está en el catálogo autorizado."};
      }
      return definition.check(args);
    },
  };
}
