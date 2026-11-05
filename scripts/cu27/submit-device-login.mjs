/** Synthetic fixture only: completes the phone's real Keycloak login without printing credentials. */
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const fixture=process.env.CU27_ACCOUNTS_FILE ?? resolve('output/stack/cu16-proof.accounts.private.json');
const report={kind:'physical-android-pkce',submitted:false,callbackObserved:false,pass:false};
const targets=await (await fetch('http://127.0.0.1:9222/json')).json();
const target=targets.find(item=>{try {const u=new URL(item.url);return item.type==='page' && u.origin==='http://127.0.0.1:4285' && u.pathname.startsWith('/identity/realms/autonexus/');}catch{return false;}});
if(!target) throw new Error('NO_AUTONEXUS_LOGIN_PAGE');
const ws=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
let id=0;const waiting=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id && waiting.has(m.id)){const w=waiting.get(m.id);waiting.delete(m.id);m.error?w.no(new Error('CDP_COMMAND_FAILED')):w.ok(m.result);}});
const send=(method,params={})=>new Promise((ok,no)=>{const n=++id;waiting.set(n,{ok,no});ws.send(JSON.stringify({id:n,method,params}));});
try {
  const {accounts}=JSON.parse(readFileSync(fixture,'utf8'));
  const account=accounts[process.env.CU27_ACCOUNT ?? 'mechanicA'];
  if(!account?.username || !account?.password)throw new Error('SYNTHETIC_FIXTURE_INVALID');
  for(const [selector,value] of [['#username',account.username],['#password',account.password]]){
    const focused=await send('Runtime.evaluate',{expression:'Boolean(document.querySelector('+JSON.stringify(selector)+') && (document.querySelector('+JSON.stringify(selector)+').focus(),true))',returnByValue:true});
    if(!focused.result?.value)throw new Error('LOGIN_FORM_NOT_READY');
    await send('Input.insertText',{text:value});
  }
  await send('Runtime.evaluate',{expression:'document.querySelector("#kc-login").click()'});
  report.submitted=true;
}finally{ws.close();mkdirSync('output/cu27',{recursive:true});writeFileSync('output/cu27/mobile-login-submit.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({submitted:report.submitted}));
