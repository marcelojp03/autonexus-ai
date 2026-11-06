/** CLI: one question in, one answer out. Usage: node dist/main.js --query "..." [--source mcp|rest] [--account chief|mechanicA] [--assignment <uuid>] */
import {assist, type SourceKind} from "./agent.js";

function argv(): Record<string, string> {
  const out: Record<string, string> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key?.startsWith("--") && args[i + 1] && !args[i + 1]!.startsWith("--")) { out[key.slice(2)] = args[++i]!; }
  }
  return out;
}

const input = argv();
const query = input["query"];
if (!query || query.trim().length < 3) {
  console.error(JSON.stringify({error: "Provide --query \"<consulta>\""}));
  process.exitCode = 2;
} else {
  const source = (input["source"] ?? "mcp") as SourceKind;
  if (!["mcp", "rest"].includes(source)) { console.error(JSON.stringify({error: "Invalid --source"})); process.exitCode = 2; }
  else {
    const account = (input["account"] ?? "chief") as "chief" | "mechanicA";
    const result = await assist({query, account, source, ...(input["assignment"] ? {assignmentId: input["assignment"]} : {})});
    console.log(JSON.stringify({query: result.query, source: result.source, refused: result.refused ?? null,
      tools: result.tools.map(t => ({tool: t.tool, ok: t.ok, error: t.error ?? null, source: t.source})),
      answer: result.text}, null, 2));
    if (result.refused) process.exitCode = 0;
    else if (result.tools.some(t => !t.ok)) process.exitCode = 3;
  }
}
