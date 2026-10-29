import { readFile } from 'node:fs/promises';
import { object, only } from '../../domain/employee.js';
export interface BrokerConfiguration {
  hostname: string;
  port: number;
  vhost: string;
  username: string;
  password: string;
  heartbeat: number;
}
export async function brokerConfiguration(): Promise<BrokerConfiguration> {
  const path = process.env.CU15_BROKER_CLIENT_FILE;
  if (!path) throw new Error('CU15_BROKER_CONFIGURATION_REQUIRED');
  try {
    const v = object(JSON.parse(await readFile(path, 'utf8')));
    only(v, ['host', 'port', 'vhost', 'username', 'password']);
    if (
      typeof v.host !== 'string' ||
      !v.host ||
      !Number.isInteger(v.port) ||
      Number(v.port) < 1 ||
      Number(v.port) > 65535 ||
      v.vhost !== 'autonexus' ||
      typeof v.username !== 'string' ||
      !v.username ||
      typeof v.password !== 'string' ||
      !v.password
    )
      throw new Error();
    return {
      hostname: v.host,
      port: v.port as number,
      vhost: v.vhost,
      username: v.username,
      password: v.password,
      heartbeat: 10,
    };
  } catch {
    throw new Error('CU15_BROKER_CONFIGURATION_INVALID');
  }
}
