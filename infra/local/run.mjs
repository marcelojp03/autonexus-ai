import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PROJECT = 'cu16-proof';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const label = (c, key) => c.Config?.Labels?.['com.docker.compose.' + key];
const guard = (ok, code) => { if (!ok) throw Error(code); };

export function hostBindPath(source, platform = process.platform) {
  const prefix = '/run/desktop/mnt/host/';
  if (platform === 'win32' && source.startsWith(prefix)) {
    const rest = source.slice(prefix.length);
    if (/^[a-z]$/i.test(rest[0] ?? '') && rest[1] === '/') return rest[0].toUpperCase() + ':/' + rest.slice(2);
  }
  return source;
}

export function options(argv) {
  const result = { command: argv[0], project: DEFAULT_PROJECT, env: [], n8nEnv: [], files: [] };
  guard(['check', 'up', 'status', 'stop'].includes(result.command), 'COMMAND_REQUIRED');
  const keys = { '--project': 'project', '--env-file': 'env', '--n8n-env-file': 'n8nEnv', '--file': 'files' };
  for (let i = 1; i < argv.length; i++) {
    const key = keys[argv[i]];
    guard(key && argv[i + 1] && !argv[i + 1].startsWith('--'), 'INVALID_OPTION');
    const value = argv[++i];
    if (Array.isArray(result[key])) result[key].push(value); else result[key] = value;
  }
  guard(/^[a-z0-9][a-z0-9_-]*$/.test(result.project), 'INVALID_PROJECT');
  guard(result.env.length && result.n8nEnv.length, 'EXPLICIT_PRIVATE_ENV_REQUIRED');
  return result;
}

export function dockerFailureCode(args, error) {
  const stage = args.includes('up') ? (args.at(-1) === 'n8n' ? 'N8N_UP' : 'PLATFORM_UP') : args.includes('config') ? 'CONFIG' : 'READ';
  const message = String(error?.stderr ?? '');
  const reason = /no such service/i.test(message) ? 'UNKNOWN_SERVICE' : /unknown flag|unknown shorthand flag/i.test(message) ? 'UNSUPPORTED_FLAG'
    : /required variable|variable.+missing|N8N_ENCRYPTION_KEY.+set a private/i.test(message) ? 'PRIVATE_ENV_MISSING'
    : /no such image|unable to find image/i.test(message) ? 'IMAGE_MISSING' : /network.+not found|network.+external/i.test(message) ? 'NETWORK_UNAVAILABLE' : 'FAILED';
  return 'DOCKER_' + stage + '_' + reason;
}

export function docker(args, environment = {}) {
  try { return execFileSync('docker', args, { cwd: root, env: { ...process.env, ...environment }, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { throw Error(dockerFailureCode(args, error)); }
}

export function plan(command, platform, n8n, compose, n8nCompose) {
  const service = c => label(c, 'service');
  const runtime = platform.filter(c => !['config-init', 'provision', 'demo', 'acceptance'].includes(service(c)) && !service(c).endsWith('-migrate'));
  if (command === 'up') {
    const order = ['postgres', 'idp-postgres', 'mongo', 'rabbitmq', 'dynamodb', 'keycloak', 'employees', 'operations', 'finance', 'finance-documents-storage', 'intelligence', 'sync', 'agent', 'bff', 'web'];
    const rank = c => service(c).includes('publisher') ? 18 : order.includes(service(c)) ? order.indexOf(service(c)) : 17;
    // Resume only validated existing IDs. Applying a changed Compose model is a separate deployment.
    return [...runtime].sort((a, b) => rank(a) - rank(b)).map(c => ['start', c.Id]).concat([['start', n8n.Id]]);
  }
  if (command !== 'stop') return [];
  const rank = c => {
    const s = service(c);
    if (s === 'n8n' || s.includes('publisher')) return 0;
    if (['web', 'bff', 'agent', 'sync', 'intelligence', 'operations', 'employees'].includes(s)) return 1;
    if (s.includes('storage') || /localstack|dynamodb/.test(s)) return 3;
    if (['postgres', 'idp-postgres', 'rabbitmq', 'mongo'].includes(s)) return 5;
    return 2;
  };
  return [...platform, n8n].filter(c => c.State.Running).sort((a, b) => rank(a) - rank(b)).map(c => ['stop', '--time', '60', c.Id]);
}

export function coordinate(opts, execute = docker, io = { exists: existsSync, read: p => readFileSync(p, 'utf8') }) {
  const call = args => execute(args, { N8N_NETWORK: opts.project + '_default', ...(args.includes('-p') ? { COMPOSE_PROJECT_NAME: args[args.indexOf('-p') + 1] } : {}) });
  const json = args => JSON.parse(call(args));
  const inspectIds = ids => ids.length ? json(['inspect', ...ids]) : [];
  const ids = text => text.trim().split(/\s+/).filter(Boolean);
  // Separate Compose models do not imply separate projects. The current installation
  // intentionally keeps n8n under the same project so its existing volume is retained.
  const platform = inspectIds(ids(call(['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + opts.project])))
    .filter(c => label(c, 'service') !== 'n8n');
  guard(platform.length > 0, 'EXISTING_INSTALLATION_REQUIRED');
  const finance = platform.find(c => label(c, 'service') === 'finance');
  const storage = platform.find(c => label(c, 'service') === 'finance-documents-storage');
  guard(finance && storage, 'PERMANENT_DOCUMENT_PROVIDER_REQUIRED');
  guard(storage.HostConfig.NetworkMode === 'container:' + finance.Id, 'FINANCE_NAMESPACE_DRIFT');
  guard(storage.Mounts.some(m => m.Name === opts.project + '_finance-documents-minio-data' && m.Destination === '/data'), 'MINIO_VOLUME_DRIFT');
  const profile = finance.Mounts.find(m => m.Destination === '/run/finance-documents/storage.json');
  const profilePath = profile && hostBindPath(profile.Source);
  guard(profilePath && io.exists(profilePath), 'ACTIVE_DOCUMENT_PROFILE_REQUIRED');
  guard(JSON.parse(io.read(profilePath)).endpoint === 'http://127.0.0.1:4568', 'ACTIVE_MINIO_PROFILE_REQUIRED');
  for (const c of platform) {
    guard(label(c, 'project') === opts.project, 'CONTAINER_OWNERSHIP_DRIFT');
    for (const m of c.Mounts.filter(m => m.Type === 'volume')) {
      const v = json(['volume', 'inspect', m.Name])[0];
      const namedOwner = m.Name.startsWith(opts.project + '_') && (v.Labels?.['com.docker.compose.project'] === opts.project || (m.Name === opts.project + '_finance-documents-minio-data' && v.Labels?.['autonexus.owner'] === 'finance'));
      // Existing image-declared anonymous mounts must be retained, never replaced with empty ones.
      const inheritedAnonymous = Object.hasOwn(v.Labels ?? {}, 'com.docker.volume.anonymous') && Object.hasOwn(c.Config.Volumes ?? {}, m.Destination);
      guard(namedOwner || inheritedAnonymous, 'VOLUME_OWNERSHIP_DRIFT');
    }
  }
  const networkName = opts.project + '_default';
  const network = json(['network', 'inspect', networkName])[0];
  guard(network.Labels?.['com.docker.compose.project'] === opts.project, 'NETWORK_OWNERSHIP_DRIFT');
  const candidates = inspectIds(ids(call(['ps', '-aq', '--filter', 'label=com.docker.compose.service=n8n']))).filter(c => c.NetworkSettings.Networks[networkName]);
  guard(candidates.length === 1, 'UNIQUE_ATTACHED_N8N_REQUIRED');
  const n8n = candidates[0], n8nProject = label(n8n, 'project');
  guard(typeof n8nProject === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(n8nProject), 'N8N_PROJECT_REQUIRED');
  guard(n8nProject === opts.project, 'N8N_PROJECT_OWNERSHIP_DRIFT');
  for (const m of n8n.Mounts.filter(m => m.Type === 'volume')) {
    guard(json(['volume', 'inspect', m.Name])[0].Labels?.['com.docker.compose.project'] === n8nProject, 'N8N_VOLUME_OWNERSHIP_DRIFT');
  }
  const registered = containers => [...new Set(containers.flatMap(c => (label(c, 'project.config_files') ?? '').split(',').filter(Boolean)))];
  const files = [...new Set([...registered(platform), ...opts.files.map(f => resolve(root, f)), resolve(root, 'infra/local/finance-documents.compose.yaml')])];
  const n8nFiles = registered([n8n]);
  guard(registered(platform).length && n8nFiles.length, 'COMPOSE_FILES_REQUIRED');
  const compose = (project, env, paths, documents) => {
    for (const p of [...env, ...paths]) guard(io.exists(resolve(root, p)), 'REQUIRED_FILE_MISSING');
    return ['compose', '--project-directory', root, '-p', project, ...env.flatMap(p => ['--env-file', resolve(root, p)]), ...paths.flatMap(p => ['-f', p]), ...(documents ? ['--profile', 'finance-documents', '--profile', 'automations'] : [])];
  };
  const base = compose(opts.project, opts.env, files, true);
  const nb = compose(n8nProject, opts.n8nEnv, n8nFiles, false);
  // Keep the external n8n network declaration out of the platform model.
  call([...base, 'config', '--quiet']);
  call([...nb, 'config', '--quiet']);
  const actions = plan(opts.command, platform, n8n, base, nb);
  for (const action of actions) call(action);
  return { project: opts.project, command: opts.command, pass: true, actions: actions.length,
    containers: [...platform, n8n].map(c => ({ service: label(c, 'service'), state: c.State.Status, health: c.State.Health?.Status ?? null })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(coordinate(options(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(JSON.stringify({ pass: false, code: /^[A-Z_]+$/.test(error.message) ? error.message : 'LOCAL_COORDINATOR_FAILED' })); process.exitCode = 1; }
}
