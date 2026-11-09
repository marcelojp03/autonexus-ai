export const FINANCIAL_TOOL = "autonexus_get_financial_summary";
export const FINANCIAL_RESPONSE_VERSION = "cu25-financial-summary-v1";
const normalized = (query: string): string => query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const financialIntent = (query: string): boolean => /\b(?:financ\w*|ingres\w*|egres\w*|gast\w*|cobr\w*|pag(?:o|a|ue|ad)\w*|recibid\w*|rentabilidad|saldo\w*|profits?|income|expenses?|payments?|cotiz\w*|factur\w*|netos?)\b/.test(normalized(query));
export const financialWriteIntent = (query: string): boolean => {
  const text = normalized(query);
  return /\b(cobra|cobrar|cobres|paga|pagar|pagues|pay|refund|reembolsa|reembolsar|reembolses)\b/.test(text)
    || /\b(registra|registrar|registres|anula|anular|anules|revierte|revertir|reviertas|reversa|reversar|reverses|elimina|eliminar|elimines|borra|borrar|borres|cambia|cambiar|cambies|modifica|modificar|modifiques|crea|crear|crees|record|register|update|delete|reverse|void|edit)\b[^.]*\b(pagos?|cobros?|gastos?|payments?|expenses?)\b/.test(text);
};

export function financialPeriod(args: Readonly<Record<string, unknown>>): {from: string; to: string} | null {
  if (Object.keys(args).some(key => !["from", "to", "responseFormat"].includes(key))) return null;
  const {from, to} = args;
  const valid = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
  if (!valid(from) || !valid(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= 31) return null;
  if (args["responseFormat"] !== undefined && args["responseFormat"] !== "json") return null;
  return {from, to};
}

export function requestedFinancialPeriod(query: string): {from: string; to: string} | null {
  const dates = query.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  if (dates.length !== 2) return null;
  // Only aggregate vocabulary and period connectors are supported; remaining text needs clarification.
  const residue = normalized(query)
    .replace(/\d{4}-\d{2}-\d{2}/g, " ")
    .replace(/\b(resumen|financiero|financiera|finanzas|ingresos|ingreso|egresos|egreso|gastos|gasto|cobros|cobro|cobrado|cobrados|cobramos|cobraron|pagos|pago|recibido|recibidos|registrado|registrados|operativo|operativos|operativa|operativas|taller|neto|netos|movimiento|movimientos|total|totales|cantidad|cuantos|cuanto|cual|es|son|el|la|los|las|un|una|y|de|del|desde|hasta|al|a|entre|en|periodo|por|favor|muestra|mostrame|dame|consulta|consultar|quiero|ver|que|hay)\b/g, " ")
    .replace(/[\s¿?¡!.,:;→-]/g, "");
  return residue.length === 0 ? financialPeriod({from: dates[0], to: dates[1]}) : null;
}

export interface FinancialSummary {
  from: string; to: string; timeZone: "America/La_Paz"; currency: "BOB";
  paymentCount: number; expenseCount: number; receivedAmountMinor: string; expenseAmountMinor: string;
  netMovementMinor: string; generatedAt: string;
}

export function validateFinancialSummary(value: unknown, period: {from: string; to: string}): FinancialSummary | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const amount = (x: unknown): x is string => typeof x === "string" && /^(0|[1-9]\d*)$/.test(x);
  const signed = (x: unknown): x is string => typeof x === "string" && /^(0|-?[1-9]\d*)$/.test(x);
  const count = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
  if (v["from"] !== period.from || v["to"] !== period.to || v["timeZone"] !== "America/La_Paz" || v["currency"] !== "BOB"
    || !count(v["paymentCount"]) || !count(v["expenseCount"]) || !amount(v["receivedAmountMinor"])
    || !amount(v["expenseAmountMinor"]) || !signed(v["netMovementMinor"])
    || typeof v["generatedAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v["generatedAt"])
    || !Number.isFinite(Date.parse(v["generatedAt"])) || !financialPeriod({from: v["generatedAt"].slice(0, 10), to: v["generatedAt"].slice(0, 10)})
    || (v["paymentCount"] === 0) !== (v["receivedAmountMinor"] === "0")
    || (v["expenseCount"] === 0) !== (v["expenseAmountMinor"] === "0")
    || BigInt(v["receivedAmountMinor"]) - BigInt(v["expenseAmountMinor"]) !== BigInt(v["netMovementMinor"])) return null;
  return {from: period.from, to: period.to, timeZone: "America/La_Paz", currency: "BOB", paymentCount: v["paymentCount"],
    expenseCount: v["expenseCount"], receivedAmountMinor: v["receivedAmountMinor"], expenseAmountMinor: v["expenseAmountMinor"],
    netMovementMinor: v["netMovementMinor"], generatedAt: v["generatedAt"]};
}

export function formatFinancialSummary(v: FinancialSummary): string {
  const money = (s: string): string => { const n = BigInt(s); const a = n < 0n ? -n : n;
    return (n < 0n ? "-" : "") + String(a / 100n) + "." + String(a % 100n).padStart(2, "0") + " BOB"; };
  return ["Resumen financiero determinista · " + v.from + " → " + v.to + " · " + v.timeZone,
    "Recibido: " + money(v.receivedAmountMinor) + " · cobros: " + v.paymentCount,
    "Gastos: " + money(v.expenseAmountMinor) + " · gastos registrados: " + v.expenseCount,
    "Movimiento neto: " + money(v.netMovementMinor) + ". No es rentabilidad ni saldo bancario.",
    "Fuente: Finance /financial-summary · actualización del propietario: " + v.generatedAt ].join("\n");
}
