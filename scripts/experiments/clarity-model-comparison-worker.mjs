// Isolated, fixed E/model comparison. Never an arbitrary model or URL proxy.
import {handleApi,PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {MAX_RESPONSE_BYTES} from '../../ai/provider-transport.mjs';
import {applyClarityReply,wireSession} from '../../public/clarity-state.mjs';
import {MODEL_COMPARISON_LABEL,MODEL_COMPARISON_TTL_MS,MODEL_COMPARISON_SOURCE,
  validModelComparisonRunId,comparisonArm,comparisonApiRoute,loadModelComparisonFixtures,
  prepareModelComparisonFixture,prepareModelComparison} from './clarity-model-comparison-fixtures.mjs';

const SOURCE_SQL="SELECT * FROM organizer_config WHERE id = 'main'";
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(reason,status)=>json({synthetic:true,label:MODEL_COMPARISON_LABEL,status:'rejected',reason},status);
const windowFor=(env,now)=>{
  const runId=env.LIUBAI_MATERIAL_EVAL_RUN_ID,startedAt=Number(env.LIUBAI_MATERIAL_EVAL_STARTED_AT),expiresAt=startedAt+MODEL_COMPARISON_TTL_MS;
  return validModelComparisonRunId(runId)&&Number.isSafeInteger(startedAt)&&startedAt>0&&now>=startedAt&&now<expiresAt?{runId,startedAt,expiresAt}:null;
};
async function emptyBody(request){
  if(request.signal.aborted)throw Error('invalid_body');if(request.body===null)return;
  const reader=request.body.getReader();let abort,timer;
  const interrupted=new Promise((_,reject)=>{abort=()=>reject(Error('invalid_body'));request.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,250);});
  try{await Promise.race([(async()=>{if(!(await reader.read()).done)throw Error('invalid_body');})(),interrupted]);}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}
function baselineRow(row){
  return row?.id==='main'&&row.provider_id===MODEL_COMPARISON_SOURCE.providerId&&row.model_id===MODEL_COMPARISON_SOURCE.modelId&&
    row.revision===MODEL_COMPARISON_SOURCE.defaultRevision&&row.enabled===1&&row.pricing_mode==='manual'&&row.input_rate===null&&row.output_rate===null&&
    row.call_limit===null&&row.shared_budget_micros===null&&typeof row.encrypted_key==='string'&&row.encrypted_key.length>0&&typeof row.iv==='string'&&row.iv.length>0;
}
function sourceView(env,row,arm,guard){
  // The real database is never reconfigured. Only this exact read is projected;
  // all ledger queries/writes and every other database statement stay native.
  const snapshot=JSON.stringify(row),modelId=comparisonArm(arm).modelId;
  return {...env,DB:{prepare(sql){
    const statement=env.DB.prepare(sql);if(sql!==SOURCE_SQL)return statement;
    return {async first(){
      const actual=await statement.first();
      if(JSON.stringify(actual)!==snapshot){guard.changed=true;throw Error('comparison_source_changed');}
      return {...actual,model_id:modelId};
    }};
  }}};
}
const integer=value=>Number.isSafeInteger(value)&&value>=0;
function captureUsage(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const usage=Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens']
    .filter(key=>integer(value[key])).map(key=>[key,value[key]]));
  for(const [key,fields]of [['prompt_tokens_details',['cached_tokens','cache_write_tokens']],['completion_tokens_details',['reasoning_tokens']]]){
    const details=value[key];if(!details||typeof details!=='object'||Array.isArray(details))continue;
    const safe=Object.fromEntries(fields.filter(name=>integer(details[name])).map(name=>[name,details[name]]));if(Object.keys(safe).length)usage[key]=safe;
  }
  return usage;
}
const safeId=value=>typeof value==='string'&&/^chatcmpl-[a-zA-Z0-9_-]{1,180}$/u.test(value)?value:null;
const safeModel=value=>typeof value==='string'&&(value==='qwen3.8-max-2026-09-02'||
  /^(?:deepseek-v4-pro(?:-[0-9]{4,8})?|qwen3\.8-(?:max|flash)(?:-[0-9]{4,8})?)$/u.test(value))?value:null;
const decoder=new TextDecoder('utf-8',{fatal:true});
export async function captureModelComparisonResponse(response,{signal,timeoutMs=10000}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw new TypeError('invalid_comparison_capture_timeout');
  // Error bodies may echo headers or credentials. The API records a fixed
  // provider failure enum instead; no raw error or response header is exported.
  if(!response.ok||signal?.aborted)return null;const reader=response.clone().body?.getReader();if(!reader)return null;
  const chunks=[];let size=0,abort,timer,emptyChunks=0;const deadline=Date.now()+timeoutMs;
  const interrupted=new Promise(resolve=>{abort=()=>{reader.cancel().catch(()=>{});resolve(null);};
    signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,timeoutMs);if(signal?.aborted)abort();});
  try{return await Promise.race([(async()=>{
    for(;;){if(signal?.aborted||Date.now()>=deadline)return null;const {done,value}=await reader.read();if(done)break;
      if(value.byteLength===0){if(++emptyChunks>8)return null;continue;}emptyChunks=0;
      size+=value.byteLength;if(size>MAX_RESPONSE_BYTES)return null;chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const value=JSON.parse(decoder.decode(bytes));
    return {id:safeId(value?.id),model:safeModel(value?.model),choices:Array.isArray(value?.choices)?value.choices.map(choice=>({
      finish_reason:typeof choice?.finish_reason==='string'?choice.finish_reason:null,
      message:{content:typeof choice?.message?.content==='string'?choice.message.content:null}})):[],usage:captureUsage(value?.usage)};
  })(),interrupted]);}catch{return null;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}

export function createModelComparisonWorker({handleApiImpl=handleApi,fetchImpl=globalThis.fetch,now=()=>Date.now(),captureTimeoutMs=10000}={}){
  if(typeof handleApiImpl!=='function'||typeof fetchImpl!=='function'||typeof now!=='function'||!Number.isInteger(captureTimeoutMs)||captureTimeoutMs<1||captureTimeoutMs>10000)throw new TypeError('invalid_comparison_worker_options');
  return Object.freeze({async fetch(request,env){
    const url=new URL(request.url);
    if(url.search||url.hash||['authorization','proxy-authorization','cookie','api-key','x-api-key'].some(key=>request.headers.has(key)))return fail('invalid_preview_request',400);
    const active=windowFor(env,now());if(!active)return fail('preview_expired_or_unconfigured',410);
    if(url.pathname==='/health'&&request.method==='GET'){try{await emptyBody(request);}catch{return fail('invalid_preview_request',400);}return json({label:MODEL_COMPARISON_LABEL,...active});}
    const match=/^\/evaluate\/([a-zA-Z0-9_]+)\/(reference|max|flash)$/u.exec(url.pathname),caseId=match?.[1],arm=match?.[2];
    if(request.method!=='POST'||!match||!comparisonArm(arm))return fail('not_found',404);
    if(request.headers.get('X-Liubai-Evaluation-Run')!==active.runId)return fail('preview_run_mismatch',409);
    if(env.LIUBAI_DATA_MIGRATION_STATE!=='verified')return fail('migration_unverified',503);
    try{await emptyBody(request);}catch{return fail('invalid_preview_request',400);}
    let sample;try{sample=(await loadModelComparisonFixtures()).find(value=>value.id===caseId);}catch{return fail('preview_fixtures_unavailable',503);}if(!sample)return fail('not_found',404);
    let seeded;try{seeded=prepareModelComparisonFixture(sample,active.runId,active.startedAt,arm);}catch{return fail('fixture_reconstruction_failed',409);}
    const {session,ticket,context}=seeded,routeMetadata=comparisonApiRoute(arm),guard={changed:false};
    const transport={dispatches:0,requestedModel:routeMetadata.modelId,returnedModel:null,request:null,response:null,httpStatus:null,elapsedMs:null};let prepared,control;
    const current=()=>{const latest=windowFor(env,now());return !request.signal.aborted&&latest?.runId===active.runId&&latest.startedAt===active.startedAt&&latest.expiresAt===active.expiresAt;};
    const internal=(path,options={})=>new Request(new URL(path,url.origin),{...options,signal:request.signal});
    const envelope=(api,progress,semanticReview)=>({synthetic:true,label:MODEL_COMPARISON_LABEL,kind:'fixed_examples_model_arm',runId:active.runId,caseId,arm,
      requestId:ticket.requestId,revision:ticket.revision,context,source:MODEL_COMPARISON_SOURCE,route:routeMetadata,control:control??null,
      hostRequest:prepared?{policyVersion:prepared.requestData.policyVersion,schemaVersion:prepared.requestData.schemaVersion,binding:prepared.binding}:null,
      transport,api,progress,semanticReview});
    try{
      const preflight=await handleApiImpl(internal('/api/ai/status'),env,{now}),status=await preflight.json();
      if(preflight.status!==200||!status.enabled||!status.defaultAvailable||status.defaultEnabled===false||status.configVersion!==PUBLIC_CONFIG_VERSION||status.consentVersion!==CONSENT_VERSION||
        !same(status.defaultProfile&&{sourceMode:'default',providerId:status.defaultProfile.providerId,modelId:status.defaultProfile.modelId,defaultRevision:status.defaultProfile.defaultRevision},MODEL_COMPARISON_SOURCE))return fail('default_route_mismatch',409);
      if(!current())return fail('inactive_preview',409);
      const actualRow=await env.DB.prepare(SOURCE_SQL).first();if(!baselineRow(actualRow))return fail('default_source_mismatch',409);
      const view=sourceView(env,actualRow,arm,guard),comparison=await prepareModelComparison(context),selected=comparison.arms[arm];
      prepared=selected.prepared;control=comparison.control;const {route,transport:expected}=selected;transport.request=JSON.parse(expected.body);
      const guardedFetch=async(endpoint,options)=>{
        if(!current()||guard.changed||options?.signal?.aborted||endpoint!==route.endpoint||options?.method!=='POST'||options?.redirect!=='manual'||options?.body!==expected.body||transport.dispatches!==0)throw Error('model_comparison_transport_boundary');
        transport.dispatches=1;const started=now();try{const response=await fetchImpl(endpoint,options);transport.httpStatus=response.status;
          transport.response=await captureModelComparisonResponse(response,{signal:options.signal,timeoutMs:captureTimeoutMs});transport.returnedModel=transport.response?.model??null;
          if(response.ok&&transport.response===null){response.body?.cancel().catch(()=>{});throw Error('model_comparison_capture_unavailable');}return response;
        }finally{transport.elapsedMs=Math.max(0,now()-started);}
      };
      const payload={flow:'clarity-v2',...routeMetadata,configVersion:status.configVersion,consentVersion:status.consentVersion,requestId:ticket.requestId,revision:ticket.revision,
        stage:'review',allowNextStep:false,session:wireSession(session)},started=now();
      const response=await handleApiImpl(internal('/api/ai/generate',{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify(payload)}),view,
        {now,fetchImpl:guardedFetch,prepareClarityRun:async(actual,profile)=>{
          if(!current()||guard.changed||!same(actual,context)||!same(profile,route.profile))throw Error('model_comparison_context_boundary');
          return {requestData:prepared.requestData,run:options=>prepared.run({...options,isCurrent:snapshot=>current()&&!guard.changed&&options.isCurrent(snapshot)})};
        }});
      const result=await response.json();if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).some(key=>!['status','candidate','reason','policyVersion','schemaVersion','requestId','revision','route','flow'].includes(key)))throw Error('model_comparison_public_result_boundary');
      const progress={applied:false,maySave:false,stopReason:guard.changed?'source_changed':!current()?'preview_inactive_after_generation':null};
      if(!progress.stopReason&&response.status===200&&result.status==='candidate')progress.applied=applyClarityReply(session,ticket,result).ok;
      progress.retentionVisibility=prepared.checkVisibleMaterial(session);progress.maySave=progress.applied&&progress.retentionVisibility.status==='visible'&&progress.retentionVisibility.allVisible&&!session.stale;
      return json(envelope({httpStatus:response.status,elapsedMs:Math.max(0,now()-started),result},progress,'pending_manual_review'));
    }catch{return json(envelope({httpStatus:null,result:{status:'fallback',reason:'model_comparison_evaluation_failed',candidate:null}},
      {applied:false,maySave:false,stopReason:guard.changed?'source_changed':null},'not_evaluated'));}
  }});
}
export default createModelComparisonWorker();
