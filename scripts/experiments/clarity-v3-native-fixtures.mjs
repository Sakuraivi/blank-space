// Fixed, already known synthetic contexts; never a continuous/adaptive user study.
// Expectations stay outside model input. No captured model output is replayed.
import {RELATION_PLAN_KNOWN_SAMPLES} from '../../ai/fixtures/clarity-relation-plan-known.mjs';
import {createClaritySession,addExpression,beginClarityRequest,wireSession} from '../../public/clarity-v3-state.mjs';
import {buildClarityContext} from '../../public/clarity-v3-contract.mjs';

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const NATIVE_LABEL='liubai-native-v3-qualification-1';
export const NATIVE_ORIGIN='http://127.0.0.1:4199';
export const NATIVE_TTL_MS=20*60*1000;
export const NATIVE_SOURCE=freeze({sourceMode:'default',providerId:'bailian',modelId:'deepseek-v4-pro-0813',defaultRevision:3});
export const validNativeRunId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,32}$/u.test(value);
const full=RELATION_PLAN_KNOWN_SAMPLES.find(s=>s.id==='RELATION_K_FULL').context.statements.map(s=>s.text);
const listening='我只想说说。不用分析，也不用追问。';
const clarify='请帮我理清。';
const review='请AI整理成一份。';
const correction='我不是委屈，主要是生气。';
export const NATIVE_CASES=freeze([
  {id:'listen',entries:[full[0],listening],purpose:'具体倾听，禁分析、禁问；无报告',expected:{stage:'reflect',allowInterpretation:false,allowQuestion:false,reviewRequested:false}},
  {id:'continue',entries:[full[0],listening,full[1]],purpose:'独立续说快照；早先禁分析/禁问不能因新增材料失效',expected:{stage:'reflect',allowInterpretation:false,allowQuestion:false,reviewRequested:false}},
  {id:'clarify',entries:[...full,clarify],purpose:'明示理清但不成稿；连接日语时间与怕拒绝后尴尬',expected:{stage:'reflect',allowInterpretation:true,allowQuestion:true,reviewRequested:false}},
  {id:'review',entries:[...full,review],purpose:'明示成稿；新原生理解保留两侧、条件和未知',expected:{stage:'review',allowInterpretation:true,allowQuestion:false,reviewRequested:true}},
  {id:'correction',entries:[...full,clarify,correction],purpose:'自然表达纠正情绪；不撤回日语时间或怕尴尬的顾虑',expected:{stage:'reflect',allowInterpretation:true,allowQuestion:true,reviewRequested:false}},
  {id:'corrected_review',entries:[...full,correction,review],purpose:'采用生气的修订成稿，否定的委屈不可回流',expected:{stage:'review',allowInterpretation:true,allowQuestion:false,reviewRequested:true}},
  {id:'stop',entries:[full[0],'先到这里，不保存。'],purpose:'明示不保存结束的本地控制；不调用模型',expected:{stage:'reflect',endRequested:true,discardRequested:true}},
]);
export const NATIVE_SLOT_IDS=freeze(NATIVE_CASES.map(s=>s.id));
export function prepareNativeFixture(slotId,runId){
  if(!validNativeRunId(runId))throw new TypeError('invalid_native_run_id');
  const sample=NATIVE_CASES.find(s=>s.id===slotId);if(!sample)throw new TypeError('invalid_native_slot');
  const session=createClaritySession();session.id=`native3_${runId}_${slotId}`;
  session.createdAt='2026-11-01T00:00:00.000Z'; // Fixed test metadata, not an observed user time.
  for(const value of sample.entries)addExpression(session,value); // Same natural-input kind as UI; no fabricated Q/A or claims.
  if(slotId==='stop'){
    const context=buildClarityContext({session:wireSession(session),revision:session.revision,stage:'reflect',allowNextStep:false});
    let reason;try{beginClarityRequest(session);}catch(error){reason=error.message;}
    if(reason!=='local_control_required')throw new TypeError('native_stop_not_local');
    return {session,ticket:null,context,localControl:{status:'completed',kind:'end',discardRequested:true,modelCalls:0},sample};
  }
  const ticket=beginClarityRequest(session);ticket.requestId=`nv3_${runId}_${slotId}`;
  session.pending=structuredClone(ticket);
  return {session,ticket,context:structuredClone(ticket.context),sample};
}
