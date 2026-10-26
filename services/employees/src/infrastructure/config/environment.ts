import { existsSync } from 'node:fs';
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
  return {
    host: env.DB_HOST ?? '127.0.0.1',
    port: port(env.DB_PORT, 55432, 'DB_PORT'),
    database: env.DB_NAME ?? 'autonexus_employees',
    username: env.DB_USER ?? 'autonexus_employees',
    password: env.DB_PASSWORD,
  };
}

export function httpEnvironment(env: NodeJS.ProcessEnv = process.env) {
  return { host: '127.0.0.1', port: port(env.PORT, 3002, 'PORT') };
}
