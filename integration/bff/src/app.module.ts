import { Module } from '@nestjs/common';
import { BusinessGraphql } from './application/business-graphql.js';
import { HttpEmployeesGateway } from './application/employees-gateway.js';
import { HttpOperationsGateway } from './application/operations-gateway.js';
import { HttpFinanceGateway } from './application/finance-gateway.js';
import { HttpAgendaGateway } from './application/agenda-gateway.js';
import { AccessTokenVerifier } from './infrastructure/auth/token-verifier.js';
import { AdministratorGuard } from './infrastructure/auth/administrator.guard.js';
import { bffEnvironment, type BffConfiguration } from './infrastructure/config/environment.js';
import { GraphqlController } from './infrastructure/http/graphql.controller.js';

const configuration = (): BffConfiguration => bffEnvironment();

@Module({
  controllers: [GraphqlController],
  providers: [
    { provide: 'BFF_CONFIGURATION', useFactory: configuration },
    {
      provide: AccessTokenVerifier,
      inject: ['BFF_CONFIGURATION'],
      useFactory: (config: BffConfiguration) => new AccessTokenVerifier(config),
    },
    AdministratorGuard,
    {
      provide: HttpEmployeesGateway,
      inject: ['BFF_CONFIGURATION'],
      useFactory: (config: BffConfiguration) => new HttpEmployeesGateway(config.employeesUrl),
    },
    {
      provide: HttpOperationsGateway,
      inject: ['BFF_CONFIGURATION'],
      useFactory: (config: BffConfiguration) => new HttpOperationsGateway(config.operationsUrl),
    },
    {
      provide: HttpFinanceGateway,
      inject: ['BFF_CONFIGURATION'],
      useFactory: (config: BffConfiguration) => new HttpFinanceGateway(config.financeUrl),
    },
    {
      provide: BusinessGraphql,
      inject: [HttpEmployeesGateway, HttpOperationsGateway, HttpFinanceGateway, 'BFF_CONFIGURATION', HttpAgendaGateway],
      useFactory: (employees: HttpEmployeesGateway, operations: HttpOperationsGateway, finance: HttpFinanceGateway, config: BffConfiguration, agenda: HttpAgendaGateway) =>
        new BusinessGraphql(employees, operations, finance, config.schemaPaths, agenda),
    },
    {
      provide: HttpAgendaGateway,
      inject: ['BFF_CONFIGURATION'],
      useFactory: (config: BffConfiguration) => new HttpAgendaGateway(config.operationsUrl, config.employeesUrl),
    },
  ],
})
export class AppModule {}
