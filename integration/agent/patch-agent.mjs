import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
const NL = String.fromCharCode(10);
// 1) agent.ts: correct import + non-null source usage
let a = readFileSync("src/agent.ts", "utf8");
a = a.replace('import {connect as connectMcp, type ToolSource} from "./sources/mcp.js";',
  'import {connectMcp, type ToolSource} from "./sources/mcp.js";');
a = a.replace('  let source: ToolSource | null = null;' + NL + '  try {' + NL + '    source = options.source === "mcp" ? await connectMcp(options.account) : await createRestSource(options.account);' + NL + '    const tools = await source.listTools();',
  '  let source: ToolSource | null = null;' + NL + '  try {' + NL + '    const active = options.source === "mcp" ? await connectMcp(options.account) : await createRestSource(options.account);' + NL + '    source = active;' + NL + '    const tools = await active.listTools();');
a = a.replace('    const outcome = await source.call(decision.tool, decision.arguments);', '    const outcome = await active.call(decision.tool, decision.arguments);');
writeFileSync("src/agent.ts", a);
// 2) rest.ts: orders branch without unsafe casts
let r = readFileSync("src/sources/rest.ts", "utf8");
r = r.replace('        const raw = record(await get("/orders?limit=" + String(args["limit"] ?? 20) + "&offset=0"));' + NL + '        if ((raw as ToolOutcome).ok === false) return raw as ToolOutcome;' + NL + '        const page = raw;',
  '        const raw = await get("/orders?limit=" + String(args["limit"] ?? 20) + "&offset=0");' + NL + '        if (!raw.ok) return raw;' + NL + '        const page = record(raw.data);');
writeFileSync("src/sources/rest.ts", r);
// 3) local-pkce.mjs has no types
mkdirSync("src/types", {recursive: true});
writeFileSync("src/types/local-pkce.d.ts",
  'declare module "*local-pkce.mjs" {' + NL +
  '  export interface PkceConfig { issuer?: string; client?: string; redirect?: string; scope?: string; resource?: string; clientSecret?: string }' + NL +
  '  export function authorize(fixture: { username: string; password: string; enabled?: boolean }, wrongPassword?: boolean, config?: PkceConfig): Promise<{ access_token: string; id_token: string; refresh_token: string }>;' + NL +
  '}' + NL);
console.log(JSON.stringify({agentPatched: a.includes("connectMcp,"), restPatched: r.includes("const page = record(raw.data)"), typesAdded: true}));
