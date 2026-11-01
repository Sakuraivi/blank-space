// Single fixed arm per request. No prompt/variant input, proxy or continuation.
import {handleApi,PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from '../../server/api.mjs';
import {getPersonalRoute} from '../../ai/providers.mjs';
import {prepareProviderRequest} from '../../ai/provider-transport.mjs';
import {applyClarityReply,wireSession} from '../../public/clarity-state.mjs';
import {captureSemanticAuditResponse} from './clarity-semantic-audit-worker.mjs';
import {EXAMPLE_LABEL,EXAMPLE_TTL_MS,EXAMPLE_ROUTE,validExampleRunId,loadExampleReviewFixtures,prepareExampleFixture,prepareExamplePair} from './clarity-example-review-fixtures.mjs';
const route=getPersonalRoute(EXAMPLE_ROUTE.providerId,EXAMPLE_ROUTE.modelId),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(reason,status)=>json({synthetic:true,label:EXAMPLE_LABEL,status:'rejected',reason},status);
const windowFor=(env,now)=>{const runId=env.LIUBAI_MATERIAL_EVAL_RUN_ID,startedAt=Number(env.LIUBAI_MATERIAL_EVAL_STARTED_AT),expiresAt=startedAt+EXAMPLE_TTL_MS;
  return validExampleRunId(runId)&&Number.isSafeInteger(startedAt)&&startedAt>0&&now>=startedAt&&now<expiresAt?{runId,startedAt,expiresAt}:null;};
async function emptyBody(request){
  if(request.signal.aborted)throw Error('invalid_body');if(request.body===null)return;const reader=request.body.getReader();let abort,timer;
  const interrupted=new Promise((_,reject)=>{abort=()=>reject(Error('invalid_body'));request.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,250);});
  try{await Promise.race([(async()=>{if(!(await reader.read()).done)throw Error('invalid_body');})(),interrupted]);}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}
export function createExampleReviewWorker({handleApiImpl=handleApi,fetchImpl=globalThis.fetch,now=()=>Date.now(),captureTimeoutMs=10000}={}){
  if(typeof handleApiImpl!=='function'||typeof fetchImpl!=='function'||typeof now!=='function'||!Number.isInteger(captureTimeoutMs)||captureTimeoutMs<1||captureTimeoutMs>10000)throw new TypeError('invalid_example_worker_options');
  return Object.freeze({async fetch(request,env){
    const url=new URL(request.url);if(url.search||url.hash||['authorization','proxy-authorization','cookie','api-key','x-api-key'].some(key=>request.headers.has(key)))return fail('invalid_preview_request',400);
    const active=windowFor(env,now());if(!active)return fail('preview_expired_or_unconfigured',410);
    if(url.pathname==='/health'&&request.method==='GET'){try{await emptyBody(request);}catch{return fail('invalid_preview_request',400);}return json({label:EXAMPLE_LABEL,...active});}
    const match=/^\/evaluate\/([a-zA-Z0-9_]+)\/(baseline|examples)$/u.exec(url.pathname),caseId=match?.[1],arm=match?.[2];if(request.method!=='POST'||!match)return fail('not_found',404);
    if(request.headers.get('X-Liubai-Evaluation-Run')!==active.runId)return fail('preview_run_mismatch',409);
    if(env.LIUBAI_DATA_MIGRATION_STATE!=='verified')return fail('migration_unverified',503);
    try{await emptyBody(request);}catch{return fail('invalid_preview_request',400);}
    let sample;try{sample=(await loadExampleReviewFixtures()).find(value=>value.id===caseId);}catch{return fail('preview_fixtures_unavailable',503);}if(!sample)return fail('not_found',404);
    let seeded;try{seeded=prepareExampleFixture(sample,active.runId,active.startedAt,arm);}catch{return fail('fixture_reconstruction_failed',409);}
    const {session,ticket,context}=seeded,transport={dispatches:0,request:null,response:null,httpStatus:null,elapsedMs:null};let prepared,comparison;
    const current=()=>{const latest=windowFor(env,now());return !request.signal.aborted&&latest?.runId===active.runId&&latest.startedAt===active.startedAt&&latest.expiresAt===active.expiresAt;};
    const internal=(path,options={})=>new Request(new URL(path,url.origin),{...options,signal:request.signal});
    try{
      const preflight=await handleApiImpl(internal('/api/ai/status'),env,{now}),status=await preflight.json();
      if(preflight.status!==200||!status.enabled||!status.defaultAvailable||status.defaultEnabled===false||status.configVersion!==PUBLIC_CONFIG_VERSION||status.consentVersion!==CONSENT_VERSION||
        status.defaultProfile?.providerId!==EXAMPLE_ROUTE.providerId||status.defaultProfile?.modelId!==EXAMPLE_ROUTE.modelId||status.defaultProfile?.defaultRevision!==EXAMPLE_ROUTE.defaultRevision)return fail('default_route_mismatch',409);
      if(!current())return fail('inactive_preview',409);
      const pair=await prepareExamplePair(context,route.profile);prepared=pair[arm];comparison=pair.comparison;
      const expected=prepareProviderRequest(prepared.requestData,route);transport.request=JSON.parse(expected.body);
      const guardedFetch=async(endpoint,options)=>{
        if(!current()||options?.signal?.aborted||endpoint!==route.endpoint||options?.method!=='POST'||options?.redirect!=='manual'||options?.body!==expected.body||transport.dispatches!==0)throw Error('example_transport_boundary');
        transport.dispatches=1;const start=now();try{const response=await fetchImpl(endpoint,options);transport.httpStatus=response.status;
          transport.response=await captureSemanticAuditResponse(response,{signal:options.signal,timeoutMs:captureTimeoutMs});
          if(response.ok&&transport.response===null){response.body?.cancel().catch(()=>{});throw Error('example_capture_unavailable');}return response;
        }finally{transport.elapsedMs=Math.max(0,now()-start);}
      };
      const payload={flow:'clarity-v2',...EXAMPLE_ROUTE,configVersion:status.configVersion,consentVersion:status.consentVersion,requestId:ticket.requestId,revision:ticket.revision,
        stage:'review',allowNextStep:false,session:wireSession(session)},start=now();
      const response=await handleApiImpl(internal('/api/ai/generate',{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify(payload)}),env,
        {now,fetchImpl:guardedFetch,prepareClarityRun:async(actual,profile)=>{if(!current()||!same(actual,context)||!same(profile,route.profile))throw Error('example_context_boundary');
          return {requestData:prepared.requestData,run:options=>prepared.run({...options,isCurrent:snapshot=>current()&&options.isCurrent(snapshot)})};}});
      const result=await response.json();if(Object.keys(result).some(key=>!['status','candidate','reason','policyVersion','schemaVersion','requestId','revision','route','flow'].includes(key)))throw Error('example_public_result_boundary');
      const progress={applied:false,maySave:false,stopReason:null};if(!current())progress.stopReason='preview_inactive_after_generation';
      else if(response.status===200&&result.status==='candidate')progress.applied=applyClarityReply(session,ticket,result).ok;
      progress.retentionVisibility=prepared.checkVisibleMaterial(session);progress.maySave=progress.applied&&progress.retentionVisibility.status==='visible'&&progress.retentionVisibility.allVisible&&!session.stale;
      return json({synthetic:true,label:EXAMPLE_LABEL,kind:'paired_example_review_arm',runId:active.runId,caseId,arm,requestId:ticket.requestId,revision:ticket.revision,context,route:EXAMPLE_ROUTE,pairControl:comparison,
        hostRequest:{policyVersion:prepared.requestData.policyVersion,schemaVersion:prepared.requestData.schemaVersion,binding:prepared.binding},transport,
        api:{httpStatus:response.status,elapsedMs:Math.max(0,now()-start),result},progress,semanticReview:'pending_manual_review'});
    }catch{return json({synthetic:true,label:EXAMPLE_LABEL,kind:'paired_example_review_arm',runId:active.runId,caseId,arm,requestId:ticket.requestId,revision:ticket.revision,context,route:EXAMPLE_ROUTE,pairControl:comparison??null,
      hostRequest:prepared?{policyVersion:prepared.requestData.policyVersion,schemaVersion:prepared.requestData.schemaVersion,binding:prepared.binding}:null,transport,
      api:{httpStatus:null,result:{status:'fallback',reason:'example_evaluation_failed',candidate:null}},progress:{applied:false,maySave:false,stopReason:null},semanticReview:'not_evaluated'});}
  }});
}
export default createExampleReviewWorker();
