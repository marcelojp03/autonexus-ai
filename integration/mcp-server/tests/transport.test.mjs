import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createConsultationApp} from '../dist/http-app.js';
import {AccessError} from '../dist/domain/access.js';

// Protocol/component checks with an official SDK client and controlled auth/owner doubles.
// This is not live Keycloak/Operations integration evidence.
const token='unit.reader.signature';
const id='11111111-1111-4111-8111-111111111111';
const order={id,number:'WO-UNIT-1',status:'confirmed',priority:'normal',version:1,
 createdAt:'2026-11-05T12:00:00Z',updatedAt:'2026-11-05T12:00:00Z',items:[],
 customerName:'PRIVATE_CUSTOMER',notes:'PRIVATE_NOTE',referenceRate:999};
async function fixture(options={}){
 const state={active:true,ownerStatus:200,ownerCalls:[],audit:[],exchangeCalls:0};
 const config={resourceUrl:'http://127.0.0.1:3006/mcp',issuerUrl:'http://127.0.0.1:4286/identity/realms/autonexus',
  operationsBaseUrl:'http://127.0.0.1:8081',host:'127.0.0.1',port:3006,
  jwksUrl:'http://127.0.0.1:4286/certs',tokenEndpointUrl:'http://127.0.0.1:4286/token',
  clientRegistryFile:'/private/unit-registry',idpClientFile:'/private/unit-client'};
 const app=createConsultationApp({config,requestsPerMinute:options.requestsPerMinute??60,
  verify:async value=>{if(value!==token)throw new AccessError('invalid_token');
   if(!state.active)throw new AccessError('client_forbidden');
   return {subject:'unit-employee',clientId:'unit-client',token:value,expiresAt:Math.floor(Date.now()/1000)+60,scopes:['mcp','mcp:orders:read']};},
  exchange:{exchange:async()=>{state.exchangeCalls++;return 'exchanged-api-token';}},
  audit:{write:async event=>{if(options.auditFails)throw new Error('PRIVATE_AUDIT_DETAIL');state.audit.push(event);}},
  ownerFetch:async(url,init)=>{state.ownerCalls.push({url:String(url),method:init.method,authorization:init.headers.authorization});
   if(state.ownerStatus!==200)return Response.json({message:'PRIVATE_OWNER_DETAIL'},{status:state.ownerStatus});
   return Response.json({items:[order],total:1,limit:20,offset:0});}});
 const listener=app.listen(0,'127.0.0.1');await new Promise(ok=>listener.once('listening',ok));
 const url='http://127.0.0.1:'+listener.address().port;let client;
 return {state,url,
  async connect(){client=new Client({name:'unit-external-client',version:'1.0.0'});
   await client.connect(new StreamableHTTPClientTransport(new URL(url+'/mcp'),{authProvider:{token:async()=>token},requestInit:{redirect:'error'}}));return client;},
  async close(){await client?.close();listener.closeAllConnections();await new Promise(ok=>listener.close(ok));}};
}
test('SDK client negotiates, sees only allowed tools and receives projected structured results',async()=>{
 const f=await fixture();try{const client=await f.connect();const list=await client.listTools();
  assert.deepEqual(list.tools.map(t=>t.name).sort(),['autonexus_get_order','autonexus_list_orders']);
  for(const tool of list.tools){assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.outputSchema.type,'object');}
  const result=await client.callTool({name:'autonexus_list_orders',arguments:{}});
  assert.equal(result.isError,false);assert.equal(result.structuredContent.ok,true);
  assert.equal(result.structuredContent.data[0].number,'WO-UNIT-1');
  const text=JSON.stringify(result);for(const value of ['PRIVATE_CUSTOMER','PRIVATE_NOTE','referenceRate','exchanged-api-token',token])assert.ok(!text.includes(value));
  assert.equal(f.state.ownerCalls.length,1);assert.equal(f.state.ownerCalls[0].method,'GET');
  assert.equal(f.state.ownerCalls[0].authorization,'Bearer exchanged-api-token');
  assert.deepEqual(f.state.audit.map(e=>e.outcome),['REQUESTED','OK']);
 }finally{await f.close();}
});
test('owner denial is a tool error, not an empty successful page',async()=>{
 const f=await fixture();try{f.state.ownerStatus=403;const client=await f.connect();
  const result=await client.callTool({name:'autonexus_list_orders',arguments:{}});
  assert.equal(result.isError,true);assert.equal(result.structuredContent.ok,false);
  assert.equal(result.structuredContent.error.status,403);assert.ok(!JSON.stringify(result).includes('PRIVATE_OWNER_DETAIL'));
 }finally{await f.close();}
});
test('client suspension rejects the next invocation without contacting the owner',async()=>{
 const f=await fixture();try{const client=await f.connect();await client.listTools();f.state.active=false;
  await assert.rejects(client.callTool({name:'autonexus_list_orders',arguments:{}}));assert.equal(f.state.ownerCalls.length,0);
 }finally{await f.close();}
});
test('missing bearer gets resource metadata challenge and metadata remains public',async()=>{
 const f=await fixture();try{const response=await fetch(f.url+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(response.status,401);assert.ok(response.headers.get('www-authenticate').includes('resource_metadata='));
  const metadata=await(await fetch(f.url+'/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(metadata.resource,'http://127.0.0.1:3006/mcp');assert.ok(!JSON.stringify(metadata).includes('unit-client'));
  assert.equal(f.state.ownerCalls.length,0);
 }finally{await f.close();}
});
test('known tool without its scope receives an OAuth 403 before any query',async()=>{
 const f=await fixture();try{const response=await fetch(f.url+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'autonexus_list_team_agenda',arguments:{}}})});
  assert.equal(response.status,403);assert.ok(response.headers.get('www-authenticate').includes('mcp:agenda:read:team'));assert.equal(f.state.ownerCalls.length,0);
 }finally{await f.close();}
});
test('malicious origin, body excess and invalid arguments cannot reach the owner',async()=>{
 const f=await fixture();try{let response=await fetch(f.url+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token,origin:'https://evil.invalid','content-type':'application/json'},body:'{}'});
  assert.equal(response.status,403);
  response=await fetch(f.url+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({x:'x'.repeat(33000)})});assert.equal(response.status,413);
  const client=await f.connect();const result=await client.callTool({name:'autonexus_list_orders',arguments:{limit:999,url:'https://evil.invalid'}});
  assert.equal(result.isError,true);assert.equal(f.state.ownerCalls.length,0);
 }finally{await f.close();}
});
test('rate cap applies to authenticated requests including legacy GETs',async()=>{
 const f=await fixture({requestsPerMinute:1});try{let response=await fetch(f.url+'/mcp',{headers:{authorization:'Bearer '+token}});assert.notEqual(response.status,429);
  response=await fetch(f.url+'/mcp',{headers:{authorization:'Bearer '+token}});assert.equal(response.status,429);assert.equal(f.state.ownerCalls.length,0);
 }finally{await f.close();}
});
test('audit failure never releases queried data or starts an owner read',async()=>{
 const f=await fixture({auditFails:true});try{const client=await f.connect();const result=await client.callTool({name:'autonexus_list_orders',arguments:{}});
  assert.equal(result.isError,true);assert.ok(!JSON.stringify(result).includes('PRIVATE_AUDIT_DETAIL'));assert.equal(f.state.ownerCalls.length,0);
 }finally{await f.close();}
});
