// Fixed synthetic snapshots only. This worker never accepts a prompt, model,
// credential or endpoint from its caller and never substitutes a v3 contract.
import {handleApi,PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {getOrganizerRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {buildClarityModelRequest,buildClarityContext} from '../../ai/clarity-v3.mjs';
import {deriveConversationPolicy} from '../../public/clarity-v3-intent.mjs';
import {wireSession} from '../../public/clarity-v3-state.mjs';
import {captureModelComparisonResponse} from './clarity-model-comparison-worker.mjs';
import {NATIVE_LABEL,NATIVE_TTL_MS,NATIVE_SOURCE,validNativeRunId,NATIVE_SLOT_IDS,prepareNativeFixture} from './clarity-v3-native-fixtures.mjs';

const SOURCE_SQL="SELECT * FROM organizer_config WHERE id = 'main'";
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(reason,status)=>json({synthetic:true,label:NATIVE_LABEL,status:'rejected',reason},status);
const windowFor=(env,now)=>{
  const runId=env.LIUBAI_MATERIAL_EVAL_RUN_ID,startedAt=Number(env.LIUBAI_MATERIAL_EVAL_STARTED_AT),expiresAt=startedAt+NATIVE_TTL_MS;
  return validNativeRunId(runId)&&Number.isSafeInteger(startedAt)&&startedAt>0&&now>=startedAt&&now<expiresAt?{runId,startedAt,expiresAt}:null;
};
async function emptyBody(request){
  if(request.signal.aborted)throw Error('invalid_body');if(request.body===null)return;
  const reader=request.body.getReader();let abort,timer;
  const interrupted=new Promise((_,reject)=>{abort=()=>reject(Error('invalid_body'));request.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,250);});
  try{await Promise.race([(async()=>{if(!(await reader.read()).done)throw Error('invalid_body');})(),interrupted]);}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}
function baselineRow(row){
  return row?.id==='main'&&row.provider_id===NATIVE_SOURCE.providerId&&row.model_id===NATIVE_SOURCE.modelId&&
    row.revision===NATIVE_SOURCE.defaultRevision&&row.enabled===1&&row.pricing_mode==='manual'&&row.input_rate===null&&row.output_rate===null&&
    row.call_limit===null&&row.shared_budget_micros===null&&typeof row.encrypted_key==='string'&&row.encrypted_key.length>0&&typeof row.iv==='string'&&row.iv.length>0;
}
function guardedSource(env,row,guard){
  // No projection or configuration update: every exact source read must still
  // match its initial snapshot; all native ledger operations pass through.
  const snapshot=JSON.stringify(row);
  const unchanged=async()=>{
    const actual=await env.DB.prepare(SOURCE_SQL).first();
    if(JSON.stringify(actual)!==snapshot){guard.changed=true;return false;}return true;
  };
  return {unchanged,view:{...env,DB:{prepare(sql){
    const statement=env.DB.prepare(sql);if(sql!==SOURCE_SQL)return statement;
    return {async first(){const actual=await statement.first();if(JSON.stringify(actual)!==snapshot){guard.changed=true;throw Error('native_source_changed');}return actual;}};
  }}}};
}

export function createNativeV3Worker({handleApiImpl=handleApi,fetchImpl=globalThis.fetch,now=()=>Date.now(),captureTimeoutMs=10000}={}){
  if(typeof handleApiImpl!=='function'||typeof fetchImpl!=='function'||typeof now!=='function'||!Number.isInteger(captureTimeoutMs)||captureTimeoutMs<1||captureTimeoutMs>10000)throw new TypeError('invalid_native_worker_options');
  const attempted=new Map();
  return Object.freeze({async fetch(request,env){
    const url=new URL(request.url);
    if(url.search||url.hash||['authorization','proxy-authorization','cookie','api-key','x-api-key'].some(key=>request.headers.has(key)))return fail('invalid_preview_request',400);
    const active=windowFor(env,now());if(!active)return fail('preview_expired_or_unconfigured',410);
    if(url.pathname==='/health'&&request.method==='GET'){
      try{await emptyBody(request);}catch{return fail('invalid_preview_request',400);}
      return json({label:NATIVE_LABEL,...active,source:NATIVE_SOURCE,slots:NATIVE_SLOT_IDS});
    }
    const match=/^\/evaluate\/([a-z_]+)$/u.exec(url.pathname),slotId=match?.[1];
    if(request.method!=='POST'||!match||!NATIVE_SLOT_IDS.includes(slotId))return fail('not_found',404);
    if(request.headers.get('X-Liubai-Evaluation-Run')!==active.runId)return fail('preview_run_mismatch',409);
    if(env.LIUBAI_DATA_MIGRATION_STATE!=='verified')return fail('migration_unverified',503);
    try{await emptyBody(request);}catch{return fail('invalid_preview_request',400);}
    const slotKey=`${active.runId}:${active.startedAt}:${slotId}`;
    for(const[key,expiry]of attempted)if(expiry<=now())attempted.delete(key);
    if(attempted.has(slotKey))return fail('duplicate_preview_slot',409);
    let seeded;try{seeded=prepareNativeFixture(slotId,active.runId);}catch{return fail('fixture_reconstruction_failed',409);}
    // Mark even a failed preflight as attempted. There is no silent retry or
    // second dispatch for a registered slot within this worker instance.
    attempted.set(slotKey,active.expiresAt);
    const {session,ticket,context}=seeded,guard={changed:false};
    const transport={dispatches:0,requestedModel:NATIVE_SOURCE.modelId,returnedModel:null,request:null,response:null,httpStatus:null,elapsedMs:null};
    let requestData,source;
    const current=()=>{const latest=windowFor(env,now());return !request.signal.aborted&&latest?.runId===active.runId&&latest.startedAt===active.startedAt&&latest.expiresAt===active.expiresAt;};
    const internal=(path,options={})=>new Request(new URL(path,url.origin),{...options,signal:request.signal});
    const envelope=(api,extra={})=>({synthetic:true,label:NATIVE_LABEL,kind:'fixed_context_native_v3',runId:active.runId,slotId,
      requestId:ticket?.requestId??null,revision:ticket?.revision??context?.revision??null,source:NATIVE_SOURCE,context,
      hostRequest:requestData?{policyVersion:requestData.policyVersion,schemaVersion:requestData.schemaVersion,expectedContext:context}:null,
      transport,api,sourceUnchanged:!guard.changed,activeAfterGeneration:current(),...extra});
    if(ticket===null){
      const policy=deriveConversationPolicy(context);
      if(slotId!=='stop'||(!policy.endRequested&&!policy.pauseRequested))return fail('invalid_local_control_fixture',409);
      return json(envelope(null,{localControl:{status:'completed',kind:policy.endRequested?'end':'pause',discardRequested:policy.discardRequested,modelCalls:0}}));
    }
    try{
      const preflight=await handleApiImpl(internal('/api/ai/status'),env,{now}),status=await preflight.json();
      if(preflight.status!==200||!status.enabled||!status.defaultAvailable||status.defaultEnabled===false||status.configVersion!==PUBLIC_CONFIG_VERSION||status.consentVersion!==CONSENT_VERSION||
        !same(status.defaultProfile&&{sourceMode:'default',providerId:status.defaultProfile.providerId,modelId:status.defaultProfile.modelId,defaultRevision:status.defaultProfile.defaultRevision},NATIVE_SOURCE))return fail('default_route_mismatch',409);
      if(!current())return fail('inactive_preview',409);
      const actualRow=await env.DB.prepare(SOURCE_SQL).first();if(!baselineRow(actualRow))return fail('default_source_mismatch',409);
      source=guardedSource(env,actualRow,guard);
      const route=getOrganizerRoute({providerId:actualRow.provider_id,modelId:actualRow.model_id,pricingMode:actualRow.pricing_mode,inputRate:actualRow.input_rate,outputRate:actualRow.output_rate,revision:actualRow.revision});
      if(!route)throw Error('native_route_unavailable');
      const payload={flow:'clarity-v3',...NATIVE_SOURCE,configVersion:status.configVersion,consentVersion:status.consentVersion,
        requestId:ticket.requestId,revision:ticket.revision,stage:context.stage,allowNextStep:context.allowNextStep,session:wireSession(session)};
      const rebuilt=buildClarityContext({session:payload.session,revision:payload.revision,stage:payload.stage,allowNextStep:payload.allowNextStep});
      if(!same(rebuilt,context))throw Error('native_context_boundary');
      requestData=buildClarityModelRequest(context,route.profile);
      const expected=prepareProviderRequest(requestData,route);transport.request=JSON.parse(expected.body);
      transport.byteLength=expected.byteLength;transport.maximumBytes=route.maxRequestBytes;transport.maxOutputTokens=route.maxOutputTokens;
      const guardedFetch=async(endpoint,options)=>{
        if(!current()||guard.changed||options?.signal?.aborted||endpoint!==route.endpoint||options?.method!=='POST'||options?.redirect!=='manual'||options?.body!==expected.body||transport.dispatches!==0||!await source.unchanged())throw Error('native_transport_boundary');
        transport.dispatches=1;const started=now();try{const response=await fetchImpl(endpoint,options);transport.httpStatus=response.status;
          transport.response=await captureModelComparisonResponse(response,{signal:options.signal,timeoutMs:captureTimeoutMs});transport.returnedModel=transport.response?.model??null;
          if(response.ok&&transport.response===null){response.body?.cancel().catch(()=>{});throw Error('native_capture_unavailable');}return response;
        }finally{transport.elapsedMs=Math.max(0,now()-started);}
      };
      const started=now();
      // Intentionally no preparation hook: handleApi's own public v3 branch
      // selects the unchanged production contract and runtime.
      const response=await handleApiImpl(internal('/api/ai/generate',{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify(payload)}),source.view,{now,fetchImpl:guardedFetch});
      const result=await response.json();
      if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).some(key=>!['status','candidate','reason','policyVersion','schemaVersion','requestId','revision','route','flow'].includes(key)))throw Error('native_public_result_boundary');
      await source.unchanged();
      return json(envelope({httpStatus:response.status,elapsedMs:Math.max(0,now()-started),result}));
    }catch{
      if(source)try{await source.unchanged();}catch{guard.changed=true;}
      return json(envelope({httpStatus:null,result:{status:'fallback',reason:guard.changed?'source_changed':'native_evaluation_failed',candidate:null}}));
    }
  }});
}
export default createNativeV3Worker();
