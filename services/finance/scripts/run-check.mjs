import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = spawn('C:/Users/marcelo/.config/herd/bin/php84/php.exe', process.argv.slice(2), {
  cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit',
});
child.on('error', () => { process.exitCode = 127; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
