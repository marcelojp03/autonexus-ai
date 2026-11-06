import {readFileSync, writeFileSync} from "node:fs";
let p = readFileSync("src/planner.ts", "utf8");
const before = '  const wantsOrders = /\\b(orden|ordenes|órdenes|pedido|pedidos)\\b/i.test(input.query);';
const after = '  // Accented words break \\b in the ASCII sense, so match the stems directly.\n  const wantsOrders = /(orden(es)?|órdenes|pedidos?)/i.test(input.query);';
if (!p.includes(before)) throw new Error("ORDERS_PATTERN_NOT_FOUND");
p = p.replace(before, after);
writeFileSync("src/planner.ts", p);
console.log(JSON.stringify({patched: p.includes("Accented words break")}));
