/**
 * Static server for the built Shell. Deterministic alternative to `vite preview`
 * for automated acceptance: no stdin dependency, SPA fallback and strict /mfs/ 404.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const directory = resolve(process.argv[2] ?? 'dist');
const port = Number(process.env.PORT ?? 4200);
const host = process.env.HOST ?? '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function send(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  response.end(body);
}

function file(path) {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return path;
}

createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, 'Method not allowed');
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    return send(response, 400, 'Bad request');
  }
  const target = resolve(directory, pathname.slice(1));
  if (!target.startsWith(directory + sep) && target !== directory) return send(response, 404, 'Not found');
  const asset = file(target);
  if (asset) {
    response.writeHead(200, { 'Content-Type': types[extname(asset)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    return request.method === 'HEAD' ? response.end() : createReadStream(asset).pipe(response);
  }
  if (pathname.startsWith('/mfs/')) return send(response, 404, 'Microfrontend resource not found');
  const index = file(resolve(directory, 'index.html'));
  if (!index) return send(response, 404, 'Build output missing');
  response.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-store' });
  return request.method === 'HEAD' ? response.end() : createReadStream(index).pipe(response);
}).listen(port, host, () => console.log(JSON.stringify({ listening: `http://${host}:${port}`, directory })));
