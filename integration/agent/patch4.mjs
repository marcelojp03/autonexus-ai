import {readFileSync, writeFileSync} from "node:fs";
const NL = String.fromCharCode(10);
let a = readFileSync("src/agent.ts", "utf8");
a = a.replace('    if (decision.kind !== "call") {', '    if (decision.kind === "refuse") {');
a = a.replace('    const outcome = await active.call(decision.tool, decision.arguments);',
  '    if (decision.kind === "continue") throw Object.assign(new Error("UNEXPECTED_CONTINUE"), {code: "PLANNER_STATE"});' + NL + '    const outcome = await active.call(decision.tool, decision.arguments);');
writeFileSync("src/agent.ts", a);
console.log(JSON.stringify({ok: a.includes('decision.kind === "refuse"') && a.includes("UNEXPECTED_CONTINUE")}));
