import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { OfflineWorkspace } from '../src/offline/workspace.ts';

// Unit doubles only: exercises asynchronous draft capture, not authentication or server integration.
function fixture() {
  let release;
  const buffer = new Promise(resolve => { release = resolve; });
  class DelayedPhoto extends Blob { async arrayBuffer() { return buffer; } }
  const photo = new DelayedPhoto(['photo'], { type: 'image/jpeg' });
  const fields = { 'offline-work': { value: 'assignment-1' }, 'offline-description': { value: 'Reviewed photo' }, 'offline-minutes': { value: '15' }, 'offline-photo': { value: 'photo.jpg' } };
  const host = { querySelector: selector => fields[selector.slice(1)], querySelectorAll: () => [{ value: 'crack' }] };
  const workspace = new OfflineWorkspace(host, { snapshot: () => ({authenticated:true,identity:{subject:'actor-a'}}) });
  let enqueued = 0;
  workspace.store = { enqueue: async () => { enqueued++; } };
  workspace.subject = 'actor-a';
  workspace.prepared = [{ subject: 'actor-a', assignmentId: 'assignment-1', version: 1 }];
  workspace.image = photo;
  workspace.prediction = {runId:'run-1',modelVersion:'model-1',imageSha256:'a'.repeat(64),labels:[{name:'dent',score:0.8}]};
  workspace.revision = true;
  return {workspace,release:()=>release(new Uint8Array([1,2,3]).buffer), enqueued:()=>enqueued};
}

test('changing account/photo during hashing never enqueues an advance with silently missing evidence', async () => {
  const f = fixture();
  const saving = f.workspace.save();
  f.workspace.image = undefined;
  f.workspace.prediction = undefined;
  f.workspace.sessionEpoch++;
  f.release();
  await assert.rejects(saving, /cuenta o la fotografía cambió/);
  assert.equal(f.enqueued(), 0);
});

test('switching away and back during hashing invalidates even an unchanged selected photo', async () => {
  const f = fixture();
  const saving = f.workspace.save();
  f.workspace.sessionEpoch += 2;
  f.release();
  await assert.rejects(saving, /cuenta o la fotografía cambió/);
  assert.equal(f.enqueued(), 0);
});

test('changing selected work during photo hashing never enqueues another assignment', async () => {
  const f = fixture();
  f.workspace.resetPhoto = () => {}; f.workspace.refresh = async () => {}; f.workspace.notice = () => {};
  const saving = f.workspace.save();
  f.workspace.host.querySelector('#offline-work').value = 'assignment-2';
  f.release();
  await assert.rejects(saving, /trabajo/);
  assert.equal(f.enqueued(), 0);
});

for (const discard of [false, true]) test('switching work with an unsaved draft requires explicit discard: ' + discard, () => {
  const f = fixture(); const fields = f.workspace.host;
  f.workspace.draftAssignmentId = 'assignment-1';
  const originalPhoto = f.workspace.image; const originalPrediction = f.workspace.prediction;
  let prompts = 0; let cleared = 0;
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'confirm');
  Object.defineProperty(globalThis, 'confirm', { configurable: true, value: () => { prompts++; return discard; } });
  f.workspace.showWork = () => {};
  f.workspace.resetPhoto = () => { cleared++; f.workspace.image = undefined; f.workspace.prediction = undefined; f.workspace.revision = false; };
  try {
    fields.querySelector('#offline-work').value = 'assignment-2';
    f.workspace.changeWork();
    assert.equal(prompts, 1);
    assert.equal(fields.querySelector('#offline-work').value, discard ? 'assignment-2' : 'assignment-1');
    assert.equal(fields.querySelector('#offline-description').value, discard ? '' : 'Reviewed photo');
    assert.equal(f.workspace.image, discard ? undefined : originalPhoto);
    assert.equal(f.workspace.prediction, discard ? undefined : originalPrediction);
    assert.equal(cleared, discard ? 1 : 0);
    assert.equal(f.enqueued(), 0);
  } finally { if (prior) Object.defineProperty(globalThis, 'confirm', prior); else delete globalThis.confirm; }
});

test('account change during restore never adopts the previous account in the visible workspace', async () => {
  let actor = 'actor-a'; let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const workspace = new OfflineWorkspace({}, { snapshot: () => ({authenticated:true,identity:{subject:actor}}) });
  workspace.subject = 'actor-b';
  workspace.store = { restoreCopy: async () => { entered(); await gate; }, recoverInterrupted: async () => {} };
  workspace.refresh = async () => {};
  const file = new Blob([JSON.stringify({version:1,subject:'actor-a',sourceOrigin:'http://127.0.0.1:4285',createdAt:'2026-11-05T00:00:00Z',works:[],queue:[]})]);
  const importing = workspace.importCopy(file);
  await started; actor = 'actor-b'; workspace.sessionEpoch++; release();
  await assert.rejects(importing, /cuenta cambió/);
  assert.equal(workspace.subject, 'actor-b');
});

function manualFixture() {
  const fields = { 'offline-work': { value: 'assignment-1' }, 'offline-description': { value: 'Inspección humana del panel' }, 'offline-minutes': { value: '15' }, 'offline-photo': { value: '' } };
  const workspace = new OfflineWorkspace({ querySelector: s => fields[s.slice(1)], querySelectorAll: () => [] }, { snapshot: () => ({ identity: { subject: 'actor-a' } }) });
  workspace.subject = 'actor-a'; workspace.prepared = [{ subject: 'actor-a', assignmentId: 'assignment-1', version: 1 }];
  workspace.revision = true; workspace.reviewReason = 'model_unavailable';
  workspace.resetPhoto = () => {}; workspace.refresh = async () => {}; workspace.notice = () => {};
  return { workspace, fields };
}
test('a bound text-only draft cannot be saved under another selected work', async () => {
  const { workspace, fields } = manualFixture();
  workspace.draftAssignmentId = 'assignment-1';
  workspace.prepared.push({ subject: 'actor-a', assignmentId: 'assignment-2', version: 1 });
  fields['offline-work'].value = 'assignment-2';
  let enqueued = 0; workspace.store = { enqueue: async () => { enqueued++; } };
  await assert.rejects(workspace.save(), /borrador pertenece a otro trabajo/);
  assert.equal(enqueued, 0);
  assert.equal(fields['offline-description'].value, 'Inspección humana del panel');
});
test('missing model manual save creates no client inference; quota preserves draft and retry creates one intention', async () => {
  const { workspace, fields } = manualFixture();
  let full = true; const rows = [];
  workspace.store = { enqueue: async row => { if (full) throw new DOMException('full', 'QuotaExceededError'); rows.push(row); } };
  await assert.rejects(workspace.save(), /Sin espacio/);
  assert.equal(fields['offline-description'].value, 'Inspección humana del panel'); assert.equal(rows.length, 0);
  full = false; await workspace.save();
  assert.equal(rows.length, 1); assert.equal(rows[0].inspectionReview.mode, 'manual');
  assert.equal(rows[0].inspectionReview.reason, 'model_unavailable'); assert.equal(rows[0].subject, 'actor-a');
  assert.equal(rows[0].clientInference, undefined); assert.match(rows[0].description, /manual.*model_unavailable/);
});
test('manual inspection remains saveable after inference failure without fabricated scores', async () => {
  const { workspace } = manualFixture(); let saved;
  workspace.reviewReason = 'inference_failed'; workspace.store = { enqueue: async row => { saved = row; } };
  await workspace.save(); assert.equal(saved.inspectionReview.reason, 'inference_failed'); assert.equal(saved.clientInference, undefined);
});
test('ordinary advances retain the 2000-character contract; human interpretation stops at 1600', async () => {
  const ordinary = manualFixture(); let saved;
  ordinary.workspace.revision = false; ordinary.fields['offline-description'].value = 'x'.repeat(2000);
  ordinary.workspace.store = { enqueue: async row => { saved = row; } };
  await ordinary.workspace.save(); assert.equal(saved.description.length, 2000);
  const reviewed = manualFixture(); reviewed.fields['offline-description'].value = 'x'.repeat(1601);
  reviewed.workspace.store = { enqueue: async () => { throw new Error('must not enqueue'); } };
  await assert.rejects(reviewed.workspace.save(), /1600 caracteres/);
});
test('basic offline preparation tolerates missing model cache; IA preparation requires all model assets', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let complete = false; let attempts = 0; let invalid = {};
  const events = new EventTarget();
  const worker = {state:'activated',postMessage: (request, [port]) => {
    attempts++;
    port.postMessage({type:'AUTONEXUS_MODEL_PREPARED',protocol:1,requestId:request.requestId,
      version:'a'.repeat(64),ok:complete,code:complete?'MODEL_CACHED':'MODEL_PREPARATION_FAILED',
      modelVersion:'automotive-damage-mobilenetv2-v1',runId:'20261101T-with-negatives',...invalid});
    port.close();
  }};
  const serviceWorker = Object.assign(events,{controller:worker,register:async()=>({active:worker,waiting:{postMessage:()=>assert.fail('must not skipWaiting')}}),ready:Promise.resolve({active:worker})});
  try {
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker}});
    const {workspace} = manualFixture();
    await workspace.ensureResources(); assert.equal(attempts,0);
    await assert.rejects(workspace.ensureResources(true), /modelo.*sin red/);
    complete = true; assert.equal(await workspace.ensureResources(true),worker); assert.equal(attempts,2);
    for(const patch of [{requestId:'wrong'},{protocol:2},{version:'unbuilt'},{modelVersion:'incompatible'},
      {runId:'incompatible'},{code:'RAM_READY'},{url:'/api/private'}]) {
      invalid=patch; await assert.rejects(workspace.ensureResources(true), /modelo.*sin red/);
    }
    invalid={};
    worker.postMessage=(_request,[port])=>{serviceWorker.controller={};events.dispatchEvent(new Event('controllerchange'));port.close();};
    await assert.rejects(workspace.ensureResources(true), /modelo.*sin red/);
  } finally {
    if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;
  }
});

test('inference port failure and resource failure retain photo and permit manual save and retry', async () => {
  for (const error of [new Error('execute failed'), new RangeError('allocation failed')]) {
    const { fields } = manualFixture(); fields['offline-model-status'] = {};
    let attempts = 0;
    const photo = new Blob(['photo'], { type: 'image/jpeg' });
    const workspace = new OfflineWorkspace({ querySelector: s => fields[s.slice(1)], querySelectorAll: () => [] }, { snapshot: () => ({ identity: { subject: 'actor-a' } }) }, { infer: async () => { attempts++; throw error; } });
    Object.assign(workspace, { subject: 'actor-a', prepared: [{ subject: 'actor-a', assignmentId: 'assignment-1', version: 1 }], image: photo, revision: true });
    await assert.rejects(workspace.analyzePhoto(photo), /manual/);
    assert.equal(workspace.image, photo); assert.equal(workspace.prediction, undefined);
    assert.equal(workspace.reviewReason, error instanceof RangeError ? 'insufficient_resources' : 'inference_failed');
    await assert.rejects(workspace.analyzePhoto(photo)); assert.equal(attempts, 2);
    let saved; workspace.store = { enqueue: async item => { saved = item; } }; workspace.resetPhoto = () => {}; workspace.refresh = async () => {}; workspace.notice = () => {};
    await workspace.save(); assert.equal(saved.inspectionReview.mode, 'manual'); assert.equal(saved.photo, photo); assert.equal(saved.clientInference, undefined);
  }
});

test('first claim waits for activation; timeout closes channels and removes controller listeners', async t => {
  const previous = Object.fromEntries(['navigator','MessageChannel'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const events=new EventTarget(); const worker=new EventTarget(); worker.state='activating';
  let posted=false; let closes=0;
  worker.postMessage=()=>{posted=true;};
  const serviceWorker=Object.assign(events,{controller:worker,register:async()=>({active:worker}),ready:Promise.resolve({active:worker})});
  t.mock.timers.enable({apis:['setTimeout']});
  try {
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker}});
    Object.defineProperty(globalThis,'MessageChannel',{configurable:true,value:class {
      port1={onmessage:null,onmessageerror:null,close:()=>{closes++;}}; port2={close:()=>{closes++;}};
    }});
    const {workspace}=manualFixture();
    const preparing=workspace.ensureResources(true);
    const rejected=assert.rejects(preparing,/modelo.*sin red/);
    for(let i=0;i<12;i++) await Promise.resolve();
    assert.equal(posted,false); assert.equal(getEventListeners(worker,'statechange').length,1);
    worker.state='activated'; worker.dispatchEvent(new Event('statechange'));
    for(let i=0;i<12;i++) await Promise.resolve();
    assert.equal(posted,true); assert.equal(getEventListeners(worker,'statechange').length,0);
    t.mock.timers.tick(35000); await rejected;
    assert.equal(closes,2); assert.equal(getEventListeners(events,'controllerchange').length,0);
  } finally {
    t.mock.timers.reset();
    for(const [key,descriptor] of Object.entries(previous)) {if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});
