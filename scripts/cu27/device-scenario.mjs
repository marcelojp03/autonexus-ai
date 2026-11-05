import { readFileSync } from 'node:fs';
import { authorize } from '../../services/employees/scripts/local-pkce.mjs';
const {accounts}=JSON.parse(readFileSync('output/stack/cu16-proof.accounts.private.json','utf8'));
const origin=process.env.CU27_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4286';
const token=(await authorize({...accounts.mechanicA,enabled:true},false,{issuer:origin+'/identity/realms/autonexus',redirect:origin+'/auth/callback'})).access_token;
const response=await fetch('http://127.0.0.1:8081/agenda/me?from=2026-11-01&to=2026-11-30&limit=50',{headers:{Authorization:'Bearer '+token}});
const data=await response.json();
console.log(JSON.stringify({status:response.status,code:data.code,items:data.items?.map(item=>({assignmentId:item.assignmentId,orderNumber:item.orderNumber,startsAt:item.startsAt,executionStatus:item.executionStatus}))}));
