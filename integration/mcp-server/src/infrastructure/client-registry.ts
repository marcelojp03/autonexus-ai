import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { AccessError, MCP_SCOPES, type ClientRegistry, type McpScope } from '../domain/access.js';

const registrySchema = z.strictObject({
  version: z.literal(1),
  clients: z.array(z.strictObject({
    clientId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
    enabled: z.boolean(),
    scopes: z.array(z.enum(MCP_SCOPES)).max(MCP_SCOPES.length).refine(v => new Set(v).size === v.length),
  })).max(32).refine(v => new Set(v.map(c => c.clientId)).size === v.length),
});

export async function readPrivateJson(path: string, maxBytes = 65536): Promise<unknown> {
  if (!isAbsolute(path)) throw new Error('Private configuration unavailable');
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes ||
      (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
      throw new Error('Private configuration unavailable');
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw new Error('Private configuration unavailable');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } finally {
    await file.close();
  }
}

export class FileClientRegistry implements ClientRegistry {
  constructor(private readonly path: string) {}

  async authorize(clientId: string, scopes: readonly McpScope[]): Promise<void> {
    let registry: z.infer<typeof registrySchema>;
    try {
      registry = registrySchema.parse(await readPrivateJson(this.path));
    } catch {
      throw new AccessError('registry_unavailable');
    }
    const client = registry.clients.find(c => c.clientId === clientId);
    if (!client?.enabled) throw new AccessError('client_forbidden');
    if (scopes.some(scope => !client.scopes.includes(scope))) throw new AccessError('insufficient_scope');
  }
}
