import http from 'node:http';
import { mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const LIMIT = 256 * 1024;
const TIMEOUT = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PACKAGE = 'bo.edu.uagrm.autonexus.autonexus_mobile';
const PROOF = fileURLToPath(new URL('../../output/cu27/mobile-loss-proof.json', import.meta.url));
const HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'];

export function isUuid(value) {
  return typeof value === 'string' && value.length === 36 && UUID.test(value);
}

export function forwardHeaders(headers) {
  const excluded = new Set([...HOP, ...(headers.connection ?? '').split(',').map(s => s.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !excluded.has(key.toLowerCase())));
}

export function registration(body, operationId) {
  if (!isUuid(body?.overlayId) || !Array.isArray(body.operations)) return null;
  const rows = body.operations.filter(row => row?.operationId === operationId);
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (row.entity !== 'advance' || !isUuid(row.target?.assignmentId) ||
      row.payload?.operationId !== operationId || typeof row.payload.description !== 'string' ||
      !row.payload.description.length) return null;
  return { overlayId: body.overlayId, assignmentId: row.target.assignmentId, description: row.payload.description };
}

export function acceptedAdvance(status, body, operationId) {
  if (!Number.isInteger(status) || status < 200 || status >= 300 ||
      !Array.isArray(body?.applied) || !body.applied.includes(operationId) || !Array.isArray(body.results)) return null;
  const rows = body.results.filter(row => row?.operationId === operationId);
  if (rows.length !== 1) return null;
  const row = rows[0];
  const id = row.body?.advance?.id;
  return Number.isInteger(row.status) && row.status >= 200 && row.status < 300 && isUuid(id) ? id : null;
}

export function ownerConfirmed(status, body, advanceId, description) {
  if (!Number.isInteger(status) || status < 200 || status >= 300 || !Array.isArray(body?.advances)) return false;
  const matches = body.advances.filter(row => row?.description === description);
  return matches.length === 1 && matches[0].id === advanceId;
}

function json(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { return null; }
}

async function boundedBody(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > LIMIT) throw new Error('BODY_LIMIT');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function upstream(port, path, method, headers, body, signal) {
  return new Promise((resolveResult, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method,
      headers, signal, maxHeaderSize: LIMIT, agent: false }, async response => {
      try {
        const bytes = await boundedBody(response);
        // Never follow a Location, even when the caller supplied credentials.
        if (response.statusCode >= 300 && response.statusCode < 400) throw new Error('REDIRECT');
        resolveResult({ status: response.statusCode, headers: response.headers, bytes });
      } catch (error) { response.destroy(); reject(error); }
    });
    request.on('error', reject);
    request.end(body);
  });
}

function saveProof(proof) {
  mkdirSync(dirname(PROOF), { recursive: true });
  writeFileSync(PROOF + '.tmp', JSON.stringify(proof, null, 2), { mode: 0o600 });
  renameSync(PROOF + '.tmp', PROOF);
}

function forceStop(adb, serial) {
  return new Promise(resolveResult => {
    const child = spawn(adb, ['-s', serial, 'shell', 'am', 'force-stop', PACKAGE], {
      shell: false, stdio: 'ignore', windowsHide: true,
    });
    const timer = setTimeout(() => { child.kill(); resolveResult(false); }, TIMEOUT);
    child.once('error', () => { clearTimeout(timer); resolveResult(false); });
    child.once('exit', code => { clearTimeout(timer); resolveResult(code === 0); });
  });
}

export function main() {
  const operationId = process.env.CU27_DROP_OPERATION;
  const args = process.argv.slice(2);
  if (!isUuid(operationId) || args.some(arg => arg !== '--force-stop') || args.length > 1) {
    console.error('CU27_CONFIG_INVALID: set CU27_DROP_OPERATION to an exact UUID; optional --force-stop');
    process.exitCode = 1; return;
  }
  const serial = process.env.CU27_SERIAL ?? 'ff77c09b1c12';
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(serial)) {
    console.error('CU27_SERIAL_INVALID'); process.exitCode = 1; return;
  }
  const adb = process.env.CU27_ADB ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
  const shouldStop = args.includes('--force-stop');
  if (shouldStop && !existsSync(adb)) {
    console.error('CU27_ADB_NOT_FOUND: set CU27_ADB to the SDK adb executable'); process.exitCode = 1; return;
  }
  let target;
  const overlays = new Set();
  let faultLatched = false;
  let shuttingDown = false;
  const sockets = new Set();
  const controllers = new Set();
  const server = http.createServer({ maxHeaderSize: LIMIT, requestTimeout: TIMEOUT, headersTimeout: TIMEOUT }, async (req, res) => {
    if (faultLatched || shuttingDown) { req.socket.destroy(); return; }
    if (req.method === 'GET' && req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end('{"status":"ready","faultLatched":false}'); return;
    }
    if (!/^\/sync\/[a-zA-Z0-9/_-]*(?:\?[^#\s]*)?$/.test(req.url ?? '') ||
        !['GET', 'POST'].includes(req.method)) {
      res.writeHead(404); res.end(); return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => { controller.abort(); req.socket.destroy(); }, TIMEOUT);
    try {
      const bytes = await boundedBody(req);
      if (faultLatched || shuttingDown) { req.socket.destroy(); return; }
      const candidate = req.method === 'POST' && req.url === '/sync/overlays' ? registration(json(bytes), operationId) : null;
      const response = await upstream(3005, req.url, req.method, forwardHeaders(req.headers), bytes, controller.signal);
      if (candidate && response.status >= 200 && response.status < 300) {
        if (!target || (target.assignmentId === candidate.assignmentId && target.description === candidate.description)) {
          target = { assignmentId: candidate.assignmentId, description: candidate.description };
          if (overlays.size < 128) overlays.add(candidate.overlayId);
        }
      }
      const push = req.method === 'POST' ? /^\/sync\/overlays\/([0-9a-f-]+)\/push$/i.exec(req.url) : null;
      const advanceId = push && overlays.has(push[1]) ? acceptedAdvance(response.status, json(response.bytes), operationId) : null;
      if (!faultLatched && advanceId && target && /^Bearer [^\s]+$/i.test(req.headers.authorization ?? '')) {
        let owner;
        try {
          owner = await upstream(8081, '/executions/me/' + target.assignmentId, 'GET',
            { authorization: req.headers.authorization, accept: 'application/json' }, undefined, controller.signal);
        } catch { console.error('CU27_OWNER_VERIFICATION_UNAVAILABLE'); }
        const ownerBody = owner ? json(owner.bytes) : null;
        if (owner && ownerConfirmed(owner.status, ownerBody, advanceId, target.description) && !faultLatched) {
          faultLatched = true;
          const proof = { status: 'VERIFIED_RESPONSE_DROPPED', operationId, assignmentId: target.assignmentId,
            advanceId, ownerCount: 1, ownerStatus: owner.status, coordinatorStatus: response.status,
            coordinatorApplied: true, responseDropped: true, faultLatched: true,
            ...(Number.isInteger(ownerBody.version) ? { ownerVersion: ownerBody.version } : {}),
            verifiedAt: new Date().toISOString(), forceStopRequested: shouldStop,
            forceStopStatus: shouldStop ? 'pending' : 'not-requested', retryVerified: false };
          for (const socket of sockets) socket.destroy();
          for (const other of controllers) if (other !== controller) other.abort();
          saveProof(proof);
          console.log('CU27_VERIFIED_RESPONSE_DROPPED: output/cu27/mobile-loss-proof.json');
          if (shouldStop) {
            proof.forceStopStatus = await forceStop(adb, serial) ? 'succeeded' : 'failed';
            saveProof(proof);
            console.log(proof.forceStopStatus === 'succeeded' ? 'CU27_FORCE_STOP_SUCCEEDED' : 'CU27_FORCE_STOP_FAILED');
          }
          target = undefined; overlays.clear(); return;
        }
        if (!faultLatched) console.error('CU27_OWNER_VERIFICATION_NOT_CONFIRMED');
      }
      if (faultLatched || shuttingDown) { req.socket.destroy(); return; }
      res.writeHead(response.status, forwardHeaders(response.headers));
      res.end(response.bytes);
    } catch {
      console.error('CU27_REQUEST_FAILED');
      if (!res.headersSent && !res.destroyed) { res.writeHead(502); res.end(); }
    } finally { clearTimeout(timer); controllers.delete(controller); }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(TIMEOUT, () => socket.destroy());
    if (faultLatched || shuttingDown) socket.destroy();
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('error', () => { console.error('CU27_LISTENER_FAILED'); process.exitCode = 1; });
  const shutdown = () => {
    shuttingDown = true;
    for (const controller of controllers) controller.abort();
    for (const socket of sockets) socket.destroy();
    target = undefined; overlays.clear();
    server.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.listen(13005, '127.0.0.1', () => console.log('CU27_PROXY_READY: 127.0.0.1:13005'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
