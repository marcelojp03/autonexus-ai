import { open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  AccessError,
  MCP_SCOPES,
  type ClientRegistry,
  type McpScope,
} from "../domain/access.js";

const registrySchema = z.strictObject({
  version: z.literal(1),
  clients: z
    .array(
      z.strictObject({
        clientId: z
          .string()
          .min(1)
          .max(200)
          .regex(/^[A-Za-z0-9._:-]+$/),
        displayName: z.string().min(1).max(120).optional(),
        enabled: z.boolean(),
        scopes: z
          .array(z.enum(MCP_SCOPES))
          .max(MCP_SCOPES.length)
          .refine((v) => new Set(v).size === v.length),
      }),
    )
    .max(32)
    .refine((v) => new Set(v.map((c) => c.clientId)).size === v.length),
});

export async function readPrivateJson(
  path: string,
  maxBytes = 65536,
): Promise<unknown> {
  if (!isAbsolute(path)) throw new Error("Private configuration unavailable");
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.size > maxBytes ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    ) {
      throw new Error("Private configuration unavailable");
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes)
      throw new Error("Private configuration unavailable");
    return JSON.parse(
      buffer.subarray(0, bytesRead).toString("utf8"),
    ) as unknown;
  } finally {
    await file.close();
  }
}

export class FileClientRegistry implements ClientRegistry {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}

  async list(): Promise<
    readonly {
      clientId: string;
      displayName: string;
      enabled: boolean;
      scopes: readonly McpScope[];
    }[]
  > {
    const registry = registrySchema.parse(await readPrivateJson(this.path));
    return registry.clients.map((client) => ({
      clientId: client.clientId,
      displayName: client.displayName ?? client.clientId,
      enabled: client.enabled,
      scopes: [...client.scopes],
    }));
  }

  async upsert(input: {
    clientId: string;
    displayName: string;
    enabled: boolean;
    scopes: readonly McpScope[];
  }): Promise<void> {
    await this.serialize(async () => {
      let registry: z.infer<typeof registrySchema>;
      try {
        registry = registrySchema.parse(await readPrivateJson(this.path));
      } catch {
        throw new AccessError("registry_unavailable");
      }
      const client = { ...input, scopes: [...input.scopes] };
      const index = registry.clients.findIndex(
        (item) => item.clientId === input.clientId,
      );
      if (index < 0 && registry.clients.length >= 32)
        throw new Error("registry_limit");
      const clients = [...registry.clients];
      if (index < 0) clients.push(client);
      else clients[index] = client;
      await this.persist(registrySchema.parse({ version: 1, clients }));
    });
  }

  async create(input: {
    clientId: string;
    displayName: string;
    enabled: boolean;
    scopes: readonly McpScope[];
  }): Promise<void> {
    await this.serialize(async () => {
      let registry: z.infer<typeof registrySchema>;
      try {
        registry = registrySchema.parse(await readPrivateJson(this.path));
      } catch {
        throw new AccessError("registry_unavailable");
      }
      if (registry.clients.some((client) => client.clientId === input.clientId))
        throw new Error("client_duplicate");
      if (registry.clients.length >= 32) throw new Error("registry_limit");
      await this.persist(
        registrySchema.parse({
          version: 1,
          clients: [
            ...registry.clients,
            { ...input, scopes: [...input.scopes] },
          ],
        }),
      );
    });
  }

  async update(input: {
    clientId: string;
    displayName: string;
    enabled: boolean;
    scopes: readonly McpScope[];
  }): Promise<void> {
    await this.serialize(async () => {
      let registry: z.infer<typeof registrySchema>;
      try {
        registry = registrySchema.parse(await readPrivateJson(this.path));
      } catch {
        throw new AccessError("registry_unavailable");
      }
      const index = registry.clients.findIndex(
        (client) => client.clientId === input.clientId,
      );
      if (index < 0) throw new Error("client_not_found");
      const clients = [...registry.clients];
      clients[index] = { ...input, scopes: [...input.scopes] };
      await this.persist(registrySchema.parse({ version: 1, clients }));
    });
  }

  async setEnabled(clientId: string, enabled: boolean): Promise<void> {
    await this.serialize(async () => {
      let registry: z.infer<typeof registrySchema>;
      try {
        registry = registrySchema.parse(await readPrivateJson(this.path));
      } catch {
        throw new AccessError("registry_unavailable");
      }
      const clients = registry.clients.map((client) =>
        client.clientId === clientId ? { ...client, enabled } : client,
      );
      if (clients.every((client, index) => client === registry.clients[index]))
        throw new Error("client_not_found");
      await this.persist(registrySchema.parse({ version: 1, clients }));
    });
  }

  async revoke(clientId: string): Promise<void> {
    await this.serialize(async () => {
      let registry: z.infer<typeof registrySchema>;
      try {
        registry = registrySchema.parse(await readPrivateJson(this.path));
      } catch {
        throw new AccessError("registry_unavailable");
      }
      const clients = registry.clients.filter(
        (client) => client.clientId !== clientId,
      );
      if (clients.length === registry.clients.length)
        throw new Error("client_not_found");
      await this.persist(registrySchema.parse({ version: 1, clients }));
    });
  }

  private serialize(action: () => Promise<void>): Promise<void> {
    const next = this.writes.then(action, action);
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async persist(value: z.infer<typeof registrySchema>): Promise<void> {
    const temp = join(dirname(this.path), `.mcp-clients-${randomUUID()}.tmp`);
    try {
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(value));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, this.path);
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }

  async authorize(
    clientId: string,
    scopes: readonly McpScope[],
  ): Promise<void> {
    let registry: z.infer<typeof registrySchema>;
    try {
      registry = registrySchema.parse(await readPrivateJson(this.path));
    } catch {
      throw new AccessError("registry_unavailable");
    }
    const client = registry.clients.find((c) => c.clientId === clientId);
    if (!client?.enabled) throw new AccessError("client_forbidden");
    if (scopes.some((scope) => !client.scopes.includes(scope)))
      throw new AccessError("insufficient_scope");
  }
}
