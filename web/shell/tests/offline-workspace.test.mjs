import assert from 'node:assert/strict';
import test from 'node:test';
import { OfflineWorkspace } from '../src/offline/workspace.ts';

// Unit doubles only: exercises asynchronous draft capture, not authentication or server integration.
function fixture() {
  let release;
  const buffer = new Promise(resolve => { release = resolve; });
  class DelayedPhoto extends Blob { async arrayBuffer() { return buffer; } }
  const photo = new DelayedPhoto(['photo'], { type: 'image/jpeg' });
  const fields = { 'offline-work': { value: 'assignment-1' }, 'offline-description': { value: 'Reviewed photo' }, 'offline-minutes': { value: '15' } };
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
