import { describe, expect, it, vi } from 'vitest';
import { KeycloakIdentityGateway } from './keycloak-identity-gateway.js';
const id='11111111-1111-4111-8111-111111111111';
describe('Employee profile synchronization with editable usernames',()=>{
  it.each(['short.user','employee-'+id])('preserves %s when updating labor data and supplies the required username',async username=>{
    const user={id:'linked-subject',username,enabled:true,firstName:'Ana',lastName:'Perez',email:'ana@example.invalid',attributes:{employeeId:[id]}};
    const writes:Record<string,unknown>[]=[];
    const transport=vi.fn<typeof fetch>(async(url,init)=>{
      if(String(url).includes('/token'))return Response.json({access_token:'synthetic-token'});
      if(init?.method==='PUT'){
        const body=JSON.parse(String(init.body));writes.push(body);
        if(!body.username)return Response.json({errorMessage:'User name is missing'},{status:400});
        Object.assign(user,body);return new Response(null,{status:204});
      }
      return Response.json(user);
    });
    const gateway=new KeycloakIdentityGateway(transport,{tokenUrl:'http://idp/realms/autonexus/protocol/openid-connect/token',adminBase:'http://idp'});
    Reflect.set(gateway,'credentials',()=>({clientId:'test',clientSecret:'test-secret'}));
    expect(await gateway.sync({employeeId:id,subject:user.id,firstName:'Ana actualizada',lastName:user.lastName,email:user.email,enabled:true})).toBe(user.id);
    expect(writes[0]?.username).toBe(username);
    expect(user.firstName).toBe('Ana actualizada');
  });
});
