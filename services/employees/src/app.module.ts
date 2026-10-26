import { Module } from '@nestjs/common';
import { AuthModule } from './infrastructure/auth/auth.module.js';
import { TechnicalController } from './infrastructure/http/technical.controller.js';
import { DataSource } from 'typeorm';
import { CheckReadiness } from './application/check-readiness.js';
import { HealthController } from './infrastructure/http/health.controller.js';
import { dataSourceOptions } from './infrastructure/postgres/data-source-options.js';
import { PostgresReadinessProbe } from './infrastructure/postgres/postgres-readiness-probe.js';

@Module({
  imports: [AuthModule],
  controllers: [HealthController, TechnicalController],
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
