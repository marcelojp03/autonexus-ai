import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {authorize} from '../../services/employees/scripts/local-pkce.mjs';

// Test-only controlled form/token endpoints; no real account, private file or identity provider.
async function fakeIdentity({resource,badIssuer=false}) {
 let issuer,state,query,tokenRequest,tokenCalls=0;
 const redirect='http://127.0.0.1:4390/auth/callback';
 const server=createServer(async(req,res)=>{
  if(req.url.startsWith('/identity/realms/unit/protocol/openid-connect/auth?')) {
   query=new URL(req.url,issuer).searchParams;state=query.get('state');
   res.writeHead(200,{'content-type':'text/html','set-cookie':'unit-session=synthetic; HttpOnly'});
   res.end('<form action="'+issuer+'/login-actions/authenticate"></form>');
  } else if(req.url==='/identity/realms/unit/login-actions/authenticate'){
   for await(const chunk of req){}
   const values=new URLSearchParams({state,code:'unit-authorization-code'});
   if(resource)values.set('iss',badIssuer?'https://other.invalid/realm':issuer);
   res.writeHead(302,{location:redirect+'#'+values.toString()});res.end();
  } else if(req.url==='/identity/realms/unit/protocol/openid-connect/token'){
   tokenCalls++;let body='';for await(const chunk of req)body+=chunk;tokenRequest=new URLSearchParams(body);
   res.writeHead(200,{'content-type':'application/json'});
   res.end(JSON.stringify({token_type:'Bearer',access_token:'unit-access',id_token:'unit-id',refresh_token:'unit-refresh'}));
  } else {res.writeHead(404);res.end();}
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));issuer='http://127.0.0.1:'+server.address().port+'/identity/realms/unit';
 return {issuer,redirect,get query(){return query;},get tokenRequest(){return tokenRequest;},get tokenCalls(){return tokenCalls;},
  async close(){server.closeAllConnections();await new Promise(ok=>server.close(ok));}};
}
test('PKCE helper preserves default callers without a resource parameter',async()=>{
 const idp=await fakeIdentity({resource:false});try{
  await authorize({username:'unit-user',password:'unit-password',enabled:true},false,{issuer:idp.issuer,redirect:idp.redirect});
  assert.equal(idp.query.get('client_id'),'autonexus-shell');assert.equal(idp.query.get('scope'),'openid profile');
  assert.equal(idp.query.get('code_challenge_method'),'S256');assert.equal(idp.query.get('resource'),null);assert.equal(idp.tokenRequest.get('resource'),null);
 }finally{await idp.close();}
});
test('MCP fixture helper binds resource in both requests and uses its explicit client/scopes',async()=>{
 const idp=await fakeIdentity({resource:true});try{
  const resource='http://127.0.0.1:3006/mcp';const scope='openid mcp mcp:orders:read';
  await authorize({username:'unit-user',password:'unit-password',enabled:true},false,{issuer:idp.issuer,redirect:idp.redirect,client:'unit-mcp-client',resource,scope});
  assert.equal(idp.query.get('client_id'),'unit-mcp-client');assert.equal(idp.query.get('scope'),scope);
  assert.equal(idp.query.get('resource'),resource);assert.equal(idp.tokenRequest.get('resource'),resource);assert.equal(idp.tokenRequest.get('client_id'),'unit-mcp-client');
 }finally{await idp.close();}
});
test('MCP fixture helper rejects callback issuer mismatch before sending the code to token endpoint',async()=>{
 const idp=await fakeIdentity({resource:true,badIssuer:true});try{
  await assert.rejects(authorize({username:'unit-user',password:'unit-password',enabled:true},false,{issuer:idp.issuer,redirect:idp.redirect,resource:'http://127.0.0.1:3006/mcp'}),/issuer mismatch/);
  assert.equal(idp.tokenCalls,0);
 }finally{await idp.close();}
});
test('confidential PKCE fixture sends its secret only to the token endpoint',async()=>{
 const idp=await fakeIdentity({resource:false});try{
  await authorize({username:'unit-user',password:'unit-password',enabled:true},false,{issuer:idp.issuer,redirect:idp.redirect,client:'unit-n8n-client',clientSecret:'unit-confidential-value'});
  assert.equal(idp.query.get('client_secret'),null);
  assert.equal(idp.tokenRequest.get('client_secret'),'unit-confidential-value');
 }finally{await idp.close();}
});
