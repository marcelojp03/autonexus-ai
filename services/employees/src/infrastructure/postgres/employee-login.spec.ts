import { describe, expect, it, vi } from 'vitest';
import { PostgresEmployeeRepository } from './postgres-employee-repository.js';
import { EmployeeError } from '../../domain/employee.js';
const id = '11111111-1111-4111-8111-111111111111';
const op = '22222222-2222-4222-8222-222222222222';
function setup(status = 'active', access = 'synced') {
  let receipt: {employee_id:string;actor_subject:string;username:string;status:string} | null = null;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('pg_try_advisory_lock')) return [{acquired:true}];
    if (sql.startsWith('SELECT record')) return [{record:{id,status,access:{subject:'subject',status:access}}}];
    if (sql.startsWith('SELECT employee_id')) return receipt?[receipt]:[];
    if (sql.startsWith('INSERT')) receipt={employee_id:String(values[1]),actor_subject:String(values[2]),username:String(values[3]),status:'pending'};
    if (sql.includes("SET status='ready'")) receipt!.status='ready';
    if (sql.includes("SET status='failed'")) receipt!.status='failed';
    return [];
  });
  const runner = {query,connect:vi.fn(),release:vi.fn()};
  const repository = new PostgresEmployeeRepository();
  Reflect.set(repository,'source',{isInitialized:true,createQueryRunner:()=>runner});
  return {repository,query,receipt:()=>receipt};
}
describe('Login command receipt (explicit SQL runner double)', () => {
  it('audits metadata and replays success without resetting a password again', async () => {
    const {repository,query,receipt} = setup();
    const apply = vi.fn(async () => {});
    expect(await repository.configureLogin(id,op,'short.user','actor',apply)).toEqual({username:'short.user',ready:true,replayed:false});
    expect(await repository.configureLogin(id,op,'short.user','actor',apply)).toEqual({username:'short.user',ready:true,replayed:true});
    expect(apply).toHaveBeenCalledOnce();
    expect(receipt()?.status).toBe('ready');
    const writes = query.mock.calls.filter(([sql]) => /INSERT|UPDATE/.test(sql));
    expect(JSON.stringify(writes)).not.toMatch(/password|credential|secret/);
    await expect(repository.configureLogin(id,op,'different.user','actor',apply)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it.each([['inactive','synced'],['active','pending'],['active','not_requested']])('rejects an ineligible target', async (status,access) => {
    const {repository} = setup(status,access); const apply=vi.fn();
    await expect(repository.configureLogin(id,op,'short.user','actor',apply)).rejects.toThrow('LOGIN_PROFILE_NOT_READY');
    expect(apply).not.toHaveBeenCalled();
  });
  it('keeps an uncertain provider failure retryable without reporting success', async () => {
    const {repository,receipt} = setup();
    await expect(repository.configureLogin(id,op,'short.user','actor',async()=>{throw new EmployeeError(503,'LOGIN_PROVIDER_UNAVAILABLE');})).rejects.toThrow('LOGIN_PROVIDER_UNAVAILABLE');
    expect(receipt()?.status).toBe('failed');
    await repository.configureLogin(id,op,'short.user','actor',async()=>{});
    expect(receipt()?.status).toBe('ready');
  });
});
