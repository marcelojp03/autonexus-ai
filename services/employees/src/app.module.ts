import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CheckReadiness } from './application/check-readiness.js';
import { HealthController } from './infrastructure/http/health.controller.js';
import { dataSourceOptions } from './infrastructure/postgres/data-source-options.js';
import { PostgresReadinessProbe } from './infrastructure/postgres/postgres-readiness-probe.js';

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: PostgresReadinessProbe,
      useFactory: () => new PostgresReadinessProbe(new DataSource(dataSourceOptions())),
    },
    {
      provide: CheckReadiness,
      inject: [PostgresReadinessProbe],
      useFactory: (probe: PostgresReadinessProbe) => new CheckReadiness(probe),
    },
  ],
})
export class AppModule {}
