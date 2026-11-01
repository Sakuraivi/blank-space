// Offline counterfactual only. This module never dispatches a model, reads a
// credential, writes a ledger or installs an adapter in either production flow.
import {getPersonalRoute} from '../providers.mjs';
import {prepareProviderRequest} from '../provider-transport.mjs';
import {prepareExampleReviewRun,EXAMPLE_REVIEW_POLICY} from './clarity-example-review.mjs';
import {createClaritySession,addExpression} from '../../public/clarity-v3-state.mjs';

export const CLARITY_V3_COMPATIBILITY_VERSION='clarity-v3-compatibility-probe-1';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const copy=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const demand=(ok,reason)=>{if(!ok)throw new TypeError(reason);};
const sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');

export async function prepareClarityV3Compatibility(capturedCall){
  // Freeze before the first inherited asynchronous source/index operation.
  let captured;try{captured=freeze(copy(capturedCall));}catch{throw new TypeError('invalid_compatibility_capture');}
  const evidence=captured?.evidence,transport=evidence?.transport,sourceContext=captured?.context;
  demand(plain(sourceContext)&&plain(evidence)&&evidence.synthetic===true&&evidence.kind==='fixed_examples_model_arm'&&
    captured.requestId===evidence.requestId&&captured.revision===sourceContext.revision&&evidence.revision===sourceContext.revision&&
    same(evidence.context,sourceContext)&&plain(transport)&&transport.dispatches===1&&transport.httpStatus===200&&
    evidence.api?.httpStatus===200,'invalid_compatibility_capture');
  const route=getPersonalRoute(evidence.route?.providerId,evidence.route?.modelId);
  demand(route&&transport.requestedModel===route.modelId&&evidence.hostRequest?.policyVersion===EXAMPLE_REVIEW_POLICY&&
    evidence.hostRequest?.schemaVersion==='liubai-material-retention-3','unsupported_compatibility_capture');
  const oldPrepared=await prepareExampleReviewRun(sourceContext,route.profile);
  const expected=prepareProviderRequest(oldPrepared.requestData,route);
  demand(same(transport.request,JSON.parse(expected.body))&&same(evidence.hostRequest.binding,oldPrepared.binding),'compatibility_request_changed');

  const choices=transport.response?.choices;
  demand(Array.isArray(choices)&&choices.length===1&&choices[0]?.finish_reason==='stop'&&text(choices[0]?.message?.content,128*1024),
    'invalid_compatibility_native_response');
  const nativeContent=choices[0].message.content;let raw;
  try{raw=JSON.parse(nativeContent);}catch{throw new TypeError('invalid_compatibility_native_json');}
  demand(exact(raw,['reply','title','claims'])&&text(raw.reply,300)&&text(raw.title,60)&&Array.isArray(raw.claims)&&raw.claims.length<=2&&
    raw.claims.every(claim=>exact(claim,['type','text','anchorIds'])&&['insight','unknown'].includes(claim.type)&&text(claim.text,240)&&
      Array.isArray(claim.anchorIds)&&claim.anchorIds.length>0&&new Set(claim.anchorIds).size===claim.anchorIds.length),
    'invalid_compatibility_native_shape');
  const oldResult=oldPrepared.validateSelection(raw,sourceContext),recorded=evidence.api.result;
  demand(plain(recorded)&&(oldResult.ok?recorded.status==='candidate'&&same(recorded.candidate,oldResult.candidate):
    recorded.status==='fallback'&&recorded.reason===oldResult.reason&&recorded.candidate===null),'compatibility_old_result_changed');

  const ledger=oldPrepared.ledger,active=ledger.units.filter(unit=>unit.status==='active');
  const materials=active.map(unit=>({id:unit.anchorId,sourceId:unit.sourceId,text:unit.text,questionLinks:unit.questionLinks}));
  const supplied=JSON.parse(transport.request.messages[1].content)?.retention;
  demand(ledger.reportReady&&active.length>0&&same(supplied?.materials,materials)&&
    supplied.analysisRoom===480-ledger.retainedText.length,'compatibility_material_changed');
  for(const unit of active){
    const source=sourceContext.statements.find(item=>item.id===unit.sourceId);
    demand(source&&source.text.slice(unit.renderedStart,unit.renderedEnd)===unit.text,'compatibility_source_span_changed');
  }
  const anchorIds=new Set(active.map(unit=>unit.anchorId)),traces=[];
  const mapped=raw.claims.map((claim,index)=>{
    demand(claim.anchorIds.every(id=>typeof id==='string'&&anchorIds.has(id)),'compatibility_unknown_anchor');
    const requested=new Set(claim.anchorIds),selected=active.filter(unit=>requested.has(unit.anchorId));
    const evidenceIds=sourceContext.statements.filter(source=>selected.some(unit=>unit.sourceId===source.id)).map(source=>source.id);
    traces.push({index,candidateIndex:index+1,anchorIds:copy(claim.anchorIds),evidenceIds:copy(evidenceIds),
      sourceQuotes:selected.map(unit=>({anchorId:unit.anchorId,sourceId:unit.sourceId,text:unit.text,start:unit.renderedStart,end:unit.renderedEnd}))});
    return {type:claim.type,text:claim.text,evidenceIds,derivation:'inferred',supersedes:[]};
  });
  const candidate={modeId:sourceContext.modeId,goal:sourceContext.goal,reply:raw.reply,question:null,
    claims:[{type:'event',text:ledger.retainedText,evidenceIds:copy(ledger.retainedEvidenceIds),derivation:'stated',supersedes:[]},...mapped],finish:true,title:raw.title};
  const hostAddedFields=[
    {path:'modeId',provenance:'captured_host_context',originalModelField:false},
    {path:'goal',provenance:'captured_host_context',originalModelField:false},
    {path:'question',provenance:'counterfactual_review_operation_not_historical_intent',originalModelField:false},
    {path:'finish',provenance:'counterfactual_review_operation_not_historical_intent',originalModelField:false},
    {path:'claims[0]',provenance:'captured_active_source_material_not_native_analysis',originalModelField:false},
    ...mapped.flatMap((_,index)=>[
      {path:`claims[${index+1}].evidenceIds`,provenance:'captured_anchor_to_source_mapping',originalModelField:false},
      {path:`claims[${index+1}].derivation`,provenance:'host_marks_native_analysis_as_inferred',originalModelField:false},
      {path:`claims[${index+1}].supersedes`,provenance:'no_replacement_was_requested_or_inferred',originalModelField:false},
    ]),
  ];
  const nativeContentSha256=await sha256(nativeContent);
  // Rebuilding this working state is not a migration of a saved record: the
  // capture does not contain removed blocks, locked metadata or past reviews.
  // Source claims and their wire statuses are retained, never silently cleared.
  function createSession(options={}){
    demand(plain(options)&&Object.keys(options).every(key=>key==='explicitReview')&&
      (options.explicitReview===undefined||typeof options.explicitReview==='boolean'),'invalid_compatibility_session_options');
    const session=createClaritySession();session.id=sourceContext.sessionId;session.modeId=sourceContext.modeId;session.goal=sourceContext.goal;
    for(const source of sourceContext.statements){
      const added=addExpression(session,source.text,{kind:source.kind});
      demand(added.id===source.id&&added.text===source.text&&added.kind===source.kind,'compatibility_source_reconstruction_changed');
    }
    demand(session.revision===sourceContext.revision,'compatibility_revision_history_missing');
    session.dialogue=copy(sourceContext.dialogue);session.claims=sourceContext.claims.map(claim=>({...copy(claim),archived:false}));
    session.stale=session.claims.some(claim=>claim.status==='stale');
    if(options.explicitReview===true)addExpression(session,'请AI整理成一份。',{kind:'request'});
    return session;
  }
  return freeze({version:CLARITY_V3_COMPATIBILITY_VERSION,counterfactual:true,modelCalls:0,sourceContext,raw:copy(raw),nativeContentSha256,
    oldValidation:oldResult.ok?{ok:true}:{ok:false,reason:oldResult.reason},mapping:{candidate,claims:traces,hostAddedFields},createSession});
}
