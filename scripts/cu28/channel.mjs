/**
 * CU28 local test channel. It is the second deduplication barrier of the event flow: n8n already
 * drops an eventId it processed before, and this sink refuses to append it twice as well.
 *
 * POST /channel  -> appends one JSONL line to output/cu28/channel.jsonl (200 recorded / 200 duplicate)
 * GET  /channel   -> counts of records, unique event ids and dropped duplicates
 * GET  /health    -> readiness for the verification script
 *
 * Loopback only by default, no external service, no message leaves the machine. Request logs carry
 * the method, the path, the status and the event id; headers and bodies are never logged.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.CU28_CHANNEL_PORT ?? '5680');
const host = process.env.CU28_CHANNEL_HOST ?? '127.0.0.1';
const file = resolve(workspace, process.env.CU28_CHANNEL_FILE ?? 'output/cu28/channel.jsonl');
const maximumBody = 64 * 1024;
const destinations = new Set((process.env.CU28_CHANNEL_DESTINATIONS ?? 'workshop').split(','));
if ([...destinations].some((id) => !/^[a-z0-9-]{1,64}$/.test(id))) {
  throw new Error('CU28_CHANNEL_INVALID_DESTINATIONS');
}
const deliveryKey = (destinationId, eventId) => `${destinationId}:${eventId}`;

mkdirSync(dirname(file), { recursive: true });

const seen = new Map();
let duplicatesDropped = 0;

if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const key = deliveryKey(record.destinationId ?? 'workshop', record.eventId);
      if (typeof record.eventId === 'string' && !seen.has(key)) seen.set(key, record);
    } catch {
      /* A torn last line is ignored: it was never acknowledged to the workflow. */
    }
  }
}

export const counts = () => {
  const byEventType = {};
  for (const record of seen.values()) {
    const key = typeof record.eventType === 'string' ? record.eventType : 'unknown';
    byEventType[key] = (byEventType[key] ?? 0) + 1;
  }
  const uniqueEventIds = new Set([...seen.values()].map((record) => record.eventId)).size;
  return { file, records: seen.size, uniqueEventIds, duplicatesDropped, byEventType };
};

const json = (response, status, body) => {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
};

const log = (method, path, status, eventId) =>
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), method, path, status, eventId: eventId ?? null }) + '\n');

const server = createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0];

  if (request.method === 'GET' && path === '/health') {
    log('GET', path, 200, null);
    return json(response, 200, { status: 'UP' });
  }
  if (request.method === 'GET' && path === '/channel') {
    log('GET', path, 200, null);
    return json(response, 200, counts());
  }
  const destinationMatch = new RegExp("^/destinations/([a-z0-9-]{1,64})/channel$").exec(path);
  const destinationId = path === '/channel' ? 'workshop' : destinationMatch?.[1];
  if (request.method !== 'POST' || !destinationId) {
    log(request.method ?? 'UNKNOWN', path, 405, null);
    return json(response, 405, { error: 'CU28_CHANNEL_METHOD_NOT_ALLOWED' });
  }
  if (!destinations.has(destinationId)) {
    request.resume();
    log('POST', path, 404, null);
    return json(response, 404, { error: 'CU28_RECIPIENT_NOT_FOUND', destinationId });
  }

  const chunks = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size <= maximumBody) chunks.push(chunk);
  });
  request.on('end', () => {
    if (size > maximumBody) {
      log('POST', path, 413, null);
      return json(response, 413, { error: 'CU28_CHANNEL_PAYLOAD_TOO_LARGE' });
    }
    let event;
    try {
      event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      log('POST', path, 400, null);
      return json(response, 400, { error: 'CU28_CHANNEL_INVALID_JSON' });
    }
    const eventId = event && typeof event.eventId === 'string' ? event.eventId : '';
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(eventId)) {
      log('POST', path, 400, null);
      return json(response, 400, { error: 'CU28_CHANNEL_EVENT_ID_REQUIRED' });
    }
    const key = deliveryKey(destinationId, eventId);
    if (seen.has(key)) {
      duplicatesDropped += 1;
      log('POST', path, 200, eventId);
      return json(response, 200, { status: 'duplicate', eventId, destinationId, ...counts() });
    }
    const record = {
      receivedAt: new Date().toISOString(),
      eventId,
      destinationId,
      eventType: typeof event.eventType === 'string' ? event.eventType : null,
      event,
    };
    appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
    seen.set(key, record);
    log('POST', path, 200, eventId);
    return json(response, 200, { status: 'recorded', eventId, destinationId, ...counts() });
  });
});

server.listen(port, host, () => {
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), listening: `${host}:${server.address().port}`, file, restored: seen.size }) + '\n');
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGBREAK', stop);
