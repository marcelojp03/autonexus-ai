/** Local infrastructure provisioning only. Bootstrap is never a runtime credential. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8180';
function run(command,args){const result=spawnSync(command,args,{encoding:'utf8',timeout:10000});assert.equal(result.status,0,'Infrastructure command failed');return result.stdout.trim();}
const runtime=resolve(run('git',['rev-parse','--path-format=absolute','--git-common-dir']),'..');
const directory=resolve(runtime,'infra/keycloak');
const privateFile=resolve(directory,'.local/employees-client.json');
const normalize=value=>value.split(String.fromCharCode(92)).join('/').split('/').filter(Boolean).join('/').toLowerCase();
async function request(path,options={},allowed=[200,201,204]){const response=await fetch(base+path,{...options,signal:AbortSignal.timeout(15000),redirect:'error'});assert.ok(allowed.includes(response.status),'IdP provisioning request failed');return response;}
try{
  for(const name of ['autonexus-keycloak-dev-keycloak-1','autonexus-keycloak-dev-postgres-1']){
    const labels=JSON.parse(run('docker',['inspect','--format','{{json .Config.Labels}}',name]));
    assert.equal(labels['com.docker.compose.project'],'autonexus-keycloak-dev');
    assert.equal(normalize(labels['com.docker.compose.project.working_dir']),normalize(directory));
  }
  run('git',['-C',runtime,'check-ignore','--quiet',privateFile]);
  const originalEnv=readFileSync(resolve(directory,'.env'));
  const fixtures=readFileSync(resolve(directory,'.local/test-accounts.json'));
  const env=Object.fromEntries(originalEnv.toString().trim().split(/\r?\n/).map(line=>{const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1)];}));
  const token=await (await request('/realms/master/protocol/openid-connect/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:env.KC_BOOTSTRAP_ADMIN_USERNAME,password:env.KC_BOOTSTRAP_ADMIN_PASSWORD})})).json();
  const headers={Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'};
  const api=async(path,method='GET',data)=>{const response=await request('/admin/realms/autonexus'+path,{method,headers,...(data===undefined?{}:{body:JSON.stringify(data)})});return response.status===200?response.json():null;};
  const clientId='autonexus-employees-admin';
  let clients=await api('/clients?clientId='+clientId);
  if(!clients.length){await api('/clients','POST',{clientId,enabled:true,publicClient:false,serviceAccountsEnabled:true,standardFlowEnabled:false,implicitFlowEnabled:false,directAccessGrantsEnabled:false,fullScopeAllowed:false,defaultClientScopes:['roles'],optionalClientScopes:[],attributes:{'autonexus.owner':'cu03-employees'}});clients=await api('/clients?clientId='+clientId);}
  assert.equal(clients.length,1);
  const client=await api('/clients/'+clients[0].id);
  assert.equal(client.attributes?.['autonexus.owner'],'cu03-employees');
  assert.equal(client.publicClient,false);assert.equal(client.serviceAccountsEnabled,true);assert.equal(client.fullScopeAllowed,false);
  assert.equal(client.standardFlowEnabled,false);assert.equal(client.directAccessGrantsEnabled,false);assert.equal(client.implicitFlowEnabled,false);
  const management=(await api('/clients?clientId=realm-management'))[0];
  const granted=['manage-users','view-realm','manage-realm'];
  const roles=[];
  for(const name of granted)roles.push(await api('/clients/'+management.id+'/roles/'+name));
  const account=await api('/clients/'+client.id+'/service-account-user');
  for(const path of ['/users/'+account.id+'/role-mappings/clients/'+management.id,'/clients/'+client.id+'/scope-mappings/clients/'+management.id]){
    const existing=await api(path);assert.ok(existing.every(item=>granted.includes(item.name)),'Unexpected service account authority');
    const missing=roles.filter(item=>!existing.some(current=>current.id===item.id));
    if(missing.length)await api(path,'POST',missing);
  }
  const profile=await api('/users/profile');
  const attribute={name:'employeeId',displayName:'Employee UUID',multivalued:false,permissions:{view:['admin'],edit:['admin']},validations:{length:{min:36,max:36},pattern:{pattern:'^[0-9a-f-]{36}$'}}};
  const existingAttribute=profile.attributes.find(item=>item.name==='employeeId');
  if(existingAttribute){assert.deepEqual(existingAttribute.permissions,attribute.permissions);assert.deepEqual(existingAttribute.validations,attribute.validations);}
  else{profile.attributes.push(attribute);await api('/users/profile','PUT',profile);}
  const secret=await api('/clients/'+client.id+'/client-secret');
  const credentials={clientId,clientSecret:secret.value};assert.ok(typeof credentials.clientSecret==='string'&&credentials.clientSecret.length>=16);
  if(existsSync(privateFile))assert.deepEqual(JSON.parse(readFileSync(privateFile,'utf8')),credentials,'Preserve existing client secret');
  else writeFileSync(privateFile,JSON.stringify(credentials),{flag:'wx',mode:0o600});
  const technical=await (await request('/realms/autonexus/protocol/openid-connect/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:credentials.clientSecret})})).json();
  const claims=JSON.parse(Buffer.from(technical.access_token.split('.')[1],'base64url'));
  assert.ok(granted.every(name=>claims.resource_access?.['realm-management']?.roles.includes(name)));
  assert.ok(!claims.realm_access?.roles.some(role=>['administrador','mecanico','recepcionista','jefe_taller','responsable_financiero'].includes(role)));
  assert.ok(originalEnv.equals(readFileSync(resolve(directory,'.env'))));assert.ok(fixtures.equals(readFileSync(resolve(directory,'.local/test-accounts.json'))));
  console.log('PASS dedicated client_credentials, explicit manage-users scope/assignment, admin-only employeeId, private client secret preserved, CU01 private bytes unchanged');
  console.log('LIMIT manage-users/view-realm/manage-realm are realm-wide at the IdP; the role adapter only calls role endpoints and verifies employee ownership before mappings. No automatic workshop roles or credentials.');
}catch{console.error('FAIL employees technical identity provisioning; private diagnostics omitted');process.exitCode=1;}
