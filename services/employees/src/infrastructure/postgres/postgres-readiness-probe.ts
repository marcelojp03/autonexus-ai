import type { OnApplicationShutdown } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { ReadinessProbe } from '../../application/readiness-probe.js';

export class PostgresReadinessProbe implements ReadinessProbe, OnApplicationShutdown {
  private initialization?: Promise<DataSource>;

  constructor(private readonly source: DataSource) {}

  async check(): Promise<void> {
    if (!this.source.isInitialized) {
      this.initialization ??= this.source.initialize();
      try {
        await this.initialization;
      } finally {
        this.initialization = undefined;
      }
    }
    await this.source.query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.initialization;
    } catch {
      // Failed initialization leaves no active DataSource to destroy.
    }
    if (this.source.isInitialized) await this.source.destroy();
  }
}
