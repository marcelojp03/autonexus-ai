import { runFinance } from './runtime.mjs';
const args = process.argv.slice(2);
if (!args.length) throw new Error('finance command required');
const result = runFinance(args);
console.log(result.output);
process.exitCode = result.status ?? 1;
