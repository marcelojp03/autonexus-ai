import { readFile, writeFile, chmod, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
export async function prepare(directory = resolve(root, 'output/stack')) {
  const p = JSON.parse(await readFile(resolve(directory, 'finance-documents.private.json'), 'utf8'));
  for (const key of ['endpoint', 'region', 'bucket', 'accessKey', 'secretKey']) {
    if (typeof p[key] !== 'string' || !p[key] || /[\r\n\0]/.test(p[key])) throw Error('Invalid Finance source profile');
  }
  if (!['http://127.0.0.1:4566', 'http://127.0.0.1:4568'].includes(p.endpoint) || !/^[a-z0-9-]+$/.test(p.region)
      || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(p.bucket)
      || p.accessKey.length < 3 || p.secretKey.length < 8) throw Error('Unexpected Finance source profile');
  const target = { ...p, endpoint: 'http://127.0.0.1:4568' };
  const outputs = [
    ['finance-documents-minio.private.json', JSON.stringify(target, null, 2) + '\n'],
    ['finance-minio-user.private.txt', p.accessKey],
    ['finance-minio-password.private.txt', p.secretKey],
  ];
  for (const [name, value] of outputs) {
    const path = resolve(directory, name);
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Private output must be a regular file');
      if (await readFile(path, 'utf8') !== value) throw Error('Private target drift; refusing overwrite');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const [name, value] of outputs) {
    const path = resolve(directory, name);
    try { await writeFile(path, value, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== value) throw Error('Private output changed concurrently'); }
    await chmod(path, 0o600);
  }
  return target;
}

export function prepareVolume(project = process.env.COMPOSE_PROJECT_NAME ?? 'autonexus-local') {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw Error('Invalid local Compose project');
  const name = project + '_finance-documents-minio-data';
  const listed = spawnSync('docker', ['volume', 'ls', '--quiet', '--filter', 'name=^' + name + '$'], { encoding: 'utf8' });
  if (listed.status !== 0) throw Error('Local Docker volume lookup failed');
  if (!listed.stdout.trim()) {
    const created = spawnSync('docker', ['volume', 'create', '--label', 'autonexus.owner=finance', '--label', 'autonexus.purpose=storage-relocation-target', name], { encoding: 'utf8' });
    if (created.status !== 0) throw Error('Local Finance volume creation failed');
  }
  const inspected = spawnSync('docker', ['volume', 'inspect', name], { encoding: 'utf8' });
  if (inspected.status !== 0) throw Error('Local Finance volume inspection failed');
  const [v] = JSON.parse(inspected.stdout);
  if (v.Name !== name || v.Driver !== 'local' || Object.keys(v.Options ?? {}).length
      || v.Labels?.['autonexus.owner'] !== 'finance' || v.Labels?.['autonexus.purpose'] !== 'storage-relocation-target') {
    throw Error('Existing volume is not the owned local Finance relocation target');
  }
  return { volume: name, owner: 'finance', purpose: 'storage-relocation-target' };
}

export async function operator() {
  try {
    const { createHash, createHmac, randomUUID } = await import('node:crypto');
    let input = '';
    for await (const part of process.stdin) input += part;
    const { profile: p, mode, proof } = JSON.parse(input);
    if (p.endpoint !== 'http://127.0.0.1:4568') throw Error('Target endpoint rejected');
    const hash = value => createHash('sha256').update(value).digest('hex');
    const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
    const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const bucket = '/' + encode(p.bucket);
    async function request(method, path, query = '', body = '', extra = {}) {
      const at = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
      const day = at.slice(0, 8);
      const headers = { ...extra, host: '127.0.0.1:4568', 'x-amz-content-sha256': hash(body), 'x-amz-date': at };
      const names = Object.keys(headers).sort();
      const canonical = [method, path, query, names.map(k => k + ':' + headers[k].trim() + '\n').join(''), names.join(';'), hash(body)].join('\n');
      const scope = day + '/' + p.region + '/s3/aws4_request';
      let key = 'AWS4' + p.secretKey;
      for (const part of [day, p.region, 's3', 'aws4_request']) key = hmac(key, part);
      headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + p.accessKey + '/' + scope + ', SignedHeaders=' + names.join(';') + ', Signature=' + hmac(key, 'AWS4-HMAC-SHA256\n' + at + '\n' + scope + '\n' + hash(canonical)).toString('hex');
      return fetch(p.endpoint + path + (query ? '?' + query : ''), { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body, redirect: 'error', signal: AbortSignal.timeout(10000) });
    }
    function expect(condition, step) { if (!condition) throw Error(step); }
    if (mode === 'configure') {
      let r = await request('HEAD', bucket);
      if (r.status === 404) {
        const body = p.region === 'us-east-1' ? '' : '<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>' + p.region + '</LocationConstraint></CreateBucketConfiguration>';
        r = await request('PUT', bucket, '', body);
      }
      expect(r.ok, 'Bucket configuration failed');
      r = await request('PUT', bucket, 'versioning=', '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>');
      expect(r.ok, 'Enable versioning failed');
      r = await request('GET', bucket, 'versioning=');
      expect(r.ok && (await r.text()).includes('<Status>Enabled</Status>'), 'Versioning verification failed');
      r = await request('DELETE', bucket, 'policy=');
      expect(r.ok || r.status === 404, 'Private bucket policy configuration failed');
      r = await fetch(p.endpoint + bucket, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      expect(r.status === 403, 'Anonymous bucket access not denied');
      console.log(JSON.stringify({ configured: true, versioning: true, anonymousDenied: true }));
    } else if (mode === 'probe') {
      const path = bucket + '/storage-proof/' + randomUUID();
      const body = 'Finance isolated persistence proof\n';
      const r = await request('PUT', path, '', body, { 'if-none-match': '*', 'content-type': 'text/plain' });
      const version = r.headers.get('x-amz-version-id');
      expect(r.ok && version && version !== 'null', 'Versioned PUT failed');
      const duplicate = await request('PUT', path, '', 'different synthetic bytes', { 'if-none-match': '*' });
      expect(duplicate.status === 412, 'Conditional PUT did not reject duplicate');
      const fixed = await request('GET', path, 'versionId=' + encode(version));
      expect(fixed.ok && fixed.headers.get('x-amz-version-id') === version && hash(await fixed.text()) === hash(body), 'Fixed version GET failed');
      const anonymous = await fetch(p.endpoint + path + '?versionId=' + encode(version), { redirect: 'error', signal: AbortSignal.timeout(10000) });
      expect(anonymous.status === 403, 'Anonymous fixed GET not denied');
      console.log(JSON.stringify({ versionedPut: true, conditionalPut: 412, fixedGet: true, anonymousDenied: true, proof: { path, version, sha256: hash(body) } }));
    } else if (mode === 'verify-proof') {
      expect(proof.path.startsWith(bucket + '/storage-proof/'), 'Invalid proof path');
      const r = await request('GET', proof.path, 'versionId=' + encode(proof.version));
      expect(r.ok && r.headers.get('x-amz-version-id') === proof.version && hash(await r.text()) === proof.sha256, 'Persistent fixed version verification failed');
      const anonymous = await fetch(p.endpoint + proof.path + '?versionId=' + encode(proof.version), { redirect: 'error', signal: AbortSignal.timeout(10000) });
      expect(anonymous.status === 403, 'Anonymous fixed GET not denied');
      const versioning = await request('GET', bucket, 'versioning=');
      expect(versioning.ok && (await versioning.text()).includes('<Status>Enabled</Status>'), 'Persisted versioning verification failed');
      console.log(JSON.stringify({ fixedVersionShaVerified: true, versioning: true, anonymousDenied: true, anonymousStatus: anonymous.status }));
    } else throw Error('Unsupported operator mode');
  } catch { console.error('Finance local storage operator failed'); process.exitCode = 1; }
}

export function runOperator(profile, mode, proof, container = 'cu16-proof-finance-documents-minio-prepare') {
  if (!['cu16-proof-finance-documents-minio-prepare', 'cu16-proof-finance-documents-storage-1'].includes(container)
      || (container === 'cu16-proof-finance-documents-storage-1' && mode !== 'verify-proof')) throw Error('Unsupported Finance storage target/action');
  const inspected = spawnSync('docker', ['inspect', container], { encoding: 'utf8' });
  if (inspected.status !== 0) throw Error('Own MinIO target unavailable');
  const [c] = JSON.parse(inspected.stdout);
  const finance = spawnSync('docker', ['inspect', 'cu16-proof-finance-1'], { encoding: 'utf8' });
  if (finance.status !== 0) throw Error('Own Finance namespace unavailable');
  const [f] = JSON.parse(finance.stdout);
  const image = spawnSync('docker', ['image', 'inspect', 'cu16-proof-finance-documents:local'], { encoding: 'utf8' });
  if (image.status !== 0 || JSON.parse(image.stdout)[0].Id !== c.Image) throw Error('Unexpected Finance storage image');
  if (c.Config.Labels['autonexus.owner'] !== 'finance' || c.Config.Labels['autonexus.purpose'] !== 'storage-relocation-target'
      || f.Config.Labels['com.docker.compose.service'] !== 'finance'
      || c.HostConfig.NetworkMode !== 'container:' + f.Id || Object.keys(c.HostConfig.PortBindings ?? {}).length
      || c.Config.User !== 'node' || !c.Mounts.some(m => m.Destination === '/data' && m.Name === 'cu16-proof_finance-documents-minio-data')
      || c.Mounts.some(m => m.Destination.startsWith('/run/finance-minio/') && m.RW)) throw Error('Unexpected target ownership/network');
  const result = spawnSync('docker', ['exec', '-i', container, 'node', '-e', '(' + operator.toString() + ')()'], {
    input: JSON.stringify({ profile, mode, proof }), encoding: 'utf8', timeout: 60000,
  });
  if (result.status !== 0) throw Error('Finance local storage operator failed');
  return JSON.parse(result.stdout);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const selected = args.find(arg => arg.startsWith('--container='));
    const container = selected?.slice('--container='.length);
    if (selected) {
      if (args[0] !== '--verify-proof' || args.length !== 2 || !['cu16-proof-finance-documents-minio-prepare', 'cu16-proof-finance-documents-storage-1'].includes(container)) throw Error('Unsupported Finance verification container');
      args.splice(args.indexOf(selected), 1);
    }
    if (args.length > 1 || (args.length && !['--prepare-volume', '--configure', '--probe', '--verify-proof'].includes(args[0]))) throw Error('Unsupported arguments');
    const p = await prepare();
    if (!args.length) console.log('Finance MinIO private target prepared; active profile unchanged');
    else if (args[0] === '--prepare-volume') console.log(JSON.stringify(prepareVolume()));
    else {
      const proofFile = resolve(root, 'output/finance/minio-storage-proof.json');
      let proof;
      if (args[0] !== '--configure') {
        try { proof = JSON.parse(await readFile(proofFile, 'utf8')).proof; }
        catch (error) { if (error.code !== 'ENOENT' || args[0] === '--verify-proof') throw error; }
      }
      if (proof && args[0] === '--probe') args[0] = '--verify-proof';
      const result = runOperator(p, args[0].slice(2), proof, container);
      if (args[0] === '--probe') await writeFile(proofFile, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'proof'))));
    }
  } catch { console.error('Finance MinIO preparation failed; private files preserved (check source, target drift, ownership and readiness)'); process.exitCode = 1; }
}
