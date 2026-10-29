import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { workspace, node } from './runtime.mjs';
const build = spawnSync(node, [resolve(workspace, 'scripts/cu15/maven-command.mjs'), '-o', '-B', '-DskipTests', 'package'], { cwd: workspace, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const start = spawnSync(node, [resolve(workspace, 'scripts/cu15/launch.mjs'), 'operations'], { cwd: workspace, stdio: 'inherit' });
process.exitCode = start.status ?? 1;
