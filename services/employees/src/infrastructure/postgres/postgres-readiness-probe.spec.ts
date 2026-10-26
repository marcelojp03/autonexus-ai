import type { DataSource } from 'typeorm';
import { PostgresReadinessProbe } from './postgres-readiness-probe.js';

function fakeSource() {
  const source = {
    isInitialized: false,
    initialize: vi.fn(async () => { source.isInitialized = true; return source as unknown as DataSource; }),
    query: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    destroy: vi.fn(async () => { source.isInitialized = false; }),
  };
  return source;
}

describe('PostgresReadinessProbe (fake DataSource)', () => {
  it('shares concurrent initialization, queries on every check and closes resources', async () => {
    const source = fakeSource();
    const probe = new PostgresReadinessProbe(source as unknown as DataSource);
    await Promise.all([probe.check(), probe.check()]);
    expect(source.initialize).toHaveBeenCalledOnce();
    expect(source.query).toHaveBeenCalledTimes(2);
    expect(source.query).toHaveBeenCalledWith('SELECT 1');
    await probe.onApplicationShutdown();
    expect(source.destroy).toHaveBeenCalledOnce();
  });

  it('retries failed initialization on the next check', async () => {
    const source = fakeSource();
    source.initialize.mockRejectedValueOnce(new Error('offline'));
    const probe = new PostgresReadinessProbe(source as unknown as DataSource);
    await expect(probe.check()).rejects.toThrow('offline');
    await probe.check();
    expect(source.initialize).toHaveBeenCalledTimes(2);
    await probe.onApplicationShutdown();
  });

  it('propagates query failure and recovers without replacing the pool', async () => {
    const source = fakeSource();
    const probe = new PostgresReadinessProbe(source as unknown as DataSource);
    await probe.check();
    source.query.mockRejectedValueOnce(new Error('offline'));
    await expect(probe.check()).rejects.toThrow('offline');
    await probe.check();
    expect(source.initialize).toHaveBeenCalledOnce();
    await probe.onApplicationShutdown();
  });

  it('does not destroy an uninitialized source', async () => {
    const source = fakeSource();
    await new PostgresReadinessProbe(source as unknown as DataSource).onApplicationShutdown();
    expect(source.destroy).not.toHaveBeenCalled();
  });
});
