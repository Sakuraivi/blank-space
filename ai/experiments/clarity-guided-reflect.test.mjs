import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGuidedReflectRun,replaceGuidedReflectFocus,GUIDED_REFLECT_POLICY} from './clarity-guided-reflect.mjs';
import {buildClarityModelRequest,clarityInstructions,clarityTurnFocus,validateClarityResponse,CLARITY_POLICY_VERSION} from '../clarity.mjs';
import {clarityTurn} from '../clarity-turn.mjs';
import {getPersonalRoute} from '../providers.mjs';
import {CLARITY_SCHEMA_VERSION} from '../../public/clarity-contract.mjs';

const profile=()=>structuredClone(getPersonalRoute('bailian','deepseek-v4-pro-0813').profile);
const context=(text='我留了一个下午等朋友，还没有确定新的时间。')=>({sessionId:'guided_synthetic',revision:1,stage:'reflect',allowNextStep:false,
  modeId:'auto',goal:null,statements:[{id:'u1',text,kind:'expression'}],dialogue:[],claims:[]});
const candidate=(modeId='concern')=>({modeId,goal:'把这件事聊清楚',title:'慢慢聊',reply:'你为这次安排留了一个下午。',
  question:{text:'当时发生了什么？',target:'event',evidenceIds:['u1']},claims:[],finish:false});
const adapter=(value,p=profile())=>({profile:p,async generate(){return {status:'completed',output:structuredClone(value)};}});

test('a single guarded focus replacement preserves the stable input/output contract and base rules',async()=>{
  const c=context(),base=buildClarityModelRequest(c,profile()),p=await prepareGuidedReflectRun(c,profile()),r=p.requestData;
  assert.equal(CLARITY_POLICY_VERSION,'clarity-warm-19');
  assert.equal(GUIDED_REFLECT_POLICY,'clarity-guided-reflect-1');
  assert.equal(r.policyVersion,GUIDED_REFLECT_POLICY);assert.equal(r.schemaVersion,CLARITY_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(r),Object.keys(base));assert.deepEqual(r.input,base.input);assert.deepEqual(r.output,base.output);
  assert.equal(r.providerId,base.providerId);assert.equal(r.modelId,base.modelId);assert.equal(r.instruction.channel,base.instruction.channel);
  const oldFocus=clarityTurnFocus(c),original=clarityInstructions(c),[before,after]=original.split(oldFocus);
  const parts=r.instruction.text.split('\n\n【所有场景的问题来源】');assert.equal(parts.length,2);
  const changedBase=parts[0],newFocus=changedBase.slice(before.length,changedBase.length-after.length);
  assert.equal(changedBase,replaceGuidedReflectFocus(original,oldFocus,newFocus,CLARITY_POLICY_VERSION));
  assert.equal(changedBase.slice(0,before.length),before);assert.equal(changedBase.slice(-after.length),after);
  assert.equal(r.instruction.text.split('【所有场景的问题来源】').length,2);
  assert.match(r.instruction.text,/moment、choice、concern全部遵守，target=unknown也不能填\[\]/u);
  assert.match(r.instruction.text,/没有“烦、难过”等情绪词也可以需要梳理/u);
  assert.match(r.instruction.text,/不从沉默、额外安排或影响自动证明别人的动机/u);
  assert.ok(r.instruction.text.indexOf('1. 先尊重停止')<r.instruction.text.indexOf('2. 正在比较真实可选方案'));
  assert.ok(r.instruction.text.indexOf('2. 正在比较真实可选方案')<r.instruction.text.indexOf('3. 已有本人具体经历'));
  assert.ok(r.instruction.text.indexOf('3. 已有本人具体经历')<r.instruction.text.indexOf('4. 本人只想留住开心'));
  assert.ok(r.instruction.text.indexOf('4. 本人只想留住开心')<r.instruction.text.indexOf('5. 只有知识题'));
  assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.binding)&&Object.isFrozen(r)&&Object.isFrozen(r.input)&&Object.isFrozen(r.output));
});

test('template changes, missing/repeated focus and unsupported base versions fail closed',()=>{
  const c=context(),original=clarityInstructions(c),focus=clarityTurnFocus(c),replacement='synthetic-only';
  assert.equal(replaceGuidedReflectFocus(original,focus,replacement,'clarity-warm-19'),original.replace(focus,replacement));
  for(const [text,old,version] of [
    [original,focus,'clarity-warm-20'],[original,focus,'clarity-guided-reflect-1'],
    [original.replace(focus,''),focus,'clarity-warm-19'],[original+focus,focus,'clarity-warm-19'],
    [original.replace('【本轮工作】','【已改模板】'),focus,'clarity-warm-19'],
    [original.replace('\n先核对最新原话','\n改过的后文'),focus,'clarity-warm-19'],
    [original,'','clarity-warm-19'],[null,focus,'clarity-warm-19']
  ])assert.throws(()=>replaceGuidedReflectFocus(text,old,replacement,version),/unsupported_guided_reflect_base|guided_reflect_template_changed/);
});

test('the preparer supports only non-action reflect and keeps stop/record Host finish authoritative',async()=>{
  for(const c of [{...context(),stage:'review'},{...context(),allowNextStep:true}])await assert.rejects(prepareGuidedReflectRun(c,profile()),/unsupported_guided_reflect_scope/);
  const c=context('今天和朋友散步很轻松。只留原话，不用分析。'),p=await prepareGuidedReflectRun(c,profile());
  assert.equal(clarityTurn(c).finish,true);assert.equal(JSON.parse(p.requestData.input.content).turnPlan.finish,true);
  assert.match(p.requestData.instruction.text,/Host计划已要求收尾：finish=true，question=null/u);
  const value={...candidate('moment'),reply:'我们把这段原话留下。',finish:true,question:null,
    claims:[{type:'event',text:'今天和朋友散步很轻松。',evidenceIds:['u1'],derivation:'stated',supersedes:[]}]};
  const expected=validateClarityResponse(value,c),actual=await p.run({adapter:adapter(value),isCurrent:()=>true});
  assert.equal(expected.ok,true);assert.equal(actual.status,'candidate');assert.deepEqual(actual.candidate,expected.candidate);
});

test('the existing Host concern normalization remains exactly the original validator behavior',async()=>{
  const c=context(),p=await prepareGuidedReflectRun(c,profile()),value=candidate();
  value.question={text:'synthetic-question',target:'invented',evidenceIds:[],instructions:'synthetic-ignore'};
  const expected=validateClarityResponse(value,c);assert.equal(expected.ok,true);
  let calls=0;const actual=await p.run({adapter:{profile:profile(),async generate(request){calls++;assert.equal(request,p.requestData);return {status:'completed',output:value};}},isCurrent:()=>true});
  assert.equal(calls,1);assert.equal(actual.status,'candidate');assert.deepEqual(actual.candidate,expected.candidate);
  assert.deepEqual(actual.candidate.question,{text:clarityTurn(c).question,target:clarityTurn(c).target,evidenceIds:['u1']});
  assert.doesNotMatch(JSON.stringify(actual),/synthetic-question|invented|synthetic-ignore/);
});

test('a legal moment unknown question remains moment without Host forcing concern or manufacturing claims',async()=>{
  const c=context('你知道这位作曲家吗？'),p=await prepareGuidedReflectRun(c,profile()),value={...candidate('moment'),
    reply:'可以从你想聊的部分开始。',question:{text:'你想从哪一方面聊起？',target:'unknown',evidenceIds:['u1']}};
  const result=await p.run({adapter:adapter(value),isCurrent:()=>true});
  assert.equal(result.status,'candidate');assert.deepEqual(result.candidate,value);assert.equal(result.candidate.modeId,'moment');
  assert.deepEqual(result.candidate.claims,[]);assert.equal(result.candidate.finish,false);
  assert.deepEqual(Object.keys(result.candidate).sort(),['modeId','goal','reply','question','claims','finish','title'].sort());
  assert.deepEqual(Object.keys(result).sort(),['status','candidate','policyVersion','schemaVersion'].sort());
});

test('moment questions with empty, duplicate or invented evidence IDs are rejected with no repair',async()=>{
  const c=context('你知道这位作曲家吗？'),p=await prepareGuidedReflectRun(c,profile());
  for(const ids of [[],['u1','u1'],['invented']]){
    const value={...candidate('moment'),question:{text:'你想从哪一方面聊起？',target:'unknown',evidenceIds:ids}};
    let calls=0;const result=await p.run({adapter:{profile:profile(),async generate(){calls++;return {status:'completed',output:value};}},isCurrent:()=>true});
    assert.equal(calls,1);assert.equal(result.status,'fallback');assert.equal(result.reason,'invalid_question');assert.equal(result.candidate,null);
  }
});

test('invalid claim references and extra public fields remain rejected before concern question normalization',async()=>{
  const c=context(),p=await prepareGuidedReflectRun(c,profile());
  const badClaim={...candidate(),question:null,claims:[{type:'thought',text:'等候的安排。',evidenceIds:['invented'],derivation:'inferred',supersedes:[]}]};
  for(const value of [badClaim,{...candidate(),routingReason:'synthetic-new-field'}]){
    const expected=validateClarityResponse(value,c),result=await p.run({adapter:adapter(value),isCurrent:()=>true});
    assert.equal(expected.ok,false);assert.equal(result.status,'fallback');assert.equal(result.reason,expected.reason);assert.equal(result.candidate,null);
  }
});

test('context and profile are captured before the first await; callers cannot override the bound runtime contract',async()=>{
  const c=context(),pr=profile(),original=structuredClone(c),preparing=prepareGuidedReflectRun(c,pr);
  c.statements[0].text='异步之后改掉的表达。';c.revision++;pr.modelId='changed-model';
  const p=await preparing;assert.equal(JSON.parse(p.requestData.input.content).statements[0].text,original.statements[0].text);
  assert.equal(p.binding.revision,original.revision);assert.equal(p.binding.modelId,profile().modelId);
  assert.equal(p.binding.snapshotId.length,64);
  const unchanged=await prepareGuidedReflectRun(original,profile()),changed=await prepareGuidedReflectRun(c,profile());
  assert.equal(p.binding.snapshotId,unchanged.binding.snapshotId);assert.notEqual(p.binding.snapshotId,changed.binding.snapshotId);
  const result=await p.run({adapter:adapter(candidate()),isCurrent:current=>current.revision===original.revision,
    context:{forged:true},contract:{buildModelRequest(){throw Error('must-not-use');}}});
  assert.equal(result.status,'candidate');assert.equal(result.policyVersion,GUIDED_REFLECT_POLICY);assert.equal(result.schemaVersion,CLARITY_SCHEMA_VERSION);
  let calls=0;await assert.rejects(p.run({adapter:{profile:{...profile(),modelId:'changed-model'},async generate(){calls++;}},isCurrent:()=>true}),/guided_reflect_binding_changed/);
  assert.equal(calls,0);assert.throws(()=>{p.requestData.input.content='forged';},TypeError);
});

test('pre-cancelled, in-flight cancelled and late responses are discarded without retries',async()=>{
  const p=await prepareGuidedReflectRun(context(),profile()),controller=new AbortController();controller.abort();let calls=0;
  const a={profile:profile(),async generate(){calls++;return {status:'completed',output:candidate()};}};
  assert.equal((await p.run({adapter:a,signal:controller.signal,isCurrent:()=>true})).status,'discarded');assert.equal(calls,0);
  let active=true;const late=await p.run({adapter:{profile:profile(),async generate(){calls++;active=false;return {status:'completed',output:candidate()};}},isCurrent:()=>active});
  assert.equal(late.status,'discarded');assert.equal(late.candidate,null);assert.equal(calls,1);
  const pendingController=new AbortController();let resolveResponse,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const pending=p.run({adapter:{profile:profile(),generate(){calls++;entered();return new Promise(resolve=>{resolveResponse=resolve;});}},signal:pendingController.signal,isCurrent:()=>true});
  await started;pendingController.abort();const cancelled=await pending;
  assert.equal(cancelled.status,'discarded');assert.equal(cancelled.candidate,null);
  resolveResponse({status:'completed',output:candidate()});await Promise.resolve();assert.equal(calls,2);
});
