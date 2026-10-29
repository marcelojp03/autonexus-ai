import { httpHost } from './transport.js';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

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

export function databaseEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (!env.DB_PASSWORD?.trim()) {
    throw new Error('Missing configuration: DB_PASSWORD');
  }
  const mode = env.DB_SSLMODE ?? 'disable';
  if (!['disable', 'verify-full'].includes(mode)) throw new Error('Invalid configuration: DB_SSLMODE');
  if (env.DB_CA_FILE !== undefined && (mode !== 'verify-full' || !env.DB_CA_FILE)) throw new Error('Invalid configuration: DB_CA_FILE');
  const ssl = mode === 'disable' ? false : { rejectUnauthorized: true, ...(env.DB_CA_FILE ? { ca: readFileSync(env.DB_CA_FILE, 'utf8') } : {}) };
  return {
    ssl,
    host: env.DB_HOST ?? '127.0.0.1',
    port: port(env.DB_PORT, 55432, 'DB_PORT'),
    database: env.DB_NAME ?? 'autonexus_employees',
    username: env.DB_USER ?? 'autonexus_employees',
    password: env.DB_PASSWORD,
  };
}

export function httpEnvironment(env: NodeJS.ProcessEnv = process.env) {
  return { host: httpHost(env.HTTP_HOST), port: port(env.PORT, 3002, 'PORT') };
}
