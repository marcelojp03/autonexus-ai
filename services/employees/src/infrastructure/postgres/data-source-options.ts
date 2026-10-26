import type { DataSourceOptions } from 'typeorm';
import { databaseEnvironment } from '../config/environment.js';
import { CreateEmployeesSchema1792886400000 } from './migrations/1792886400000-create-employees-schema.js';

export function dataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    ...databaseEnvironment(),
    synchronize: false,
    migrationsRun: false,
    entities: [],
    migrations: [CreateEmployeesSchema1792886400000],
    migrationsTableName: 'employees_migrations',
    logging: false,
    installExtensions: false,
    connectTimeoutMS: 1000,
    poolSize: 5,
    poolErrorHandler: () => {},
    extra: {
      connectionTimeoutMillis: 1000,
      query_timeout: 1000,
      statement_timeout: 1000,
      idleTimeoutMillis: 1000,
    },
  };
}
