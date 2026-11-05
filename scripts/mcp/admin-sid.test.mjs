import {test} from "node:test";
import assert from "node:assert/strict";
import {administrativeChannel} from "./local-admin.mjs";
const header=Buffer.from(JSON.stringify({alg:"RS256"})).toString("base64url");
const tail=()=>"unit."+header+"."+Buffer.from(JSON.stringify({marker:"sig"})).toString("base64url")+".signature";
// Master-realm bootstrap tokens carry sid and no sub; the channel must accept them and keep the session.
test("master-realm token without sub is accepted and anchored on sid",()=>{
 const make=(sid,suffix)=>({access_token:"unit."+Buffer.from(JSON.stringify({sid,exp:1})).toString("base64url")+".signature",refresh_token:"r-"+suffix,expires_in:60});
 let clock=0;let calls=0;
 const channel=administrativeChannel(make("session-1","one"),{now:()=>clock,refresh:()=>make("session-1","two"),request:()=>{calls++;return {status:200,data:{ok:true}}}});
 assert.deepEqual(channel.api("/clients"),{ok:true});clock=60000;assert.deepEqual(channel.api("/clients"),{ok:true});
 assert.equal(channel.refreshToken,"r-two");assert.equal(channel.refreshCount,1);assert.equal(calls,2);
});
test("a refresh that changes the sid is rejected before any admin request",()=>{
 const make=(sid,suffix)=>({access_token:"unit."+Buffer.from(JSON.stringify({sid})).toString("base64url")+".signature",refresh_token:"r-"+suffix,expires_in:60});
 let clock=0;let calls=0;
 const channel=administrativeChannel(make("session-1","one"),{now:()=>clock,refresh:()=>make("session-2","two"),request:()=>{calls++;return {status:200,data:null}}});
 clock=60000;assert.throws(()=>channel.api("/clients"),/ADMIN_SESSION_REFRESH_FAILED/);assert.equal(calls,0);
});
