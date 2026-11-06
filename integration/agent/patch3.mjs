import {readFileSync, writeFileSync} from "node:fs";
const NL = String.fromCharCode(10);
let a = readFileSync("src/agent.ts", "utf8");
a = a.replace('    if (decision.kind === "refuse") {', '    if (decision.kind !== "call") {');
writeFileSync("src/agent.ts", a);
console.log(JSON.stringify({patched: a.includes('decision.kind !== "call"')}));
