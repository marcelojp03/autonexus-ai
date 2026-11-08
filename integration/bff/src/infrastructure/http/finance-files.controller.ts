import { All, Controller, Inject, Optional, Req, Res } from '@nestjs/common';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Request, Response } from 'express';
import type { BffConfiguration } from '../config/environment.js';

const MAX_BYTES = 5 * 1024 * 1024;
const TARGET = new RegExp('^/finance-files/documents/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/content$');
const IMAGE_TYPES = ['image/jpeg', 'image/png'];

export function financeFileValidation(req: Request): number | undefined {
  if (!TARGET.test(req.originalUrl) || req.headers.authorization !== undefined || req.headers.cookie !== undefined
    || !/^[a-fA-F0-9]{64}$/.test(String(req.headers['x-finance-grant'] ?? ''))
    || req.headers['content-encoding'] !== undefined || req.headers['transfer-encoding'] !== undefined) return 400;
  if (req.method !== 'GET' && req.method !== 'PUT') return 405;
  const length = req.headers['content-length'];
  if (req.method === 'GET') return length !== undefined && length !== '0' ? 400 : undefined;
  if (!IMAGE_TYPES.includes(String(req.headers['content-type'])) || !length || !/^[0-9]+$/.test(length) || Number(length) < 1) return 400;
  if (Number(length) > MAX_BYTES) return 413;
  return undefined;
}

export function financeFileHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'attachment');
}

export function financeFileError(res: Response, status: number): void {
  res.setHeader('Connection', 'close');
  res.status(status).json({ statusCode: status, code: status === 408 || status === 504 ? 'DOCUMENT_TRANSFER_TIMEOUT' : 'DOCUMENT_TRANSFER_FAILED', message: 'Request failed' });
}

class TransferError extends Error { constructor(readonly status: number) { super('Document transfer failed'); } }

function readUpload(req: Request, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('aborted', aborted); req.off('error', aborted); };
    const fail = (status: number) => { cleanup(); req.pause(); reject(new TransferError(status)); };
    const data = (chunk: Buffer) => { size += chunk.length; if (size > MAX_BYTES || size > Number(req.headers['content-length'])) fail(413); else chunks.push(chunk); };
    const end = () => { cleanup(); if (size !== Number(req.headers['content-length'])) reject(new TransferError(400)); else resolve(Buffer.concat(chunks, size)); };
    const aborted = () => fail(400);
    const timer = setTimeout(() => fail(408), timeoutMs);
    req.on('data', data); req.once('end', end); req.once('aborted', aborted); req.once('error', aborted);
  });
}

@Controller('finance-files')
export class FinanceFilesController {
  constructor(
    @Inject('BFF_CONFIGURATION') private readonly config: BffConfiguration,
    @Optional() @Inject('FINANCE_FILES_TIMEOUT_MS') private readonly timeoutMs = 15_000,
  ) {}

  @All('documents/:id/content')
  async content(@Req() req: Request, @Res() res: Response): Promise<void> {
    financeFileHeaders(res);
    const invalid = financeFileValidation(req);
    if (invalid) { financeFileError(res, invalid); return; }
    const abort = new AbortController();
    const disconnected = () => abort.abort();
    res.once('close', disconnected);
    try {
      const bytes = req.method === 'PUT' ? await readUpload(req, this.timeoutMs) : Buffer.alloc(0);
      if (res.destroyed) return;
      const result = await this.forward(req, bytes, abort.signal);
      if (req.method === 'GET') res.setHeader('Content-Type', result.contentType!);
      res.status(req.method === 'PUT' ? 204 : 200).send(result.bytes);
    } catch (error) {
      if (!res.destroyed) financeFileError(res, error instanceof TransferError ? error.status : 502);
    } finally { res.off('close', disconnected); }
  }

  private forward(req: Request, bytes: Buffer, signal: AbortSignal): Promise<{ bytes: Buffer; contentType?: string }> {
    const target = new URL(req.originalUrl, this.config.financeUrl);
    const headers: Record<string, string> = { 'X-Finance-Grant': String(req.headers['x-finance-grant']) };
    if (req.method === 'PUT') { headers['Content-Type'] = String(req.headers['content-type']); headers['Content-Length'] = req.headers['content-length']!; }
    return new Promise((resolve, reject) => {
      let response: IncomingMessage | undefined;
      let done = false;
      const finish = (error?: TransferError, result?: { bytes: Buffer; contentType?: string }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) { response?.destroy(); outgoing.destroy(); reject(error); }
        else resolve(result!);
      };
      const outgoing = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: req.method, headers, signal, agent: false }, upstream => {
        response = upstream;
        const status = upstream.statusCode!;
        if (status !== (req.method === 'PUT' ? 204 : 200)) {
          finish(new TransferError([400, 401, 403, 404, 409, 413, 503].includes(status) ? status : 502)); return;
        }
        const contentType = upstream.headers['content-type'];
        const length = upstream.headers['content-length'];
        if (upstream.headers['content-encoding'] !== undefined
          || (req.method === 'GET' && !IMAGE_TYPES.includes(String(contentType)))
          || (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > MAX_BYTES))) { finish(new TransferError(502)); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        upstream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES || (req.method === 'PUT' && size > 0)) finish(new TransferError(502));
          else chunks.push(chunk);
        });
        upstream.once('end', () => {
          if ((req.method === 'GET' && size === 0) || (length !== undefined && size !== Number(length))) finish(new TransferError(502));
          else finish(undefined, { bytes: Buffer.concat(chunks, size), contentType });
        });
        upstream.once('error', () => finish(new TransferError(502)));
        upstream.once('aborted', () => finish(new TransferError(502)));
      });
      const timer = setTimeout(() => finish(new TransferError(504)), this.timeoutMs);
      outgoing.once('error', () => finish(new TransferError(502)));
      outgoing.end(bytes);
    });
  }
}
