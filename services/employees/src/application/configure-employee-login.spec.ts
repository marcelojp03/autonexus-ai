import { describe, it, expect, vi } from 'vitest';
import { ConfigureEmployeeLogin, type LoginRepository } from './configure-employee-login.js';
import type { Employee } from '../domain/employee.js';
const id = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const input = {operationId,username:'test.mechanic',password:'Fixture-only-123'};
function setup() {
  const configure = vi.fn(async () => {});
  const configureLogin = vi.fn<LoginRepository['configureLogin']>(async (_id,_operation,_username,_actor,apply) => {
    await apply({id} as Employee); return {username:input.username,ready:true,replayed:false};
  });
  const security = {employeeRoles: vi.fn(async () => ({employeeId:id,subject:id,items:[]})),role:vi.fn()};
  return {configure,configureLogin,security,app:new ConfigureEmployeeLogin({configureLogin},{configure},security)};
}
describe('Permanent employee login setup', () => {
  it('keeps the password out of durable command arguments and returns no credential', async () => {
    const {app,configureLogin,configure} = setup();
    const result = await app.run(id,input,'actor',['security:write','employees:write']);
    expect(configureLogin.mock.calls[0]?.slice(0,4)).toEqual([id,operationId,input.username,'actor']);
    expect(configure).toHaveBeenCalledWith({id},input.username,input.password);
    expect(JSON.stringify(result)).not.toContain(input.password);
  });
  it.each([{...input,password:'short'},{...input,username:'invalid user'},{...input,password:'x'.repeat(129)},
    {...input,password:'valid\npassword'},{...input,extra:'unexpected'},{...input,temporary:true}])('rejects invalid/unexpected input', async invalid => {
    const {app,configureLogin} = setup();
    expect(() => app.run(id,invalid,'actor',[])).toThrow('VALIDATION_ERROR');
    expect(configureLogin).not.toHaveBeenCalled();
  });
  it('prevents password takeover of an employee with stronger permissions', async () => {
    const {app,configure,security} = setup();
    security.employeeRoles.mockResolvedValue({employeeId:id,subject:id,items:[{status:'active',roleName:'administrador'}]} as never);
    security.role.mockResolvedValue({permissions:['employees:write','security:write','payments:write']});
    await expect(app.run(id,input,'delegated',['employees:write','security:write'])).rejects.toThrow('PERMISSION_ESCALATION');
    expect(configure).not.toHaveBeenCalled();
  });
});
