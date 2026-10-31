// Private audit-only evaluation endpoint. The default API owns credentials,
// route checks, reservation, usage and completion. This Worker owns no records.
import {handleApi,PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest,MAX_RESPONSE_BYTES} from '../../ai/provider-transport.mjs';
import {AUDIT_LABEL,AUDIT_TTL_MS,AUDIT_ROUTE,validAuditRunId,loadSemanticAuditFixtures,auditRequestId,auditApiPayload} from './clarity-semantic-audit-fixtures.mjs';

const route=getPersonalRoute(AUDIT_ROUTE.providerId,AUDIT_ROUTE.modelId),decoder=new TextDecoder('utf-8',{fatal:true});
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const failure=(reason,status)=>json({synthetic:true,label:AUDIT_LABEL,status:'rejected',reason},status);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const windowFor=(env,now)=>{
  const runId=env.LIUBAI_MATERIAL_EVAL_RUN_ID,startedAt=Number(env.LIUBAI_MATERIAL_EVAL_STARTED_AT),expiresAt=startedAt+AUDIT_TTL_MS;
  return validAuditRunId(runId)&&Number.isSafeInteger(startedAt)&&startedAt>0&&now>=startedAt&&now<expiresAt?{runId,startedAt,expiresAt}:null;
};
async function emptyBody(request){
  if(request.signal.aborted)throw Error('invalid_body');if(request.body===null)return;
  const reader=request.body.getReader();let timer,abort;
  const interrupted=new Promise((_,reject)=>{abort=()=>reject(Error('invalid_body'));request.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,250);});
  try{await Promise.race([(async()=>{const next=await reader.read();if(!next.done)throw Error('invalid_body');})(),interrupted]);}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function captureSemanticAuditResponse(response,{signal,timeoutMs=10000}={}){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw new TypeError('invalid_audit_capture_timeout');
  if(!response.ok||signal?.aborted)return null;const reader=response.clone().body?.getReader();if(!reader)return null;
  const chunks=[];let size=0,abort,timer,emptyChunks=0;const deadline=Date.now()+timeoutMs;
  const interrupted=new Promise(resolve=>{abort=()=>{reader.cancel().catch(()=>{});resolve(null);};
    signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,timeoutMs);if(signal?.aborted)abort();});
  try{return await Promise.race([(async()=>{
    for(;;){if(signal?.aborted||Date.now()>=deadline)return null;const {done,value}=await reader.read();if(done)break;
      if(value.byteLength===0){if(++emptyChunks>8)return null;continue;}emptyChunks=0;
      size+=value.byteLength;if(size>MAX_RESPONSE_BYTES)return null;chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const value=JSON.parse(decoder.decode(bytes)),usage=value.usage&&typeof value.usage==='object'?Object.fromEntries(
      ['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'].filter(key=>Number.isSafeInteger(value.usage[key])&&value.usage[key]>=0).map(key=>[key,value.usage[key]])):null;
    return {choices:Array.isArray(value.choices)?value.choices.map(choice=>({finish_reason:typeof choice?.finish_reason==='string'?choice.finish_reason:null,
      message:{content:typeof choice?.message?.content==='string'?choice.message.content:null}})):[],usage};
  })(),interrupted]);}catch{return null;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}
function filteredApiResult(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.hasOwn(value,'candidate'))throw Error('audit_result_boundary');
  const allowed=['status','reason','audit','policyVersion','schemaVersion','requestId','revision','route','flow'];
  if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('audit_result_boundary');
  if(!['completed','fallback','discarded'].includes(value.status))throw Error('audit_result_boundary');
  return value;
}

export function createSemanticAuditWorker({handleApiImpl=handleApi,fetchImpl=globalThis.fetch,now=()=>Date.now(),captureTimeoutMs=10000}={}){
  if(typeof handleApiImpl!=='function'||typeof fetchImpl!=='function'||typeof now!=='function'||!Number.isInteger(captureTimeoutMs)||captureTimeoutMs<1||captureTimeoutMs>10000)throw new TypeError('invalid_audit_worker_options');
  return Object.freeze({async fetch(request,env){
    const url=new URL(request.url);
    if(url.search||url.hash||['authorization','proxy-authorization','cookie','api-key','x-api-key'].some(key=>request.headers.has(key)))return failure('invalid_preview_request',400);
    const active=windowFor(env,now());if(!active)return failure('preview_expired_or_unconfigured',410);
    if(url.pathname==='/health'&&request.method==='GET'){
      try{await emptyBody(request);}catch{return failure('invalid_preview_request',400);}return json({label:AUDIT_LABEL,...active});
    }
    const match=/^\/evaluate\/([a-zA-Z0-9_]+)$/u.exec(url.pathname),caseId=match?.[1];
    if(request.method!=='POST'||!match)return failure('not_found',404);
    if(request.headers.get('X-Liubai-Evaluation-Run')!==active.runId)return failure('preview_run_mismatch',409);
    if(env.LIUBAI_DATA_MIGRATION_STATE!=='verified')return failure('migration_unverified',503);
    try{await emptyBody(request);}catch{return failure('invalid_preview_request',400);}
    let sample;try{sample=(await loadSemanticAuditFixtures()).find(value=>value.id===caseId);}catch{return failure('preview_fixtures_unavailable',503);}
    if(!sample)return failure('not_found',404);
    const input=structuredClone(sample.input),requestId=auditRequestId(active.runId,caseId),transport={dispatches:0,request:null,response:null,httpStatus:null,elapsedMs:null};
    const current=()=>{const latest=windowFor(env,now());return !request.signal.aborted&&latest?.runId===active.runId&&latest.startedAt===active.startedAt&&latest.expiresAt===active.expiresAt;};
    const internal=(path,options={})=>new Request(new URL(path,url.origin),{...options,signal:request.signal});
    let prepared;
    try{
      const preflight=await handleApiImpl(internal('/api/ai/status'),env,{now}),status=await preflight.json();
      if(preflight.status!==200||!status.enabled||!status.defaultAvailable||status.defaultEnabled===false||status.configVersion!==PUBLIC_CONFIG_VERSION||status.consentVersion!==CONSENT_VERSION||
        status.defaultProfile?.providerId!==AUDIT_ROUTE.providerId||status.defaultProfile?.modelId!==AUDIT_ROUTE.modelId||status.defaultProfile?.defaultRevision!==AUDIT_ROUTE.defaultRevision)return failure('default_route_mismatch',409);
      if(!current())return failure('inactive_preview',409);
      const {prepareSemanticAuditRun}=await import('../../ai/experiments/clarity-semantic-audit.mjs');
      prepared=await prepareSemanticAuditRun(input,route.profile);
      const expected=prepareProviderRequest(prepared.requestData,route);transport.request=JSON.parse(expected.body);
      const guardedFetch=async(endpoint,options)=>{
        // Headers stay opaque; only the exact prepared bytes may be sent once.
        if(!current()||options?.signal?.aborted||endpoint!==route.endpoint||options?.method!=='POST'||options?.redirect!=='manual'||options?.body!==expected.body||transport.dispatches!==0)throw Error('audit_transport_boundary');
        transport.dispatches=1;const started=now();try{const response=await fetchImpl(endpoint,options);transport.httpStatus=response.status;
          transport.response=await captureSemanticAuditResponse(response,{signal:options.signal,timeoutMs:captureTimeoutMs});
          if(response.ok&&transport.response===null){response.body?.cancel().catch(()=>{});throw Error('audit_capture_unavailable');}
          return response;}finally{transport.elapsedMs=Math.max(0,now()-started);}
      };
      const payload=auditApiPayload(sample,active.runId,status),started=now();
      const response=await handleApiImpl(internal('/api/ai/generate',{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify(payload)}),env,
        {now,fetchImpl:guardedFetch,prepareClarityRun:async(actual,profile)=>{
          if(!current()||!same(actual,input.context)||!same(profile,route.profile))throw Error('audit_context_boundary');
          return {requestData:prepared.requestData,run:options=>prepared.run({...options,isCurrent:snapshot=>current()&&options.isCurrent(snapshot)})};
        }});
      const result=filteredApiResult(await response.json());
      return json({synthetic:true,label:AUDIT_LABEL,kind:'semantic_audit_observation',runId:active.runId,caseId,requestId,revision:input.context.revision,route:AUDIT_ROUTE,
        hostRequest:{policyVersion:prepared.requestData.policyVersion,schemaVersion:prepared.requestData.schemaVersion,binding:prepared.binding},
        transport,api:{httpStatus:response.status,elapsedMs:Math.max(0,now()-started),result},
        progress:{completed:current()&&response.status===200&&result.status==='completed',stateApplied:false},semanticReview:'pending_manual_review'});
    }catch{return json({synthetic:true,label:AUDIT_LABEL,kind:'semantic_audit_observation',runId:active.runId,caseId,requestId,revision:input.context.revision,route:AUDIT_ROUTE,
      hostRequest:prepared?{policyVersion:prepared.requestData.policyVersion,schemaVersion:prepared.requestData.schemaVersion,binding:prepared.binding}:null,
      transport,api:{httpStatus:null,result:{status:'fallback',reason:'audit_evaluation_failed',audit:null}},
      progress:{completed:false,stateApplied:false},semanticReview:'not_evaluated'});}
  }});
}

export default createSemanticAuditWorker();
