import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { AddVehicleHistoryPermission1794142800000 } from './migrations/1794142800000-add-vehicle-history-permission.js';

describe('CU08 history permission migration', () => {
  it('grants only CU08 actor roles, preserves existing grants and records role history', async () => {
    const query = vi.fn();
    await new AddVehicleHistoryPermission1794142800000().up({
      query,
    } as unknown as QueryRunner);
    expect(query.mock.calls.map((call) => call[1])).toEqual([
      ['administrador', 'vehicle-history:read'],
      ['jefe_taller', 'vehicle-history:read'],
      ['recepcionista', 'vehicle-history:read'],
      ['mecanico', 'vehicle-history:read'],
    ]);
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain('UNION SELECT $2::text');
      expect(sql).toContain("sync_status='pending'");
      expect(sql).toContain('security_history');
      expect(sql).not.toContain('DELETE');
    }
  });
});
