import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export interface AdminClientCredentials { readonly clientId: string; readonly clientSecret: string; }

/** Reads the dedicated technical client from a private, ignored file. Never logs the secret. */
export function adminClientCredentials(): AdminClientCredentials {
  const path = process.env.EMPLOYEES_IDP_CLIENT_FILE;
  if (!path || !isAbsolute(path)) throw new Error('EMPLOYEES_IDP_CLIENT_FILE');
  const value = JSON.parse(readFileSync(path, 'utf8')) as { clientId?: unknown; clientSecret?: unknown };
  if (value.clientId !== 'autonexus-employees-admin' || typeof value.clientSecret !== 'string' || value.clientSecret.length < 16) {
    throw new Error('EMPLOYEES_IDP_CLIENT_FILE');
  }
  return { clientId: value.clientId, clientSecret: value.clientSecret };
}
