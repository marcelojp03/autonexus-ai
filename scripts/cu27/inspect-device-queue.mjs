/** Read-only debug-build evidence inspector. Never reads auth_state or emits raw DB/file bytes. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
const adb='C:/Users/marcelo/AppData/Local/Android/sdk/platform-tools/adb.exe';
const serial=process.env.CU27_DEVICE ?? 'ff77c09b1c12';
const pkg='bo.edu.uagrm.autonexus.autonexus_mobile';
const dir=mkdtempSync(join(tmpdir(),'cu27-inspect-'));
const path=join(dir,'offline.db');
let db;
try{
  const bytes=execFileSync(adb,['-s',serial,'exec-out','run-as',pkg,'cat','databases/autonexus_offline.db'],{maxBuffer:16*1024*1024});
  writeFileSync(path,bytes,{mode:0o600});db=new DatabaseSync(path,{readOnly:true});
  const rows=db.prepare('SELECT operation_id,description,state,photo_path,photo_sha256,labels_json,human_labels_json,human_reviewed_at,run_id,model_version,owner_advance_id,evidence_id,evidence_state,inference_state,last_code FROM queue').all();
  const safe=rows.map(row=>{
    const file=row.photo_path;
    if(file && !/^[/]data[/](user[/]0|data)[/]bo[.]edu[.]uagrm[.]autonexus[.]autonexus_mobile[/]app_flutter[/]evidence[/][0-9a-f-]+[.]jpg$/.test(file))throw new Error('PHOTO_PATH_OUTSIDE_APP');
    const photoBytes=file?Number(execFileSync(adb,['-s',serial,'shell','run-as',pkg,'stat','-c','%s',file],{encoding:'utf8'}).trim()):0;
    return {operationId:row.operation_id,description:row.description,state:row.state,photoBytes,imageSha256:row.photo_sha256,labels:row.labels_json,humanReviewLabels:row.human_labels_json,runId:row.run_id,modelVersion:row.model_version,advanceId:row.owner_advance_id,evidenceId:row.evidence_id,evidenceState:row.evidence_state,inferenceState:row.inference_state,lastCode:row.last_code};
  });
  console.log(JSON.stringify({workCount:db.prepare('SELECT count(*) AS n FROM works').get().n,queue:safe}));
}finally{db?.close();try{unlinkSync(path);}catch{}try{rmdirSync(dir);}catch{}}
