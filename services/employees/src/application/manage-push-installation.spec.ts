import { describe, expect, it, vi } from 'vitest';
import { ManagePushInstallation } from './manage-push-installation.js';

describe('ManagePushInstallation', () => {
  it('binds the supplied FID only to the authenticated subject resolved in Employees', async () => {
    const service = new ManagePushInstallation();
    const queries: Array<{sql: string; parameters: unknown[]}> = [];
    vi.spyOn(service, 'transaction').mockImplementation(async (work) => work({
      query: async (sql: string, parameters: unknown[] = []) => {
        queries.push({sql, parameters});
        return sql.startsWith('SELECT id') ? [{id: 'employee-a'}] : [];
      },
    } as never));
    await service.register('subject-from-jwt', {fid: 'a'.repeat(22), appId: 'bo.edu.uagrm.autonexus.autonexus_mobile', platform: 'android'});
    expect(queries[0]?.parameters).toEqual(['subject-from-jwt']);
    expect(queries[1]?.sql).toContain('ON CONFLICT(fid) DO UPDATE');
    expect(queries[1]?.parameters).toEqual(['a'.repeat(22), 'employee-a', 'subject-from-jwt', 'bo.edu.uagrm.autonexus.autonexus_mobile', 'android']);
  });

  it('deactivates only the FID owned by the current JWT subject', async () => {
    const service = new ManagePushInstallation();
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => []);
    vi.spyOn(service, 'transaction').mockImplementation(async (work) => work({query} as never));
    await service.unregister('subject-from-jwt', {fid: 'b'.repeat(22)});
    expect(query.mock.calls[0]?.[0]).toContain('WHERE fid=$1 AND subject=$2');
    expect(query.mock.calls[0]?.[1]).toEqual(['b'.repeat(22), 'subject-from-jwt']);
  });

  it('rejects a caller-supplied employee identity instead of trusting it', async () => {
    const service = new ManagePushInstallation();
    const transaction = vi.spyOn(service, 'transaction');
    await expect(service.register('subject-from-jwt', {
      fid: 'a'.repeat(22), appId: 'bo.edu.uagrm.autonexus.autonexus_mobile', platform: 'android', employeeId: 'attacker',
    })).rejects.toMatchObject({code: 'VALIDATION_ERROR'});
    expect(transaction).not.toHaveBeenCalled();
  });
});
