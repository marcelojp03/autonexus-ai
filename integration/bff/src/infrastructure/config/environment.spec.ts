import { describe, expect, it } from 'vitest';
import { bffEnvironment } from './environment.js';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { buildSchema } from 'graphql';

describe('finance standalone origin', () => {
  it('registers the CU15 schema and fails closed on an invalid override', () => {
    expect(bffEnvironment({}).schemaPaths[5]).toMatch(/confirmations.graphql$/);
    expect(() => bffEnvironment({ BFF_CONFIRMATIONS_SCHEMA_PATH: 'missing.graphql' })).toThrow('BFF_CONFIRMATIONS_SCHEMA_PATH');
  });
  it('includes 4204 by default and permits an explicit finance-only origin', () => {
    expect(bffEnvironment({}).origins).toContain('http://127.0.0.1:4204');
    expect(bffEnvironment({ WEB_ALLOWED_ORIGINS: 'http://127.0.0.1:4204' }).origins).toEqual(['http://127.0.0.1:4204']);
  });
  it('rejects wildcard, credentials and non-origins', () => {
    for (const origin of ['*', 'http://localhost:4204/path', 'https://u:p@outside.invalid']) {
      expect(() => bffEnvironment({ WEB_ALLOWED_ORIGINS: origin })).toThrow('WEB_ALLOWED_ORIGINS');
    }
  });
});

describe('CU25/CU26 assistant schema and owner origin', () => {
  it('defaults to the local assistant process and rejects paths or credentials in the URL', () => {
    expect(bffEnvironment({}).assistantUrl).toBe('http://127.0.0.1:3099');
    expect(bffEnvironment({ ASSISTANT_API_URL: 'http://127.0.0.1:3099/' }).assistantUrl).toBe('http://127.0.0.1:3099');
    for (const url of ['http://127.0.0.1:3099/assistant', 'http://127.0.0.1:3099?url=other', 'file:///tmp/assistant']) {
      expect(() => bffEnvironment({ ASSISTANT_API_URL: url })).toThrow('ASSISTANT_API_URL');
    }
  });
  it('registers the assistant SDL and fails closed on a missing override', () => {
    const schema = resolve('../../contracts/graphql/assistant.graphql');
    expect(bffEnvironment({ BFF_ASSISTANT_SCHEMA_PATH: schema }).schemaPaths[10]).toBe(schema);
    for (const path of ['assistant.graphql', resolve('missing-assistant.graphql'), resolve('../../contracts/graphql'), '']) {
      expect(() => bffEnvironment({ BFF_ASSISTANT_SCHEMA_PATH: path })).toThrow('BFF_ASSISTANT_SCHEMA_PATH');
    }
  });
});

describe('CU05 seventh, CU23 ninth and CU27 tenth schemas without transport-policy changes', () => {
  it('uses only the configured sync origin and validates the sync schema override', () => {
    expect(bffEnvironment({}).syncUrl).toBe('http://127.0.0.1:3005');
    expect(bffEnvironment({ SYNC_API_URL: 'http://127.0.0.1:3015/' }).syncUrl).toBe('http://127.0.0.1:3015');
    for (const url of ['http://127.0.0.1:3005/path', 'http://127.0.0.1:3005?url=other', 'file:///tmp/sync']) {
      expect(() => bffEnvironment({ SYNC_API_URL: url })).toThrow('SYNC_API_URL');
    }
    const schema = resolve('../../contracts/graphql/sync.graphql');
    expect(bffEnvironment({ BFF_SYNC_SCHEMA_PATH: schema }).schemaPaths[9]).toBe(schema);
    for (const path of ['sync.graphql', resolve('missing-sync.graphql'), resolve('../../contracts/graphql'), '']) {
      expect(() => bffEnvironment({ BFF_SYNC_SCHEMA_PATH: path })).toThrow('BFF_SYNC_SCHEMA_PATH');
    }
  });
  it('loads eleven schemas, keeping agenda seventh, executions eighth, intelligence ninth, sync tenth and the assistant last', () => {
    const paths = bffEnvironment({}).schemaPaths;
    expect(paths).toHaveLength(11);
    expect(paths[6]).toBe(resolve('../../contracts/graphql/agenda.graphql'));
    expect(paths[7]).toBe(resolve('../../contracts/graphql/executions.graphql'));
    expect(paths[8]).toBe(resolve('../../contracts/graphql/intelligence.graphql'));
    expect(paths[9]).toBe(resolve('../../contracts/graphql/sync.graphql'));
    expect(paths[10]).toBe(resolve('../../contracts/graphql/assistant.graphql'));
    const schema = buildSchema(paths.map(path => readFileSync(path, 'utf8')).join('\n'));
    expect(Object.keys(schema.getQueryType()!.getFields()).filter(name => /agenda/i.test(name)).sort()).toEqual(
      ['myAgenda', 'myAgendaWork', 'teamAgenda', 'teamAgendaWork', 'agendaTeamEmployees', 'myAgendaHistory', 'teamAgendaHistory'].sort());
    expect(Object.isFrozen(paths)).toBe(true);
  });
  it('accepts an existing absolute agenda override and rejects relative, missing and directory paths', () => {
    const path = resolve('../../contracts/graphql/agenda.graphql');
    expect(bffEnvironment({ BFF_AGENDA_SCHEMA_PATH: path }).schemaPaths[6]).toBe(path);
    for (const path of ['agenda.graphql', resolve('missing-agenda.graphql'), resolve('../../contracts/graphql'), '']) {
      expect(() => bffEnvironment({ BFF_AGENDA_SCHEMA_PATH: path })).toThrow('BFF_AGENDA_SCHEMA_PATH');
    }
  });
  it('rejects unsafe owners, invalid issuer/audience and port', () => {
    for (const key of ['EMPLOYEES_API_URL', 'OPERATIONS_API_URL', 'FINANCE_API_URL', 'INTELLIGENCE_API_URL', 'SYNC_API_URL', 'ASSISTANT_API_URL']) {
      expect(() => bffEnvironment({ [key]: 'http://u:p@localhost:3002' })).toThrow(key);
    }
    expect(() => bffEnvironment({ OIDC_ISSUER_URI: 'invalid' })).toThrow('OIDC_ISSUER_URI');
    expect(() => bffEnvironment({ OIDC_AUDIENCE: 'invalid' })).toThrow('OIDC_AUDIENCE');
    expect(() => bffEnvironment({ PORT: '0' })).toThrow('PORT');
  });
});
