import { describe, it, expect, vi } from 'vitest';
import { KeycloakLoginGateway } from './keycloak-login-gateway.js';
import type { Employee } from '../../domain/employee.js';
const id = '11111111-1111-4111-8111-111111111111';
const employee = {id,access:{subject:'owned-subject'}} as Employee;
const config = {tokenUrl:'http://idp/token',adminBase:'http://idp'};
function setup(options: {foreign?:boolean;taken?:boolean;reject?:boolean;disabled?:boolean} = {}) {
  const user = {id:'owned-subject',username:'employee-'+id,enabled:!options.disabled,attributes:{employeeId:[options.foreign?'other':id]}};
  const writes: Array<{url:string;body:Record<string,unknown>}> = [];
  const transport = vi.fn<typeof fetch>(async (url,init) => {
    const path = String(url);
    if (path === config.tokenUrl) return Response.json({access_token:'synthetic-token'});
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      writes.push({url:path,body});
      if (options.reject) return Response.json({message:'PRIVATE-ERROR'}, {status:400});
      if (typeof body.username === 'string') user.username=body.username;
      return new Response(null,{status:204});
    }
    if (path.includes('?exact=')) return Response.json(options.taken?[{id:'foreign-subject'}]:[]);
    return Response.json(user);
  });
  const gateway = new KeycloakLoginGateway(transport,config,()=>({clientId:'test-client',clientSecret:'test-secret'}));
  return {gateway,writes,transport};
}
describe('Keycloak permanent credentials adapter (explicit fake transport)', () => {
  it('renames only the linked identity and sets temporary=false', async () => {
    const {gateway,writes} = setup();
    await gateway.configure(employee,'short.user','Fixture-only-123');
    expect(writes[0]?.body).toEqual({username:'short.user'});
    expect(writes[1]?.url).toMatch(/owned-subject\/reset-password$/);
    expect(writes[1]?.body).toEqual({type:'password',value:'Fixture-only-123',temporary:false});
  });
  it.each([{foreign:true},{disabled:true},{taken:true}])('refuses foreign, disabled or duplicate accounts', async options => {
    const {gateway,writes} = setup(options);
    await expect(gateway.configure(employee,'short.user','Fixture-only-123')).rejects.toThrow();
    expect(writes).toEqual([]);
  });
  it('sanitizes provider policy failures without leaking its response or credentials', async () => {
    const {gateway} = setup({reject:true});
    await expect(gateway.configure(employee,'short.user','Fixture-only-123')).rejects.toThrow('LOGIN_POLICY_REJECTED');
  });
});
