/** Prepare an immutable optional offline manifest from the exact locally built runtime. No downloads. */
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,cpSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {buildOfflineManifest} from '../../web/shell/scripts/build-offline-manifest.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
process.chdir(root);
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:2*1024*1024});
let cid;let stage='validate-image';
try {
  const image=process.argv[2];assert.ok(image);
  const [info]=JSON.parse(docker(['image','inspect',image]));
  assert.match(info.Id,/^sha256:[a-f0-9]{64}$/);assert.deepEqual(info.Config.Cmd,['nginx','-g','daemon off;']);
  const directory=resolve(root,'output/stack/offline-'+info.Id.slice(7,19));
  const marker=resolve(directory,'prepared.json');
  const overlay=resolve(directory,'compose.private.yaml');
  if(existsSync(marker)) {
    assert.equal(JSON.parse(readFileSync(marker,'utf8')).imageId,info.Id);
    assert.ok(existsSync(overlay));
    assert.ok(existsSync(resolve(directory,'sw.js')));
    execFileSync(process.execPath,['scripts/cu22/verify-offline-overlay.mjs',info.Id,directory],{stdio:['ignore','pipe','pipe'],timeout:60000});
    console.log(JSON.stringify({pass:true,reused:true,imageId:info.Id,directory,overlay,downloads:0}));
  } else {
    assert.equal(existsSync(directory),false,'INCOMPLETE_PREPARATION_REQUIRES_INSPECTION');
    assert.ok(existsSync('web/shell/public/offline-model/index.json'),'AUTHORIZED_MODEL_REQUIRED');
    mkdirSync(directory,{recursive:true});
    stage='copy-exact-runtime';const candidate=docker(['create','--network=none','--read-only','--cap-drop=ALL','--label','autonexus.purpose=offline-static-preparation','--entrypoint','/bin/true',info.Id]).trim();assert.match(candidate,/^[a-f0-9]{64}$/);cid=candidate;
    docker(['cp',cid+':/usr/share/nginx/html/.',directory]);
    docker(['rm',cid]);cid=undefined;
    stage='prepare-existing-model-metadata';
    cpSync('web/shell/public/offline-model',resolve(directory,'offline-model'),{recursive:true,errorOnExist:true});
    await buildOfflineManifest(directory);
    stage='verify-runtime-integrity';
    execFileSync(process.execPath,['scripts/cu22/verify-offline-overlay.mjs',info.Id,directory],{stdio:['ignore','pipe','pipe'],timeout:60000});
    const slash=p=>p.replaceAll(String.fromCharCode(92),'/');
    const lines=['services:','  web:','    volumes:'];
    for(const file of ['offline-resources.json','sw.js'])lines.push('      - type: bind','        source: '+JSON.stringify(slash(resolve(directory,file))),'        target: /usr/share/nginx/html/'+file,'        read_only: true','        bind:','          create_host_path: false');
    writeFileSync(overlay,lines.join(String.fromCharCode(10))+String.fromCharCode(10),{flag:'wx',mode:0o600});
    writeFileSync(marker,JSON.stringify({imageId:info.Id,image,at:new Date().toISOString(),downloads:0,modelQualityValidated:false},null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({pass:true,reused:false,imageId:info.Id,directory,overlay,downloads:0,modelQualityValidated:false}));
  }
}catch {console.error(JSON.stringify({pass:false,stage,code:'OFFLINE_RUNTIME_PREPARATION_FAILED',activeRuntimeChanged:false}));process.exitCode=1;}
finally {if(cid){try{docker(['rm',cid]);}catch{console.error('Owned preparation container retained; inspect it before cleanup.');}}}
