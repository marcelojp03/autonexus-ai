import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';

const require = createRequire(new URL('../../../services/employees/package.json', import.meta.url));
const { Client } = require('pg');
const settings = name => parseEnv(readFileSync(new URL('../../../services/' + name + '/.env', import.meta.url), 'utf8'));
const configurations = { operations: settings('operations'), employees: settings('employees') };
const requireMigrations = process.argv.includes('--require-migrations');
const results = [];

async function connect(configuration, database = configuration.DB_NAME) {
  const client = new Client({
    host: configuration.DB_HOST, port: Number(configuration.DB_PORT), database,
    user: configuration.DB_USER, password: configuration.DB_PASSWORD,
    connectionTimeoutMillis: 1500, query_timeout: 1500,
  });
  try { await client.connect(); return client; }
  catch (error) { await client.end().catch(() => {}); throw error; }
}

try {
  for (const name of ['operations', 'employees']) {
    const configuration = configurations[name];
    const other = configurations[name === 'operations' ? 'employees' : 'operations'];
    const client = await connect(configuration);
    try {
      const identity = (await client.query("SELECT current_database() AS database, current_user AS role, current_setting('server_version') AS version")).rows[0];
      if (identity.database !== configuration.DB_NAME || identity.role !== configuration.DB_USER) throw new Error('Unexpected database identity.');
      const permissions = (await client.query('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user')).rows[0];
      if (!permissions || Object.values(permissions).some(Boolean)) throw new Error('An application role has elevated privileges.');
      let migrationCount;
      if (requireMigrations) {
        const schema = (await client.query('SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS present', [name])).rows[0];
        if (!schema.present) throw new Error('Service schema is missing.');
        const table = name === 'operations' ? 'flyway_schema_history' : 'employees_migrations';
        const history = await client.query('SELECT count(*)::int AS count FROM public."' + table + '"');
        migrationCount = history.rows[0].count;
        if (migrationCount < 1) throw new Error('Migration history is empty.');
        if (name === 'operations' && (await client.query('SELECT count(*)::int AS count FROM public.flyway_schema_history WHERE NOT success')).rows[0].count !== 0) throw new Error('A Flyway migration failed.');
      }
      let deniedConnections = 0;
      for (const database of [other.DB_NAME, 'postgres', 'template1']) {
        let foreign;
        try { foreign = await connect(configuration, database); }
        catch (error) {
          if (error.code !== '42501') throw new Error('Connection failed for a reason other than database permission.');
          deniedConnections++;
        } finally { if (foreign) await foreign.end(); }
        if (foreign) throw new Error('Application role can access a database outside its owner.');
      }
      results.push({ service: name, ownConnection: true, elevatedPrivileges: false, deniedConnections, postgresVersion: identity.version, ...(requireMigrations ? { migrationCount } : {}) });
    } finally { await client.end(); }
  }
  console.log(JSON.stringify({ pass: true, results }));
} catch {
  console.error('Database isolation/migration verification failed. Connection details were not printed.');
  process.exitCode = 1;
}
