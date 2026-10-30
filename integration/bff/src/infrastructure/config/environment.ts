import { trustedHttpUrl, exactOrigin, httpHost } from './transport.js';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const LOCAL_ISSUER = 'http://127.0.0.1:8180/realms/autonexus';
const OWN_AUDIENCE = 'autonexus-employees-api';
const LOCAL_ORIGINS = [4200, 4201, 4202, 4204].map((port) => `http://127.0.0.1:${port}`);

export function loadLocalEnvironment(): void {
  if (existsSync('.env')) loadEnvFile('.env');
}

function port(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid configuration: ${name}`);
  }
  return parsed;
}

export interface BffConfiguration {
  readonly host: string;
  readonly jwksUri: string;
  readonly port: number;
  readonly employeesUrl: string;
  readonly operationsUrl: string;
  readonly financeUrl: string;
  readonly issuer: string;
  readonly audience: string;
  readonly origins: readonly string[];
  readonly schemaPaths: readonly string[];
}

export function bffEnvironment(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): BffConfiguration {
  const issuer = env.OIDC_ISSUER_URI ?? LOCAL_ISSUER;
  const audience = env.OIDC_AUDIENCE ?? OWN_AUDIENCE;
  const origins = env.WEB_ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()) ?? LOCAL_ORIGINS;
  const employeesUrl = env.EMPLOYEES_API_URL ?? 'http://127.0.0.1:3002';
  const operationsUrl = env.OPERATIONS_API_URL ?? 'http://127.0.0.1:8081';
  const financeUrl = env.FINANCE_API_URL ?? 'http://127.0.0.1:8000';
  const schemaPath = env.BFF_SCHEMA_PATH ?? resolve(cwd, '../../contracts/graphql/employees.graphql');
  const scheduleSchema = env.BFF_SCHEDULE_SCHEMA_PATH ?? resolve(cwd, '../../contracts/graphql/schedules.graphql');
  const securitySchema = env.BFF_SECURITY_SCHEMA_PATH ?? resolve(cwd, '../../contracts/graphql/security.graphql');
  const operationsSchema = env.BFF_OPERATIONS_SCHEMA_PATH ?? resolve(cwd, '../../contracts/graphql/operations.graphql');
  const financeSchema = env.BFF_FINANCE_SCHEMA_PATH ?? resolve(cwd, '../../contracts/graphql/finance.graphql');
  const confirmationSchema = env.BFF_CONFIRMATIONS_SCHEMA_PATH ?? resolve(cwd, '../../contracts/graphql/confirmations.graphql');
  const agendaSchema = env.BFF_AGENDA_SCHEMA_PATH ?? resolve(cwd, '../../contracts/graphql/agenda.graphql');
  const executionsSchema = env.BFF_EXECUTIONS_SCHEMA_PATH ?? resolve(cwd, '../../contracts/graphql/executions.graphql');
  trustedHttpUrl(issuer, 'OIDC_ISSUER_URI');
  const jwksUri = env.OIDC_JWKS_URI ?? LOCAL_ISSUER + '/protocol/openid-connect/certs';
  trustedHttpUrl(jwksUri, 'OIDC_JWKS_URI');
  if (audience !== OWN_AUDIENCE) throw new Error('Invalid configuration: OIDC_AUDIENCE');
  if (!origins.length || origins.some((origin) => !exactOrigin(origin))) {
    throw new Error('Invalid configuration: WEB_ALLOWED_ORIGINS');
  }
  const target = trustedHttpUrl(employeesUrl, 'EMPLOYEES_API_URL');
  const operationsTarget = trustedHttpUrl(operationsUrl, 'OPERATIONS_API_URL');
  const financeTarget = trustedHttpUrl(financeUrl, 'FINANCE_API_URL');
  for (const [name, url] of [['EMPLOYEES_API_URL', target], ['OPERATIONS_API_URL', operationsTarget], ['FINANCE_API_URL', financeTarget]] as const) {
    if (url.pathname !== '/') throw new Error(`Invalid configuration: ${name}`);
  }
  if (!isAbsolute(schemaPath) || !existsSync(schemaPath)) throw new Error('Invalid configuration: BFF_SCHEMA_PATH');
  if (!isAbsolute(scheduleSchema) || !existsSync(scheduleSchema)) throw new Error('Invalid configuration: BFF_SCHEDULE_SCHEMA_PATH');
  if (!isAbsolute(securitySchema) || !existsSync(securitySchema)) throw new Error('Invalid configuration: BFF_SECURITY_SCHEMA_PATH');
  if (!isAbsolute(operationsSchema) || !existsSync(operationsSchema)) throw new Error('Invalid configuration: BFF_OPERATIONS_SCHEMA_PATH');
  if (!isAbsolute(financeSchema) || !existsSync(financeSchema)) throw new Error('Invalid configuration: BFF_FINANCE_SCHEMA_PATH');
  if (!isAbsolute(confirmationSchema) || !existsSync(confirmationSchema)) throw new Error('Invalid configuration: BFF_CONFIRMATIONS_SCHEMA_PATH');
  if (!isAbsolute(agendaSchema) || !existsSync(agendaSchema) || !statSync(agendaSchema).isFile()) throw new Error('Invalid configuration: BFF_AGENDA_SCHEMA_PATH');
  if (!isAbsolute(executionsSchema) || !existsSync(executionsSchema) || !statSync(executionsSchema).isFile()) throw new Error('Invalid configuration: BFF_EXECUTIONS_SCHEMA_PATH');
  return Object.freeze({
    host: httpHost(env.HTTP_HOST),
    jwksUri,
    port: port(env.PORT, 3004, 'PORT'),
    employeesUrl: target.origin,
    issuer,
    audience,
    origins: Object.freeze([...new Set(origins)]),
    operationsUrl: operationsTarget.origin,
    financeUrl: financeTarget.origin,
    schemaPaths: Object.freeze([schemaPath, scheduleSchema, securitySchema, operationsSchema, financeSchema, confirmationSchema, agendaSchema, executionsSchema]),
  });
}
