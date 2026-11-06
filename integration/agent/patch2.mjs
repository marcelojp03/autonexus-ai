import {readFileSync, writeFileSync} from "node:fs";
const NL = String.fromCharCode(10);
let p = readFileSync("src/planner.ts", "utf8");
p = p.replace('  | {readonly kind: "call"; readonly tool: string; readonly arguments: Record<string, unknown>};',
  '  | {readonly kind: "continue"}' + NL + '  | {readonly kind: "call"; readonly tool: string; readonly arguments: Record<string, unknown>};');
p = p.replace('  if (input.phase === "safety") return {kind: "refuse", reason: "safety_pass", message: ""};',
  '  if (input.phase === "safety") return {kind: "continue"};');
writeFileSync("src/planner.ts", p);
let a = readFileSync("src/agent.ts", "utf8");
a = a.replace('  const refusal = plan({query: options.query, tools: [], phase: "safety"});' + NL + '  if (refusal.kind === "refuse") {' + NL + '    audit({query: options.query, account: options.account, outcome: "REFUSED", reason: refusal.reason});' + NL + '    return {query: options.query, source: null, refused: {reason: refusal.reason}, tools: [],' + NL + '      text: refusal.message};' + NL + '  }',
  '  const clearance = plan({query: options.query, tools: [], phase: "safety"});' + NL + '  if (clearance.kind === "refuse") {' + NL + '    audit({query: options.query, account: options.account, outcome: "REFUSED", reason: clearance.reason});' + NL + '    return {query: options.query, source: null, refused: {reason: clearance.reason}, tools: [], text: clearance.message};' + NL + '  }');
writeFileSync("src/agent.ts", a);
console.log(JSON.stringify({planner: p.includes('kind: "continue"'), agent: a.includes("clearance")}));
