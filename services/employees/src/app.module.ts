import { Module } from '@nestjs/common';
import { ManageEmployees } from './application/manage-employees.js';
import { EmployeesController } from './infrastructure/http/employees.controller.js';
import { PostgresEmployeeRepository } from './infrastructure/postgres/postgres-employee-repository.js';
import { KeycloakIdentityGateway } from './infrastructure/keycloak/keycloak-identity-gateway.js';
import { AuthModule } from './infrastructure/auth/auth.module.js';
import { TechnicalController } from './infrastructure/http/technical.controller.js';
import { DataSource } from 'typeorm';
import { CheckReadiness } from './application/check-readiness.js';
import { HealthController } from './infrastructure/http/health.controller.js';
import { dataSourceOptions } from './infrastructure/postgres/data-source-options.js';
import { PostgresReadinessProbe } from './infrastructure/postgres/postgres-readiness-probe.js';

@Module({
  imports: [AuthModule],
  controllers: [HealthController, TechnicalController, EmployeesController],
  providers: [
    {
      provide: PostgresEmployeeRepository,
      useFactory: () => new PostgresEmployeeRepository(),
    },
    {
      provide: KeycloakIdentityGateway,
      useFactory: () => new KeycloakIdentityGateway(),
    },
    {
      provide: ManageEmployees,
      inject: [PostgresEmployeeRepository, KeycloakIdentityGateway],
      useFactory: (
        repository: PostgresEmployeeRepository,
        identity: KeycloakIdentityGateway,
      ) => new ManageEmployees(repository, identity),
    },
    {
      provide: PostgresReadinessProbe,
      useFactory: () =>
        new PostgresReadinessProbe(new DataSource(dataSourceOptions())),
    },
    {
      provide: CheckReadiness,
      inject: [PostgresReadinessProbe],
      useFactory: (probe: PostgresReadinessProbe) => new CheckReadiness(probe),
    },
  ],
})
export class AppModule {}
