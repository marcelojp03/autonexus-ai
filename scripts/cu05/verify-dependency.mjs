import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runIntegration } from './integration-entry.mjs';

export const main = args => runIntegration('dependency', args);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv.includes('--run')) {
  main().catch(() => { process.exitCode = 1; console.error('CU05 dependency preflight failed; private diagnostics withheld'); });
}
