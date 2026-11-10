import type { DataSourceOptions } from 'typeorm';
import { AddFinancialLedgerPermissions1794056400000 } from './migrations/1794056400000-add-financial-ledger-permissions.js';
import { AddVehicleHistoryPermission1794142800000 } from './migrations/1794142800000-add-vehicle-history-permission.js';
import { AddAgendaPermissions1793541600000 } from './migrations/1793541600000-add-agenda-permissions.js';
import { AddExecutionPermissions1793628000000 } from './migrations/1793628000000-add-execution-permissions.js';
import { AddIntelligencePermissions1793800800000 } from './migrations/1793800800000-add-intelligence-permissions.js';
import { AddVerificationPermission1793714400000 } from './migrations/1793714400000-add-verification-permission.js';
import { CreateCu151793455200000 } from './migrations/1793455200000-create-cu15.js';
import { databaseEnvironment } from '../config/environment.js';
import { CreateLoginCommands1794312000000 } from './migrations/1794312000000-create-login-commands.js';
import { AddMcpClientManagementPermission1794400000000 } from './migrations/1794400000000-add-mcp-client-management-permission.js';
import { CreatePushInstallations1794486400000 } from './migrations/1794486400000-create-push-installations.js';
import { CreateEmployeesSchema1792886400000 } from './migrations/1792886400000-create-employees-schema.js';
import { CreateEmployeeManagement1793023200000 } from './migrations/1793023200000-create-employee-management.js';
import { CreateScheduling1793109000000 } from './migrations/1793109000000-create-scheduling.js';
import { CreateSecurity1793196000000 } from './migrations/1793196000000-create-security.js';
import { ExtendPermissionsCatalog1793282400000 } from './migrations/1793282400000-extend-permissions-catalog.js';
import { ExtendFlowPermissions1793368800000 } from './migrations/1793368800000-extend-flow-permissions.js';

export function dataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    ...databaseEnvironment(),
    synchronize: false,
    migrationsRun: false,
    entities: [],
    migrations: [
      CreateEmployeesSchema1792886400000,
      CreateEmployeeManagement1793023200000,
      CreateScheduling1793109000000,
      CreateSecurity1793196000000,
      ExtendPermissionsCatalog1793282400000,
      ExtendFlowPermissions1793368800000,
      CreateCu151793455200000,
      AddAgendaPermissions1793541600000,
      AddExecutionPermissions1793628000000,
      AddVerificationPermission1793714400000,
      AddIntelligencePermissions1793800800000,
      AddFinancialLedgerPermissions1794056400000,
      AddVehicleHistoryPermission1794142800000,
      CreateLoginCommands1794312000000,
      AddMcpClientManagementPermission1794400000000,
      CreatePushInstallations1794486400000,
    ],
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
