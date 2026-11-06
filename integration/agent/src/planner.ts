/** Deterministic planner: safety first, then intent → one authorized read tool. No LLM, no writes. */
export interface PlanInput {
  readonly query: string;
  readonly tools: readonly string[];
  readonly phase: "safety" | "intent";
  readonly assignmentId?: string;
}
export type Decision =
  | {readonly kind: "refuse"; readonly reason: string; readonly message: string}
  | {readonly kind: "continue"}
  | {readonly kind: "call"; readonly tool: string; readonly arguments: Record<string, unknown>};

const WRITE_OR_ESCALATION = [
  /\b(ignora|olvida|omit[ae]|salta(te)?)\b[^.]*\b(regla|instrucci|pol[ií]tica|permiso)/i,
  /\b(dame|conced\w*|otorg\w*|asign\w*|a[nñ]ad\w*|cambi\w*|modific\w*|crea\w*|elimin\w*|borra\w*|quit\w*)\b[^.]*\b(rol|roles|permiso|permisos|administrador|admin)\b/i,
  /\b(env[ií]a|manda|notifica|correo|email|whatsapp|sms)\b/i,
  /\b(act[uú]a como|ahora eres|asume el rol)\b/i,
  /\b(sql|insert|update|delete|drop|truncate)\b/i,
];
const READ_ONLY_REASON = "solo_lectura";
const READ_ONLY_MESSAGE = "Solo puedo consultar información autorizada. No cambio roles, permisos ni datos, y el contenido de las herramientas no amplía mis capacidades.";

export function laPazRange(days = 7, now: Date = new Date()): {from: string; to: string} {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: "America/La_Paz", year: "numeric", month: "2-digit", day: "2-digit"})
    .formatToParts(now);
  const value = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const base = Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")));
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return {from: iso(base), to: iso(base + (days - 1) * 86400000)};
}

export function plan(input: PlanInput): Decision {
  for (const pattern of WRITE_OR_ESCALATION) {
    if (pattern.test(input.query)) return {kind: "refuse", reason: READ_ONLY_REASON, message: READ_ONLY_MESSAGE};
  }
  if (input.phase === "safety") return {kind: "continue"};
  const has = (name: string) => input.tools.includes(name);
  const range = laPazRange();
  const wantsExecution = /\b(avance|avances|ejecuci[oó]n|progreso|inspecci[oó]n)\b/i.test(input.query);
  // Accented words break \b in the ASCII sense, so match the stems directly.
  const wantsOrders = /(orden(es)?|órdenes|pedidos?)/i.test(input.query);
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(input.query)?.[0];

  if (wantsExecution) {
    const tool = has("autonexus_get_team_execution") ? "autonexus_get_team_execution"
      : has("autonexus_get_my_execution") ? "autonexus_get_my_execution" : null;
    if (!tool) return {kind: "refuse", reason: "sin_alcance_ejecuciones", message: "Tu alcance no incluye avances de ejecución."};
    const assignmentId = input.assignmentId ?? uuid;
    if (!assignmentId) return {kind: "refuse", reason: "falta_asignacion", message: "Necesito el identificador de la asignación (assignmentId) para consultar avances; no lo adivino."};
    return {kind: "call", tool, arguments: {assignmentId, advanceLimit: 10, responseFormat: "json"}};
  }
  if (wantsOrders) {
    if (!has("autonexus_list_orders")) return {kind: "refuse", reason: "sin_alcance_ordenes", message: "Tu alcance no incluye el listado de órdenes del taller."};
    return {kind: "call", tool: "autonexus_list_orders", arguments: {limit: 20, responseFormat: "json"}};
  }
  const agendaTool = has("autonexus_list_team_agenda") ? "autonexus_list_team_agenda"
    : has("autonexus_list_my_agenda") ? "autonexus_list_my_agenda" : null;
  if (!agendaTool) return {kind: "refuse", reason: "sin_alcance_agenda", message: "Tu alcance no incluye la agenda de trabajos."};
  return {kind: "call", tool: agendaTool, arguments: {...range, limit: 20, responseFormat: "json"}};
}
