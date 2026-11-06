import {readFileSync, writeFileSync} from "node:fs";
let p = readFileSync("src/planner.ts", "utf8");
const before = "  /\\b(dame|conced[ea]|otorg[ae]|asign[ae]|a[nñ]ad[ae]|cambia|modifica|crea|elimina|borra)\\b[^.]*\\b(rol|roles|permiso|permisos|administrador|admin)\\b/i,";
const after = "  /\\b(dame|conced\\w*|otorg\\w*|asign\\w*|a[nñ]ad\\w*|cambi\\w*|modific\\w*|crea\\w*|elimin\\w*|borra\\w*|quit\\w*)\\b[^.]*\\b(rol|roles|permiso|permisos|administrador|admin)\\b/i,";
if (!p.includes(before)) throw new Error("PATTERN_NOT_FOUND");
p = p.replace(before, after);
writeFileSync("src/planner.ts", p);
console.log(JSON.stringify({patched: p.includes("asign\\\\w*")}));
