import {test} from 'node:test';
import assert from 'node:assert/strict';
import {administrativeChannel} from './local-admin.mjs';
// Controlled setup-session bookkeeping, not a JWT authentication/integration test.
const tokens=(suffix='one',sub='bootstrap-unit')=>({access_token:'unit.'+Buffer.from(JSON.stringify({sub,marker:suffix})).toString('base64url')+'.signature',refresh_token:'unit-refresh-'+suffix,expires_in:60});
test('setup refreshes before expiry and logout can use the latest refresh token',()=>{
 let clock=0;const requests=[],refreshes=[];
 const first=tokens(),second=tokens('two');
 const channel=administrativeChannel(first,{writable:true,now:()=>clock,refresh:value=>{refreshes.push(value);return second;},request:(path,token,method,body)=>{requests.push({path,token,method,body});return {status:201,data:{ok:true}};}});
 channel.api('/clients','POST',{clientId:'unit'});clock=50000;channel.api('/clients','POST',{clientId:'unit-two'});
 assert.deepEqual(refreshes,[first.refresh_token]);assert.equal(requests[1].token,second.access_token);
 assert.equal(channel.refreshToken,second.refresh_token);assert.equal(channel.refreshCount,1);
});
test('one early 401 renews once; a second 401 is not bypassed',()=>{
 let count=0;let renewals=0;const channel=administrativeChannel(tokens(),{refresh:()=>{renewals++;return tokens('two');},request:()=>({status:++count===1?401:200,data:{ok:true}})});
 assert.deepEqual(channel.api('/clients'),{ok:true});assert.equal(renewals,1);
 const denied=administrativeChannel(tokens(),{refresh:()=>tokens('two'),request:()=>({status:401,data:null})});
 assert.throws(()=>denied.api('/clients'),/IDP_HTTP_401/);assert.equal(denied.refreshCount,1);
});
test('read-only setup refuses writes before any token or resource operation',()=>{
 let calls=0;const channel=administrativeChannel(tokens(),{now:()=>0,refresh:()=>{calls++;return tokens('two');},request:()=>{calls++;return {status:200,data:null}}});
 assert.throws(()=>channel.api('/clients','POST',{}),/READ_ONLY_ADMIN/);assert.equal(calls,0);
});
test('changed subject or failed renewal never reaches an admin resource',()=>{
 for(const refresh of [()=>tokens('two','different-unit'),()=>{throw new Error('PRIVATE_REFRESH_DETAIL');}]){
  let clock=0;let calls=0;const channel=administrativeChannel(tokens(),{now:()=>clock,refresh,request:()=>{calls++;return {status:200,data:null}}});clock=60000;
  assert.throws(()=>channel.api('/clients'),/^Error: ADMIN_SESSION_REFRESH_FAILED$/);assert.equal(calls,0);
 }
});
