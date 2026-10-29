import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { workspace } from './runtime.mjs';
const env = { ...process.env, JAVA_HOME: 'C:/Program Files/Java/jdk-21', PATH: 'C:/Program Files/Java/jdk-21/bin;C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + process.env.PATH };
const child = spawn('cmd.exe', ['/d', '/s', '/c', 'mvnw.cmd -B -DskipTests package'], { cwd: resolve(workspace, 'services/operations'), env, stdio: 'inherit', windowsHide: true });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
