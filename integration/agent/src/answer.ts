/** Answers are built only from known fields of real results; tool text is data, never instruction. */
import type {ToolResult} from "./agent.js";

const record = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function compose(result: ToolResult): string {
  if (!result.ok) {
    const code = result.error?.code ?? "ERROR";
    const status = result.error?.status;
    return "La consulta a " + result.tool + " no se completó (" + code + (status ? " · HTTP " + status : "") +
      "). No hay datos que presentar y no relleno el hueco.";
  }
  const body = record(result.data);
  const data = body["data"];
  if (result.tool === "autonexus_list_orders") {
    const orders = list(data).map(item => record(item));
    const byStatus: Record<string, number> = {};
    for (const order of orders) { const key = String(order["status"] ?? "unknown"); byStatus[key] = (byStatus[key] ?? 0) + 1; }
    const lines = orders.slice(0, 10).map(order => "- " + String(order["number"] ?? "?") + " · " + String(order["status"] ?? "?") + " · v" + String(order["version"] ?? "?"));
    return ["Órdenes autorizadas (fuente: " + result.source + " · " + result.tool + "): " + orders.length + " en esta página.",
      "Por estado: " + (Object.entries(byStatus).map(([k, v]) => k + "=" + v).join(", ") || "sin datos"),
      ...lines].join(String.fromCharCode(10));
  }
  if (result.tool.includes("execution")) {
    const execution = record(data);
    const advances = list(execution["advances"]).map(item => record(item));
    const evidences = advances.reduce((total, advance) => total + Number(record(advance["evidenceCounts"])["available"] ?? 0), 0);
    return ["Ejecución " + String(execution["orderNumber"] ?? "?") + " · " + String(execution["status"] ?? "?") +
      " (fuente: " + result.source + "). Avances en esta página: " + advances.length + " de " + String(record(body["page"])["total"] ?? advances.length) +
      "; evidencias disponibles: " + evidences + ".",
      ...advances.slice(0, 10).map(advance => "- avance " + String(advance["sequence"] ?? "?") + " · " + String(advance["minutesWorked"] ?? "?") + " min · " + String(advance["occurredAt"] ?? "?"))].join(String.fromCharCode(10));
  }
  const items = list(data).map(item => record(item));
  const byStatus: Record<string, number> = {};
  for (const item of items) { const key = String(item["executionStatus"] ?? "unknown"); byStatus[key] = (byStatus[key] ?? 0) + 1; }
  const period = record(body["period"]);
  return ["Agenda autorizada " + String(period["from"] ?? "?") + " → " + String(period["to"] ?? "?") + " (" + String(period["timeZone"] ?? "America/La_Paz") + "), fuente: " + result.source + ".",
    "Trabajos: " + items.length + " · por estado: " + (Object.entries(byStatus).map(([k, v]) => k + "=" + v).join(", ") || "sin datos"),
    ...items.slice(0, 10).map(item => "- " + String(item["orderNumber"] ?? "?") + " · " + String(item["startsAt"] ?? "?") + " · " + String(item["executionStatus"] ?? "?") +
      " · avances " + String(record(item["executionProgress"])["advances"] ?? 0) + " · evidencias " + String(record(item["executionProgress"])["availableEvidence"] ?? 0))].join(String.fromCharCode(10));
}
