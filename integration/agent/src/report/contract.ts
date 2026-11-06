/**
 * CU26 report contract, service side.
 *
 * The report document this service returns is consumed by the BFF, which projects it field by field
 * and fails closed when a figure is missing. The shape below is the published contract
 * (contracts/graphql/assistant.graphql, "Cuerpo esperado del servicio"): it exists so the service can
 * check its own document against it — in a unit test and against a real response — instead of trusting
 * that the two sides agree. A missing figure is never read as a zero: the check reports it.
 */

export interface ContractViolation {
  /** Dotted path of the offending field, e.g. `figures.totalWorks`. */
  readonly path: string;
  readonly problem: "missing" | "type" | "empty" | "inconsistent";
  readonly detail: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isWhole = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

type Kind = "string" | "whole" | "boolean" | "object" | "array" | "nullable-whole" | "nullable-object" | "enum-llm";

const REQUIRED: ReadonlyArray<readonly [string, Kind]> = [
  ["report", "string"],
  ["period.from", "string"],
  ["period.to", "string"],
  ["period.timeZone", "string"],
  ["generatedAt", "string"],
  ["promptVersion", "string"],
  ["figures.totalWorks", "whole"],
  ["figures.byStatus", "object"],
  ["figures.advances", "nullable-whole"],
  ["figures.evidence", "nullable-object"],
  ["figures.perWork", "array"],
  ["figures.complete", "boolean"],
  ["figures.executionsConsulted", "whole"],
  ["figures.executionsFailed", "whole"],
  ["claims", "array"],
  ["narrative.text", "string"],
  ["narrative.path", "enum-llm"],
  ["narrative.verified", "boolean"],
  ["narrative.generative", "boolean"],
  ["references", "array"],
  ["provenance", "array"],
  ["financialData.included", "boolean"],
  ["financialData.note", "string"],
  ["limitations", "array"],
];

function at(document: Record<string, unknown>, path: string): unknown {
  let current: unknown = document;
  for (const key of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function typeProblem(value: unknown, kind: Kind): string | null {
  switch (kind) {
    case "string": return typeof value === "string" && value.trim().length > 0 ? null : "se espera texto no vacío";
    case "whole": return isWhole(value) ? null : "se espera un entero >= 0";
    case "boolean": return typeof value === "boolean" ? null : "se espera booleano";
    case "object": return isRecord(value) ? null : "se espera objeto";
    case "array": return Array.isArray(value) ? null : "se espera lista";
    case "nullable-whole": return value === null || isWhole(value) ? null : "se espera entero o null";
    case "nullable-object": return value === null || isRecord(value) ? null : "se espera objeto o null";
    case "enum-llm": return value === "llm" || value === "deterministic" ? null : "se espera llm o deterministic";
  }
}

/**
 * Checks one published report document. Every problem is reported; the document is never corrected,
 * and an absent figure stays absent instead of becoming zero.
 */
export function checkReportContract(value: unknown): ContractViolation[] {
  const problems: ContractViolation[] = [];
  if (!isRecord(value)) {
    return [{path: "(document)", problem: "type", detail: "se espera un objeto"}];
  }
  for (const [path, kind] of REQUIRED) {
    const found = at(value, path);
    if (found === undefined) {
      problems.push({path, problem: "missing", detail: "el campo no está publicado"});
      continue;
    }
    const problem = typeProblem(found, kind);
    if (problem !== null) problems.push({path, problem: "type", detail: problem});
  }

  const figures = at(value, "figures");
  if (isRecord(figures)) {
    const byStatus = figures["byStatus"];
    const total = figures["totalWorks"];
    const perWork = figures["perWork"];
    if (isRecord(byStatus) && isWhole(total)) {
      const statusSum = Object.values(byStatus).reduce<number>(
        (sum, count) => sum + (isWhole(count) ? count : 0), 0);
      const badStatus = Object.entries(byStatus).filter(([, count]) => !isWhole(count)).map(([status]) => status);
      if (badStatus.length > 0) {
        problems.push({path: "figures.byStatus", problem: "type",
          detail: "conteo no entero en: " + badStatus.join(",")});
      }
      if (statusSum !== total) {
        problems.push({path: "figures.totalWorks", problem: "inconsistent",
          detail: "byStatus suma " + String(statusSum) + " y totalWorks es " + String(total)});
      }
    }
    if (Array.isArray(perWork) && isWhole(total) && perWork.length !== total) {
      problems.push({path: "figures.perWork", problem: "inconsistent",
        detail: "perWork tiene " + String(perWork.length) + " elementos y totalWorks es " + String(total)});
    }
    const evidence = figures["evidence"];
    if (isRecord(evidence)) {
      for (const key of ["available", "pending", "failed"]) {
        if (!Object.hasOwn(evidence, key)) {
          problems.push({path: "figures.evidence." + key, problem: "missing", detail: "el conteo no está publicado"});
        } else if (!isWhole(evidence[key])) {
          problems.push({path: "figures.evidence." + key, problem: "type", detail: "se espera un entero >= 0"});
        }
      }
    }
    const complete = figures["complete"];
    const failed = figures["executionsFailed"];
    if (typeof complete === "boolean" && isWhole(failed) && complete !== (failed === 0)) {
      problems.push({path: "figures.complete", problem: "inconsistent",
        detail: "complete=" + String(complete) + " con executionsFailed=" + String(failed)});
    }
  }

  const narrative = at(value, "narrative");
  if (isRecord(narrative)) {
    const path = narrative["path"];
    const model = narrative["model"];
    const generative = narrative["generative"];
    if (path === "deterministic" && model !== null && model !== undefined) {
      problems.push({path: "narrative.model", problem: "inconsistent",
        detail: "la plantilla determinista no declara modelo"});
    }
    if (path === "llm") {
      if (typeof model !== "string" || model.trim().length === 0) {
        problems.push({path: "narrative.model", problem: "missing", detail: "una narración del modelo debe nombrarlo"});
      }
      if (generative !== true) {
        problems.push({path: "narrative.generative", problem: "inconsistent", detail: "path llm exige generative=true"});
      }
    }
    if (path === "deterministic" && generative !== false) {
      problems.push({path: "narrative.generative", problem: "inconsistent", detail: "path deterministic exige generative=false"});
    }
  }

  const claims = at(value, "claims");
  if (Array.isArray(claims)) {
    claims.forEach((claim, index) => {
      const where = "claims[" + String(index) + "]";
      if (!isRecord(claim)) {
        problems.push({path: where, problem: "type", detail: "se espera objeto"});
        return;
      }
      for (const key of ["indicator", "label", "unit", "source", "tool"]) {
        if (typeof claim[key] !== "string" || String(claim[key]).trim().length === 0) {
          problems.push({path: where + "." + key, problem: "missing", detail: "el campo no está publicado"});
        }
      }
      if (!isWhole(claim["value"])) problems.push({path: where + ".value", problem: "type", detail: "se espera un entero >= 0"});
      if (!isRecord(claim["period"])) problems.push({path: where + ".period", problem: "missing", detail: "la afirmación debe acotar su período"});
      if (!Array.isArray(claim["recordRefs"])) problems.push({path: where + ".recordRefs", problem: "type", detail: "se espera lista"});
    });
  }

  const provenance = at(value, "provenance");
  if (Array.isArray(provenance)) {
    provenance.forEach((entry, index) => {
      const where = "provenance[" + String(index) + "]";
      if (!isRecord(entry)) {
        problems.push({path: where, problem: "type", detail: "se espera objeto"});
        return;
      }
      for (const key of ["service", "resource"]) {
        if (typeof entry[key] !== "string" || String(entry[key]).trim().length === 0) {
          problems.push({path: where + "." + key, problem: "missing", detail: "la procedencia debe nombrar el origen"});
        }
      }
    });
  }

  return problems;
}
