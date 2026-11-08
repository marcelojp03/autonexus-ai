/** Read-only guard before mounting optional, previously authorized local model artifacts. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const image=process.argv[2];
const preparedRoot=resolve(process.argv[3]??'web/shell/dist');
assert.ok(typeof image==='string'&&image.length>0,'LOCAL_WEB_IMAGE_REQUIRED');
execFileSync('docker',['image','inspect',image],{stdio:'ignore',timeout:10000});
const core=JSON.parse(execFileSync('docker',['run','--pull=never','--rm','--network=none','--read-only','--cap-drop=ALL','--entrypoint','cat',image,'/usr/share/nginx/html/offline-resources.json'],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));
const prepared=JSON.parse(readFileSync(resolve(preparedRoot,'offline-resources.json'),'utf8'));
assert.equal(prepared.modelReady,true,'PREPARE_AUTHORIZED_MODEL_AND_BUILD_SHELL_FIRST');
assert.ok(Array.isArray(prepared.resources)&&prepared.resources.length<=512);
let bytes=0;let models=0;
for(const resource of prepared.resources){
  const path=resource.url;
  assert.ok(typeof path==='string'&&path.startsWith('/')&&!path.includes('..')&&!path.includes('?')&&!path.includes('#'));
  const model=path.startsWith('/offline-model/');
  assert.ok(model||path.startsWith('/assets/')||['/offline.html','/manifest.webmanifest','/favicon.svg'].includes(path));
  const file=resolve(model?'web/shell/public':preparedRoot,'.'+path);
  const body=readFileSync(file);bytes+=body.length;if(model)models++;
  assert.equal(createHash('sha256').update(body).digest('hex'),resource.sha256,'LOCAL_RESOURCE_DIGEST_MISMATCH');
}
assert.ok(bytes<=128*1024*1024&&models>3);
for(const resource of core.resources.filter(resource=>!resource.url.startsWith('/offline-model/'))){
  assert.equal(prepared.resources.find(candidate=>candidate.url===resource.url)?.sha256,resource.sha256,'IMAGE_AND_PREPARED_SHELL_DIFFER');
}
console.log(JSON.stringify({pass:true,coreResources:core.resources.filter(resource=>!resource.url.startsWith('/offline-model/')).length,modelResources:models,totalBytes:bytes,modelQualityValidated:false,downloads:0}));
