import { DataSource, type QueryRunner } from 'typeorm';
import { EmployeeError } from '../../domain/employee.js';
import { dataSourceOptions } from './data-source-options.js';

export async function employeeLock(r: QueryRunner, id: string): Promise<void> {
  await r.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'employee:' + id,
  ]);
}
export class Cu15Database {
  private source?: DataSource;
  private initializing?: Promise<DataSource>;
  async database(): Promise<DataSource> {
    this.source ??= new DataSource(dataSourceOptions());
    if (!this.source.isInitialized) {
      this.initializing ??= this.source.initialize();
      try {
        await this.initializing;
      } finally {
        this.initializing = undefined;
      }
    }
    return this.source;
  }
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.initializing;
    } catch {
      /* no initialized pool */
    }
    if (this.source?.isInitialized) await this.source.destroy();
  }
  async transaction<T>(work: (r: QueryRunner) => Promise<T>): Promise<T> {
    let r: QueryRunner | undefined;
    try {
      r = (await this.database()).createQueryRunner();
      await r.connect();
      await r.startTransaction();
      const result = await work(r);
      await r.commitTransaction();
      return result;
    } catch (error) {
      if (r?.isTransactionActive) await r.rollbackTransaction();
      if (error instanceof EmployeeError) throw error;
      throw new EmployeeError(503, 'PERSISTENCE_UNAVAILABLE');
    } finally {
      if (r) await r.release();
    }
  }
}
