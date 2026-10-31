// Isolated, fixed synthetic evaluation. Not imported by the production Worker.
// Continuations contain only this run's synthetic state and are authenticated
// inside the Worker. No credentials or continuation tokens enter evidence.
import {handleApi,PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {buildClarityModelRequest,clarityContract} from '../../ai/clarity.mjs';
import {prepareConcernMaterialSetRun} from '../../ai/experiments/clarity-material-set.mjs';
import {prepareRetainedConcernRun,prepareFaithfulRetainedConcernRun} from '../../ai/experiments/clarity-retained-concern.mjs';
import {prepareGuidedReflectRun} from '../../ai/experiments/clarity-guided-reflect.mjs';
import {prepareSourceCheckedReflectRun,prepareSourceCheckedReviewRun} from '../../ai/experiments/clarity-source-checked.mjs';
import {prepareDurationSourceCheck} from '../../ai/experiments/clarity-duration-source.mjs';
import {runCandidate} from '../../ai/runtime.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest,MAX_RESPONSE_BYTES} from '../../ai/provider-transport.mjs';
import {applyClarityReply,wireSession} from '../../public/clarity-state.mjs';
import {V2_LABEL,V2_TTL_MS,V2_ROUTE,V2_CASE_IDS,validRunId,isFullCase,fixtureFor,prepareV2Step,checkContinuationSession,matchesExpectedConcernQuestion} from './clarity-material-v2-fixtures.mjs';
import {V4_CASE_IDS,isBoundaryCase,fixtureForV4,prepareV4Step,checkV4ContinuationSession} from './clarity-retention-v4-fixtures.mjs';
import {V5_CASE_IDS,isV5Probe,fixtureForV5,prepareV5Step,checkV5ContinuationSession,purposeForV5Case} from './clarity-retention-v5-fixtures.mjs';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const failure=(reason,status)=>json({synthetic:true,status:'rejected',reason},status);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const route=getPersonalRoute(V2_ROUTE.providerId,V2_ROUTE.modelId);
const MAX_BODY_BYTES=64*1024;
const EXPERIMENTS=Object.freeze({
  2:Object.freeze({label:V2_LABEL,tokenVersion:'liubai-material-v2-continuation-1',salt:'liubai-material-v2-preview',prepare:prepareConcernMaterialSetRun}),
  3:Object.freeze({label:'liubai-material-retention-preview-3',tokenVersion:'liubai-material-v3-continuation-1',salt:'liubai-material-retention-v3-preview',prepare:prepareRetainedConcernRun}),
  4:Object.freeze({label:'liubai-guided-retention-preview-4',tokenVersion:'liubai-material-v4-continuation-1',salt:'liubai-guided-retention-v4-preview',prepare:prepareFaithfulRetainedConcernRun}),
  5:Object.freeze({label:'liubai-duration-source-preview-5',tokenVersion:'liubai-material-v5-continuation-1',salt:'liubai-duration-source-v5-preview',prepare:prepareSourceCheckedReviewRun}),
});
const EMPTY_BODY=Symbol('empty_proxy_body');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
const unb64=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]+$/u.test(value))throw Error('invalid_token');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));};
const windowFor=(env,now)=>{
  const runId=env.LIUBAI_MATERIAL_EVAL_RUN_ID,startedAt=Number(env.LIUBAI_MATERIAL_EVAL_STARTED_AT),expiresAt=startedAt+V2_TTL_MS;
  return validRunId(runId)&&Number.isSafeInteger(startedAt)&&startedAt>0&&now>=startedAt&&now<expiresAt?{runId,startedAt,expiresAt}:null;
};

async function boundedBody(request){
  if(request.signal.aborted)throw Error('invalid_body');
  if(request.body===null)return EMPTY_BODY;
  const reader=request.body.getReader();let timer,abort;const chunks=[];let size=0;
  const interrupted=new Promise((_,reject)=>{abort=()=>reject(Error('invalid_body'));request.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,250);});
  try{
    const reading=(async()=>{for(;;){const {done,value}=await reader.read();if(done)break;
      // Non-final empty chunks are not a bodyless proxy request.
      if(!value?.byteLength)throw Error('invalid_body');size+=value.byteLength;if(size>MAX_BODY_BYTES)throw Error('invalid_body');chunks.push(value);
    }if(!size)return EMPTY_BODY;const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return JSON.parse(decoder.decode(bytes));})();
    return await Promise.race([reading,interrupted]);
  }finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function signingKey(env,experiment){
  // A separate HKDF domain avoids reusing the AES-GCM key as a MAC key.
  const secret=env.LIUBAI_SECRET_KEY;
  if(typeof secret!=='string')throw Error('signing_unconfigured');
  const bytes=Uint8Array.from(atob(secret),c=>c.charCodeAt(0));if(bytes.length!==32)throw Error('signing_unconfigured');
  const root=await crypto.subtle.importKey('raw',bytes,'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode(experiment.salt),info:encoder.encode(experiment.tokenVersion)},root,{name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
}
async function seal(payload,key){const bytes=encoder.encode(JSON.stringify(payload));return `${b64(bytes)}.${b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes)))}`;}
async function open(token,key,active,id,step,experiment,experimentVersion){
  if(typeof token!=='string'||token.length>MAX_BODY_BYTES||token.split('.').length!==2)throw Error('invalid_continuation');
  const [data,mac]=token.split('.'),bytes=unb64(data),signature=unb64(mac);
  if(signature.length!==32||!await crypto.subtle.verify('HMAC',key,signature,bytes))throw Error('invalid_continuation');
  const value=JSON.parse(decoder.decode(bytes));
  if(!exact(value,['version','runId','caseId','nextStep','expiresAt','session'])||value.version!==experiment.tokenVersion||value.runId!==active.runId||value.caseId!==id||
    value.nextStep!==step||value.expiresAt!==active.expiresAt||!(experimentVersion===5?checkV5ContinuationSession(value.session,id,active.runId,step):experimentVersion===4?checkV4ContinuationSession(value.session,id,active.runId,step):checkContinuationSession(value.session,id,active.runId,step,experimentVersion)))throw Error('invalid_continuation');
  return value.session;
}
async function capturedResponse(response){
  if(!response.ok)return null;
  const reader=response.clone().body?.getReader();if(!reader)return null;let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE_BYTES)return null;chunks.push(value);}
    const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}const value=JSON.parse(decoder.decode(bytes));
    const usage=value.usage&&typeof value.usage==='object'?Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'].filter(k=>Number.isSafeInteger(value.usage[k])&&value.usage[k]>=0).map(k=>[k,value.usage[k]])):null;
    return {choices:Array.isArray(value.choices)?value.choices.map(c=>({finish_reason:typeof c?.finish_reason==='string'?c.finish_reason:null,message:{content:typeof c?.message?.content==='string'?c.message.content:null}})):[],usage};
  }catch{return null;}finally{reader.cancel().catch(()=>{});reader.releaseLock();}
}
function durationEvidence(prepared,transport,result,preparation=null){
  let raw=null,compiled=null;
  if(typeof prepared?.checkDuration==='function'){
    const content=transport.response?.choices?.[0]?.message?.content;
    if(typeof content==='string'){
      let parsed;try{parsed={value:JSON.parse(content)};}catch{}
      if(parsed)raw=prepared.checkDuration(parsed.value);
    }
    if(result?.candidate)compiled=prepared.checkDuration(result.candidate);
  }
  return {preparation:prepared?.durationTrace??preparation,raw,compiled};
}

export function createMaterialV2Worker({handleApiImpl=handleApi,prepareRun,fetchImpl=globalThis.fetch,now=()=>Date.now(),experimentVersion=2}={}){
  // Internal factory selection only; neither request data nor bindings can
  // switch the protocol, label or continuation authentication domain.
  if(experimentVersion!==2&&experimentVersion!==3&&experimentVersion!==4&&experimentVersion!==5)throw new TypeError('invalid_material_experiment_version');
  const experiment=EXPERIMENTS[experimentVersion];
  const caseIds=experimentVersion===5?V5_CASE_IDS:experimentVersion===4?V4_CASE_IDS:V2_CASE_IDS,
    fixture=experimentVersion===5?fixtureForV5:experimentVersion===4?fixtureForV4:fixtureFor;
  prepareRun??=experiment.prepare;
  if(typeof prepareRun!=='function')throw new TypeError('invalid_material_preparation');
  return Object.freeze({async fetch(request,env){
    const url=new URL(request.url);
    if(url.search||url.hash||['authorization','cookie','api-key','x-api-key'].some(k=>request.headers.has(k)))return failure('invalid_preview_request',400);
    const active=windowFor(env,now());if(!active)return failure('preview_expired_or_unconfigured',410);
    if(url.pathname==='/health'&&request.method==='GET'){
      try{if(await boundedBody(request)!==EMPTY_BODY)return failure('invalid_preview_request',400);}catch{return failure('invalid_preview_request',400);}
      return json({label:experiment.label,...active});
    }
    const match=/^\/evaluate\/([a-zA-Z0-9_]+)\/([1-4])$/u.exec(url.pathname),caseId=match?.[1],step=Number(match?.[2]);
    if(request.method!=='POST'||!caseIds.includes(caseId)||(!isFullCase(caseId)&&step!==1))return failure('not_found',404);
    if(request.headers.get('X-Liubai-Evaluation-Run')!==active.runId)return failure('preview_run_mismatch',409);
    if(env.LIUBAI_DATA_MIGRATION_STATE!=='verified')return failure('migration_unverified',503);
    let body,key,prior;
    try{
      body=await boundedBody(request);
      if(step===1&&body!==EMPTY_BODY||step>1&&(!exact(body,['continuationToken'])||!/^application\/json(?:;|$)/iu.test(request.headers.get('content-type')??'')))throw Error('invalid_body');
      if(isFullCase(caseId)){key=await signingKey(env,experiment);if(step>1)prior=await open(body.continuationToken,key,active,caseId,step,experiment,experimentVersion);}
    }catch{return failure('invalid_preview_continuation',400);}
    let preparedStep;try{preparedStep=experimentVersion===5?prepareV5Step(caseId,active.runId,active.startedAt,step,prior):experimentVersion===4?prepareV4Step(caseId,active.runId,active.startedAt,step,prior):prepareV2Step(caseId,active.runId,active.startedAt,step,prior,experimentVersion);}catch{return failure('fixture_or_question_boundary',409);}
    const {session,ticket,context}=preparedStep,full=isFullCase(caseId),boundary=experimentVersion===5?isV5Probe(caseId):experimentVersion===4&&isBoundaryCase(caseId),final=!boundary&&(!full||step===4),
      kind=boundary?(experimentVersion===5?'source_boundary_probe':'scene_boundary_probe'):full?'fixed_dialogue_step':'controlled_review_only',
      purpose=experimentVersion===5?purposeForV5Case(caseId):null;
    const current=()=>{const latest=windowFor(env,now());return !request.signal.aborted&&latest?.runId===active.runId&&latest.startedAt===active.startedAt&&latest.expiresAt===active.expiresAt;};
    const internal=(path,options={})=>new Request(new URL(path,url.origin),{...options,signal:request.signal});
    const transport={dispatches:0,request:null,response:null,httpStatus:null,elapsedMs:null};
    let prepared,durationPreparation=null;
    try{
      const preflight=await handleApiImpl(internal('/api/ai/status'),env,{now}),status=await preflight.json();
      if(preflight.status!==200||!status.enabled||!status.defaultAvailable||status.defaultEnabled===false||status.configVersion!==PUBLIC_CONFIG_VERSION||status.consentVersion!==CONSENT_VERSION||
        status.defaultProfile?.providerId!==V2_ROUTE.providerId||status.defaultProfile?.modelId!==V2_ROUTE.modelId||status.defaultProfile?.defaultRevision!==V2_ROUTE.defaultRevision)return failure('default_route_mismatch',409);
      if(!current())return failure('inactive_preview',409);
      if(experimentVersion===5&&purpose==='personal_reflection'){
        durationPreparation=prepareDurationSourceCheck(context,{purpose}).trace;
        if(durationPreparation.status!=='ready')return json({synthetic:true,label:experiment.label,kind,runId:active.runId,caseId,step,requestId:ticket.requestId,revision:ticket.revision,route:V2_ROUTE,context,
          preparationUnsupported:true,hostRequest:null,transport,durationChecks:{preparation:durationPreparation,raw:null,compiled:null},
          api:{httpStatus:null,result:{status:'fallback',reason:'unsupported_duration_source_scope'}},
          progress:{applied:false,mayContinue:false,stopReason:'unsupported_duration_source_scope',...(boundary?{probeComplete:false}:{})},semanticReview:'not_evaluated',continuationToken:null});
      }
      prepared=final?await prepareRun(context,route.profile,experimentVersion===5?{purpose}:undefined):experimentVersion===5?await prepareSourceCheckedReflectRun(context,route.profile,{purpose}):experimentVersion===4?await prepareGuidedReflectRun(context,route.profile):{requestData:buildClarityModelRequest(context,route.profile),run:options=>runCandidate({...options,context,contract:clarityContract})};
      if(experimentVersion===5&&typeof prepared.checkDuration!=='function')throw Error('evaluation_duration_boundary');
      const expected=prepareProviderRequest(prepared.requestData,route);transport.request=JSON.parse(expected.body);
      const guardedFetch=async(endpoint,options)=>{
        // Credentials in options.headers remain opaque and are never copied.
        if(!current()||options?.signal?.aborted||endpoint!==route.endpoint||options?.method!=='POST'||options?.redirect!=='manual'||options?.body!==expected.body||transport.dispatches!==0)throw Error('evaluation_transport_boundary');
        transport.dispatches=1;const started=now();try{const response=await fetchImpl(endpoint,options);transport.httpStatus=response.status;transport.response=await capturedResponse(response);return response;}finally{transport.elapsedMs=Math.max(0,now()-started);}
      };
      const payload={flow:'clarity-v2',...V2_ROUTE,configVersion:status.configVersion,consentVersion:status.consentVersion,requestId:ticket.requestId,revision:ticket.revision,stage:context.stage,allowNextStep:false,session:wireSession(session)};
      const started=now();
      const response=await handleApiImpl(internal('/api/ai/generate',{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify(payload)}),env,{now,fetchImpl:guardedFetch,prepareClarityRun:async(actual,profile)=>{
        if(!current()||!same(actual,context)||!same(profile,route.profile))throw Error('evaluation_context_boundary');
        return {requestData:prepared.requestData,run:options=>prepared.run({...options,isCurrent:snapshot=>current()&&options.isCurrent(snapshot)})};
      }});
      const result=await response.json();let continuationToken=null,progress={applied:false,mayContinue:false,stopReason:null,...(boundary?{probeComplete:false}:{})};
      if(!current())progress.stopReason='preview_inactive_after_generation';
      else if(result.status==='candidate'&&response.status===200){
        const applied=applyClarityReply(session,ticket,result);progress.applied=applied.ok;
        if(applied.ok&&boundary)progress.probeComplete=true;
        else if(applied.ok&&!final){
          const target=fixture(caseId).expectedQuestionTargets[step-1];
          if(result.candidate.finish)progress.stopReason='finished_before_fixture_end';
          else if(!matchesExpectedConcernQuestion(session,fixture(caseId),step-1))progress.stopReason=session.modeId!=='concern'?'scene_mismatch':
            session.question?.target!==target?'question_target_mismatch':'question_text_mismatch';
          else if(current()){
            continuationToken=await seal({version:experiment.tokenVersion,runId:active.runId,caseId,nextStep:step+1,expiresAt:active.expiresAt,session},key);progress.mayContinue=true;
          }
        }else if(applied.ok&&final&&!result.candidate.finish)progress.stopReason='final_not_finished';
      }
      if((experimentVersion===3||experimentVersion===4||experimentVersion===5)&&final&&typeof prepared.checkVisibleMaterial==='function')progress.retentionVisibility=prepared.checkVisibleMaterial(session);
      return json({synthetic:true,label:experiment.label,kind,runId:active.runId,caseId,step,requestId:ticket.requestId,revision:ticket.revision,route:V2_ROUTE,context,
        hostRequest:{policyVersion:prepared.requestData.policyVersion,schemaVersion:prepared.requestData.schemaVersion,binding:prepared.binding??null},
        transport,...(experimentVersion===5?{durationChecks:durationEvidence(prepared,transport,result,durationPreparation)}:{}),api:{httpStatus:response.status,elapsedMs:Math.max(0,now()-started),result},progress,semanticReview:'pending_manual_review',continuationToken});
    }catch{return json({synthetic:true,label:experiment.label,...(experimentVersion===4||experimentVersion===5?{kind}:{}),runId:active.runId,caseId,step,requestId:ticket.requestId,revision:ticket.revision,route:V2_ROUTE,context,transport,
      ...(experimentVersion===5?{durationChecks:durationEvidence(prepared,transport,null,durationPreparation)}:{}),
      api:{httpStatus:null,result:{status:'fallback',reason:'evaluation_failed'}},progress:{applied:false,mayContinue:false,stopReason:null,...(boundary?{probeComplete:false}:{})},semanticReview:'not_evaluated',continuationToken:null});}
  }});
}
export default createMaterialV2Worker();
