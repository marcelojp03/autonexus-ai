import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(realpathSync(resolve('node_modules/@angular/cli/package.json')));
const { Architect } = require('@angular-devkit/architect');
const { WorkspaceNodeModulesArchitectHost } = require('@angular-devkit/architect/node');
const { workspaces, logging } = require('@angular-devkit/core');
const { NodeJsSyncHost } = require('@angular-devkit/core/node');
const { workspace } = await workspaces.readWorkspace(process.cwd(), workspaces.createWorkspaceHost(new NodeJsSyncHost()));
const host = new WorkspaceNodeModulesArchitectHost(workspace, process.cwd());
const architect = new Architect(host);
const logger = new logging.Logger('agenda-unit');
logger.subscribe(entry => console.log(entry.message));
const project = workspace.projects.keys().next().value;
const run = await architect.scheduleTarget({ project, target: 'test' }, {
  watch: false, browsers: undefined, runnerConfig: resolve(import.meta.dirname, 'agenda-vitest.config.ts'), include: process.argv.slice(2)
}, { logger });
try { process.exitCode = (await run.result).success ? 0 : 1; } finally { await run.stop(); }
