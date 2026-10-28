import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const LOCAL_ISSUER = 'http://127.0.0.1:8180/realms/autonexus';
const OWN_AUDIENCE = 'autonexus-employees-api';
const LOCAL_ORIGINS = [4200, 4201, 4202].map((port) => `http://127.0.0.1:${port}`);

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
  if (issuer !== LOCAL_ISSUER) throw new Error('Invalid configuration: OIDC_ISSUER_URI');
  if (audience !== OWN_AUDIENCE) throw new Error('Invalid configuration: OIDC_AUDIENCE');
  if (!origins.length || origins.some((origin) => !LOCAL_ORIGINS.includes(origin))) {
    throw new Error('Invalid configuration: WEB_ALLOWED_ORIGINS');
  }
  let target: URL;
  try {
    target = new URL(employeesUrl);
  } catch {
    throw new Error('Invalid configuration: EMPLOYEES_API_URL');
  }
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('Invalid configuration: EMPLOYEES_API_URL');
  }
  let operationsTarget: URL;
  try {
    operationsTarget = new URL(operationsUrl);
  } catch {
    throw new Error('Invalid configuration: OPERATIONS_API_URL');
  }
  if (operationsTarget.protocol !== 'http:' || operationsTarget.hostname !== '127.0.0.1' || operationsTarget.pathname !== '/' || operationsTarget.search || operationsTarget.hash) {
    throw new Error('Invalid configuration: OPERATIONS_API_URL');
  }
  let financeTarget: URL;
  try {
    financeTarget = new URL(financeUrl);
  } catch {
    throw new Error('Invalid configuration: FINANCE_API_URL');
  }
  if (financeTarget.protocol !== 'http:' || financeTarget.hostname !== '127.0.0.1' || financeTarget.pathname !== '/' || financeTarget.search || financeTarget.hash) {
    throw new Error('Invalid configuration: FINANCE_API_URL');
  }
  if (!isAbsolute(schemaPath) || !existsSync(schemaPath)) throw new Error('Invalid configuration: BFF_SCHEMA_PATH');
  if (!isAbsolute(scheduleSchema) || !existsSync(scheduleSchema)) throw new Error('Invalid configuration: BFF_SCHEDULE_SCHEMA_PATH');
  if (!isAbsolute(securitySchema) || !existsSync(securitySchema)) throw new Error('Invalid configuration: BFF_SECURITY_SCHEMA_PATH');
  if (!isAbsolute(operationsSchema) || !existsSync(operationsSchema)) throw new Error('Invalid configuration: BFF_OPERATIONS_SCHEMA_PATH');
  if (!isAbsolute(financeSchema) || !existsSync(financeSchema)) throw new Error('Invalid configuration: BFF_FINANCE_SCHEMA_PATH');
  return Object.freeze({
    port: port(env.PORT, 3004, 'PORT'),
    employeesUrl: target.origin,
    issuer,
    audience,
    origins: Object.freeze([...new Set(origins)]),
    operationsUrl: operationsTarget.origin,
    financeUrl: financeTarget.origin,
    schemaPaths: Object.freeze([schemaPath, scheduleSchema, securitySchema, operationsSchema, financeSchema]),
  });
}