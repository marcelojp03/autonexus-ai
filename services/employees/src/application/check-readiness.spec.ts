import { CheckReadiness } from './check-readiness.js';

describe('CheckReadiness (fake probe)', () => {
  it('reports UP after the probe resolves', async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    await expect(new CheckReadiness({ check }).execute()).resolves.toEqual({ status: 'UP' });
    expect(check).toHaveBeenCalledOnce();
  });

  it('sanitizes failure and recovers on the same instance', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('private SQL host user password')).mockResolvedValue(undefined);
    const readiness = new CheckReadiness({ check });
    await expect(readiness.execute()).resolves.toEqual({ status: 'DOWN' });
    await expect(readiness.execute()).resolves.toEqual({ status: 'UP' });
  });
});
