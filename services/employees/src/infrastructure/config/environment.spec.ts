import { databaseEnvironment, httpEnvironment } from './environment.js';

describe('environment', () => {
  it('requires a password without printing values', () => {
    expect(() => databaseEnvironment({ DB_HOST: 'private-host', DB_USER: 'private-user' })).toThrow('Missing configuration: DB_PASSWORD');
    expect(() => databaseEnvironment({ DB_PASSWORD: '  ' })).toThrow('Missing configuration: DB_PASSWORD');
  });

  it('defaults to the dedicated local database and loopback HTTP', () => {
    expect(databaseEnvironment({ DB_PASSWORD: 'test-only' })).toEqual({ ssl: false, host: '127.0.0.1', port: 55432, database: 'autonexus_employees', username: 'autonexus_employees', password: 'test-only' });
    expect(httpEnvironment({})).toEqual({ host: '127.0.0.1', port: 3002 });
    expect(httpEnvironment({ PORT: '3012' }).port).toBe(3012);
  });

  it.each(['0', '65536', 'abc', '', '1.5'])('rejects invalid ports (%s)', (value) => {
    expect(() => httpEnvironment({ PORT: value })).toThrow('Invalid configuration: PORT');
    expect(() => databaseEnvironment({ DB_PASSWORD: 'test-only', DB_PORT: value })).toThrow('Invalid configuration: DB_PORT');
  });
});
