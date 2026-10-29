import type { QueryRunner } from 'typeorm';
import { command, transition, type Employee } from '../../domain/employee.js';
import { PostgresEmployeeRepository } from './postgres-employee-repository.js';
const id='11111111-1111-4111-8111-111111111111';
const input={operationId:id,firstName:'Ana',lastName:'Perez',document:'fake',email:'ana@example.invalid',phone:'70000000',jobTitle:'Mecánica',startDate:'2020-01-01',specialties:['Motor'],mechanicEnabled:true};
describe('CU03 labor changes against future CU15 assignments (runner fake)',()=>{
  function fixture() {
    const employee=transition(command('create',null,input),null,'human',id,'2026-10-28T12:00:00.000Z').employee;
    const query=vi.fn(async(sql:string)=>{
      if(sql.startsWith('SELECT fingerprint'))return [];
      if(sql.startsWith('SELECT record'))return [{record:employee}];
      if(sql.startsWith('SELECT required_specialty'))return [{required_specialty:'Motor'}];
      return [];
    });
    const runner={query,startTransaction:vi.fn(),commitTransaction:vi.fn(),rollbackTransaction:vi.fn()};
    const locked=vi.fn(async(_keys:string[],work:(r:QueryRunner)=>Promise<unknown>)=>work(runner as unknown as QueryRunner));
    const repository=new PostgresEmployeeRepository();Object.assign(repository,{locked});
    return {repository,runner,locked,employee};
  }
  it.each([{status:'inactive'},{mechanicEnabled:false},{specialties:['Frenos']}])('rejects invalidating future assigned labor change %#',async change=>{
    const {repository,runner,locked,employee}=fixture();
    await expect(repository.execute(command('update',id,{...input,expectedVersion:1}),'human',()=>({employee:{...employee,...change,version:2} as Employee,action:'updated',synchronize:false}))).rejects.toMatchObject({code:'AFFECTS_PENDING_ASSIGNMENT'});
    expect(runner.rollbackTransaction).toHaveBeenCalledOnce();expect(runner.commitTransaction).not.toHaveBeenCalled();expect(locked.mock.calls[0]?.[0]).toContain('employee:'+id);
    expect(runner.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO employees.employee_records'))).toBe(false);
  });
  it('allows contact-only updates without invalidating the participant version',async()=>{
    const {repository,runner,employee}=fixture();
    const result=await repository.execute(command('update',id,{...input,expectedVersion:1}),'human',()=>({employee:{...employee,phone:'71111111',version:2},action:'updated',synchronize:false}));
    expect(result.employee.phone).toBe('71111111');expect(runner.commitTransaction).toHaveBeenCalledOnce();
  });
});
