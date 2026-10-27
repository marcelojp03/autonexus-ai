import { Module } from '@nestjs/common';
import { EmployeesGraphql } from './application/employees-graphql.js';
import { HttpEmployeesGateway } from './application/employees-gateway.js';
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
      provide: EmployeesGraphql,
      inject: [HttpEmployeesGateway, 'BFF_CONFIGURATION'],
      useFactory: (gateway: HttpEmployeesGateway, config: BffConfiguration) => new EmployeesGraphql(gateway, config.schemaPaths),
    },
  ],
})
export class AppModule {}