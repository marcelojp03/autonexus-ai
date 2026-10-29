import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { workspace } from './runtime.mjs';
const args = process.argv.slice(2);
if (!args.length || !args.every(arg => /^[A-Za-z0-9._=,/-]+$/.test(arg))) throw new Error('Only scoped Maven arguments');
const env = { ...process.env, JAVA_HOME: 'C:/Program Files/Java/jdk-21', PATH: 'C:/Program Files/Java/jdk-21/bin;' + process.env.PATH };
const child = spawn('cmd.exe', ['/d', '/s', '/c', 'mvnw.cmd ' + args.join(' ')], { cwd: resolve(workspace, 'services/operations'), env, stdio: 'inherit', windowsHide: true });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
