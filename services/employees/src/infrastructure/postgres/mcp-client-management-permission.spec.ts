import { describe, expect, it, vi } from 'vitest';
import { AddMcpClientManagementPermission1794400000000 } from './migrations/1794400000000-add-mcp-client-management-permission.js';

describe('CU31 permission migration', () => {
  it('grants the narrow permission only to the built-in administrator role and audits the role change', async () => {
    const query = vi.fn(async () => undefined);
    await new AddMcpClientManagementPermission1794400000000().up({ query } as never);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0]!;
    expect(sql).toContain("WHERE name='administrador'");
    expect(sql).toContain("'mcp-clients:manage'");
    expect(sql).toContain("'migration:cu31'");
    expect(sql).not.toContain("WHERE name IN");
  });

  it('does not silently erase permission audit history on rollback', async () => {
    await expect(new AddMcpClientManagementPermission1794400000000().down()).rejects.toThrow(/retention migration/);
  });
});
