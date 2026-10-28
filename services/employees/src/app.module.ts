import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AuthorizeActor } from './application/authorize-actor.js';
import { CheckReadiness } from './application/check-readiness.js';
import { ManageEmployees } from './application/manage-employees.js';
import { ManageSchedules } from './application/manage-schedules.js';
import { ManageSecurity } from './application/manage-security.js';
import { AuthModule } from './infrastructure/auth/auth.module.js';
import { JwtPolicyGuard } from './infrastructure/auth/jwt-policy.guard.js';
import { EmployeesController } from './infrastructure/http/employees.controller.js';
import { HealthController } from './infrastructure/http/health.controller.js';
import { SecurityController } from './infrastructure/http/security.controller.js';
import { StaffingController } from './infrastructure/http/staffing.controller.js';
import { TechnicalController } from './infrastructure/http/technical.controller.js';
import { KeycloakIdentityGateway } from './infrastructure/keycloak/keycloak-identity-gateway.js';
import { KeycloakRoleGateway } from './infrastructure/keycloak/keycloak-role-gateway.js';
import { dataSourceOptions } from './infrastructure/postgres/data-source-options.js';
import { PostgresEmployeeRepository } from './infrastructure/postgres/postgres-employee-repository.js';
import { PostgresReadinessProbe } from './infrastructure/postgres/postgres-readiness-probe.js';
import { PostgresScheduleRepository } from './infrastructure/postgres/postgres-schedule-repository.js';
import { PostgresSecurityRepository } from './infrastructure/postgres/postgres-security-repository.js';

@Module({
  imports: [AuthModule],
  controllers: [HealthController, TechnicalController, EmployeesController, StaffingController, SecurityController],
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
      provide: PostgresScheduleRepository,
      useFactory: () => new PostgresScheduleRepository(),
    },
    {
      provide: ManageSchedules,
      inject: [PostgresScheduleRepository],
      useFactory: (repository: PostgresScheduleRepository) => new ManageSchedules(repository),
    },
    {
      provide: PostgresSecurityRepository,
      useFactory: () => new PostgresSecurityRepository(),
    },
    {
      provide: KeycloakRoleGateway,
      useFactory: () => new KeycloakRoleGateway(),
    },
    {
      provide: AuthorizeActor,
      inject: [PostgresSecurityRepository],
      useFactory: (repository: PostgresSecurityRepository) => new AuthorizeActor(repository),
    },
    {
      provide: ManageSecurity,
      inject: [PostgresSecurityRepository, KeycloakRoleGateway],
      useFactory: (repository: PostgresSecurityRepository, roles: KeycloakRoleGateway) => new ManageSecurity(repository, roles),
    },
    { provide: APP_GUARD, useClass: JwtPolicyGuard },
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
