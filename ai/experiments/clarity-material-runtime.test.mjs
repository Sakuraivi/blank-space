import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareConcernMaterialRun,MATERIAL_SELECTION_VERSION } from './clarity-materials.mjs';
import { getPersonalRoute } from '../providers.mjs';
import { CLARITY_SCHEMA_VERSION } from '../../public/clarity-contract.mjs';

const profile=()=>structuredClone(getPersonalRoute('bailian','deepseek-v4-pro-0813').profile);
const context=()=>({sessionId:'material_runtime_synthetic',revision:3,stage:'review',allowNextStep:false,modeId:'concern',goal:'分清这件小事',
  statements:[{id:'u1',kind:'expression',text:'我留了一个下午等朋友，还没确定新的时间。'}],dialogue:[],claims:[]});
const output=request=>{
  const {materialIndex}=JSON.parse(request.input.content);
  return {version:MATERIAL_SELECTION_VERSION,snapshotId:materialIndex.snapshotId,modeId:'concern',goal:'分清这件小事',reply:'这段等待可以先留下。',
    question:null,claims:[{type:'event',anchorIds:[materialIndex.anchors[0].id],supersedes:[]}],finish:true,title:'等一个新的时间'};
};
const completed=value=>({status:'completed',output:value});

test('async preparation captures context and profile before caller edits; request is immutable',async()=>{
  const c=context(),p=profile(),old=structuredClone(p),pending=prepareConcernMaterialRun(c,p);
  c.revision++;c.statements[0].text='已经改过的材料。';p.modelId='other-model';
  const prepared=await pending,data=JSON.parse(prepared.requestData.input.content);
  assert.equal(data.working.revision,3);assert.match(data.materialIndex.anchors[0].quote,/留了一个下午/);
  assert.equal(prepared.requestData.modelId,old.modelId);
  assert.throws(()=>{prepared.requestData.instruction.text='替换提示';},TypeError);
  assert.throws(()=>{prepared.requestData.input.content='替换材料';},TypeError);
});

test('bound synchronous contract sends the preflighted request and emits public metadata only',async()=>{
  const c=context(),p=profile(),prepared=await prepareConcernMaterialRun(c,p);let calls=0;
  const result=await prepared.run({adapter:{profile:p,async generate(request){calls++;assert.equal(request,prepared.requestData);return completed(output(request));}},
    isCurrent:snapshot=>{assert.deepEqual(snapshot,c);return true;},timeoutMs:1000,
    // These injected values must not override the bound context or compiler.
    context:{invalid:true},contract:{validateCandidate:()=>({ok:true,candidate:{forged:true}})}});
  assert.equal(calls,1);assert.equal(result.status,'candidate');assert.equal(result.schemaVersion,CLARITY_SCHEMA_VERSION);
  assert.equal(result.policyVersion,'clarity-material-experiment-1');
  assert.deepEqual(Object.keys(result).sort(),['candidate','policyVersion','schemaVersion','status']);
  assert.equal(Object.keys(result.candidate).length,7);
  assert.equal(result.candidate.claims[0].text,c.statements[0].text);
  assert.doesNotMatch(JSON.stringify(result),/selectionTrace|anchorIds|snapshotId|liubai-material-selection/);
});

test('adapter profile mismatch is rejected before generation',async()=>{
  const p=profile(),prepared=await prepareConcernMaterialRun(context(),p);let calls=0;
  await assert.rejects(prepared.run({adapter:{profile:{...p,modelId:'changed'},generate(){calls++;}},isCurrent:()=>true}),/material_binding_changed/);
  assert.equal(calls,0);
});

test('cancelled or stale prepared runs never dispatch',async()=>{
  const prepared=await prepareConcernMaterialRun(context(),profile());let calls=0;
  const adapter={profile:profile(),generate(){calls++;}},controller=new AbortController();controller.abort();
  for(const options of [{signal:controller.signal,isCurrent:()=>true},{isCurrent:()=>false},{isCurrent:async()=>true}]){
    const result=await prepared.run({adapter,...options});assert.equal(result.status,'discarded');assert.equal(result.candidate,null);
  }
  assert.equal(calls,0);
});

test('a caller edit during preparation is rejected by the lifecycle owner',async()=>{
  const current=context(),pending=prepareConcernMaterialRun(current,profile());current.revision++;
  const prepared=await pending;let calls=0;
  const result=await prepared.run({adapter:{profile:profile(),generate(){calls++;}},isCurrent:snapshot=>snapshot.revision===current.revision});
  assert.equal(result.status,'discarded');assert.equal(calls,0);
});

test('old snapshots and extra private fields do not become public candidates',async()=>{
  for(const mutate of [v=>{v.snapshotId='0'.repeat(64);},v=>{v.debug='forged';}]){
    const prepared=await prepareConcernMaterialRun(context(),profile());let calls=0;
    const result=await prepared.run({adapter:{profile:profile(),async generate(request){calls++;const value=output(request);mutate(value);return completed(value);}},isCurrent:()=>true});
    assert.equal(result.status,'fallback');assert.equal(result.candidate,null);assert.equal(calls,1);
    assert.equal(result.schemaVersion,undefined);
  }
});

test('late output after caller state changes is discarded before compilation',async()=>{
  const prepared=await prepareConcernMaterialRun(context(),profile());let active=true;
  const result=await prepared.run({adapter:{profile:profile(),async generate(request){active=false;return completed(output(request));}},isCurrent:()=>active});
  assert.equal(result.status,'discarded');assert.equal(result.candidate,null);assert.equal(result.schemaVersion,undefined);
});

test('timeout and abort do not acquire success metadata or retry a late generation',async()=>{
  for(const abort of [false,true]){
    const prepared=await prepareConcernMaterialRun(context(),profile()),controller=new AbortController();let release,calls=0;
    const pending=prepared.run({adapter:{profile:profile(),generate(request){calls++;if(abort)queueMicrotask(()=>controller.abort());return new Promise(resolve=>{release=()=>resolve(completed(output(request)));});}},
      signal:controller.signal,isCurrent:()=>true,timeoutMs:20});
    const result=await pending;assert.equal(result.status,abort?'discarded':'fallback');
    assert.equal(result.candidate,null);assert.equal(result.schemaVersion,undefined);assert.equal(calls,1);
    release();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,1);
  }
});

test('unsupported scope fails before any prepared run can exist',async()=>{
  await assert.rejects(prepareConcernMaterialRun({...context(),allowNextStep:true},profile()),/unsupported_material_scope/);
});
