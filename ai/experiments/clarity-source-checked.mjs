// Isolated Host-scoped duration provenance guard. Surface-form provenance is
// not factual, attribution or psychological verification.
import {checkClarityContext,CLARITY_SCHEMA_VERSION} from '../../public/clarity-contract.mjs';
import {validateClarityResponse} from '../clarity.mjs';
import {clarityTurn} from '../clarity-turn.mjs';
import {runCandidate} from '../runtime.mjs';
import {prepareGuidedReflectRun} from './clarity-guided-reflect.mjs';
import {prepareFaithfulRetainedConcernRun} from './clarity-retained-concern.mjs';
import {prepareDurationSourceCheck} from './clarity-duration-source.mjs';

export const SOURCE_CHECKED_REFLECT_POLICY='clarity-source-checked-reflect-1';
export const SOURCE_CHECKED_REVIEW_POLICY='clarity-source-checked-review-1';
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const purposes=['personal_reflection','knowledge_opener'];
const unchanged=(a,b)=>JSON.stringify(a)===b;
const groundedRules=`先承接本人已经说出的经过、投入或影响，没有新认识也不硬补心理解释。本人已明确说出的原因可以照实保留，不为反复思考、不舒服或犹豫新造原因；“可能在确认、其实是在保护、更像需要”等新的心理过程没有来源时不要写。加“可能”也不是依据。
时长若有必要重述，逐字沿用原有数量、单位及限定，不换算或加总，不把每次用时变总用时。不要为了展示分析而计算总量或补造数字。无数量也可以具体承接学习时间被占、安排临时改变等已经说出的影响。`;
const continuationRules=`【具体承接与开放追问】
${groundedRules}
把待弄清的内容留给一个真实问题，不让解释先替本人回答。
选择场景先沿用本人已说的标准，不重复问最在意什么；围绕这个标准尚缺的经历或限制开放地问一件事。不把下一问封成你拟出的两个驱动力/期待让本人二选一，不把未提到的因素当作仅有选项。只问一个问题，不在reply另问。
`;
const reviewRules=`【有依据的收尾】
${groundedRules}
本轮只形成整理，不再提问；仍未确认的部分用unknown陈述保留，不为了补问题而改变收尾形状。用本人已说出的材料形成有用区分，不能新造心理原因或替本人作选择。`;
const durationRules=`【本次应用检查的有限范围】
Host将个人复盘中的可识别时长按原形核对，检查所有文字字段，包括问题。不在原话里的新时长、换算或合计会被拒绝；不能换modeId、把它说成猜测或放进问题来绕过。durationSourcePolicy.sourceForms只列来自原话的词形，不认证它属于谁、是否仍成立、是每次还是总共。仍须忠实保留对象、每次/总计、约数、否定和条件；词形能匹配不证明解释正确。知识开场是否适用由Host决定，模型不能自行豁免。`;

async function prepare(context,profile,{purpose='personal_reflection'}={},review=false){
  const c=freeze(checkClarityContext(structuredClone(context))),p=freeze(structuredClone(profile));
  if(!purposes.includes(purpose)||c.allowNextStep||review&&purpose!=='personal_reflection')throw new TypeError('unsupported_source_checked_scope');
  if(c.stage!==(review?'review':'reflect'))throw new TypeError('unsupported_source_checked_stage');
  const duration=purpose==='personal_reflection'?prepareDurationSourceCheck(c,{purpose}):null;
  if(duration&&duration.trace.status!=='ready')throw new TypeError('unsupported_duration_source_scope');
  const contextBinding=JSON.stringify(c),profileBinding=JSON.stringify(p);
  const base=await(review?prepareFaithfulRetainedConcernRun:prepareGuidedReflectRun)(c,p);
  const finishing=review||clarityTurn(c).finish;
  const policyVersion=review?SOURCE_CHECKED_REVIEW_POLICY:SOURCE_CHECKED_REFLECT_POLICY;
  const durationTrace=duration?.trace??freeze({status:'not_applicable',coverage:'not_applicable_host_knowledge_scope',
    semanticTruth:'not_evaluated',attribution:'not_evaluated',sourceForms:[]});
  const input=JSON.parse(base.requestData.input.content);
  input.durationSourcePolicy={purpose,coverage:durationTrace.coverage,sourceForms:durationTrace.sourceForms,
    meaning:'来源词形，不是事实、归属、当前值或推断正确的认证。'};
  const requestData=freeze({...base.requestData,policyVersion,input:{...base.requestData.input,content:JSON.stringify(input)},
    instruction:{...base.requestData.instruction,text:base.requestData.instruction.text+`\n\n${finishing?reviewRules:continuationRules}`+(duration?`\n\n${durationRules}`:'')}});
  const checkDuration=value=>duration?duration.check(value):freeze({ok:true,status:'not_applicable',coverage:'not_applicable_host_knowledge_scope',
    semanticTruth:'not_evaluated',attribution:'not_evaluated',checks:[]});
  const matches=current=>{try{return unchanged(checkClarityContext(structuredClone(current)),contextBinding);}catch{return false;}};
  function validate(value,current){
    if(!matches(current))return {ok:false,reason:'stale_source_checked_context'};
    const rawCheck=checkDuration(value);if(!rawCheck.ok)return {ok:false,reason:'duration_source_mismatch'};
    const checked=review?base.validateSelection(value,current):validateClarityResponse(value,current);
    if(!checked.ok)return checked;
    const compiledCheck=checkDuration(checked.candidate);if(!compiledCheck.ok)return {ok:false,reason:'duration_source_mismatch'};
    return {...checked,durationTrace:freeze({raw:rawCheck,compiled:compiledCheck})};
  }
  const contract=Object.freeze({buildModelRequest(current,activeProfile){
    if(!matches(current)||!unchanged(activeProfile,profileBinding))throw new TypeError('source_checked_binding_changed');return requestData;
  },validateCandidate:validate});
  return Object.freeze({requestData,durationTrace,checkDuration,validateCandidate:validate,...(review?{
    ledger:base.ledger,checkVisibleMaterial:base.checkVisibleMaterial,validateSelection:validate}:{}),
    binding:freeze({...base.binding,policyVersion,purpose,durationBinding:duration?.binding??{coverage:'not_applicable_host_knowledge_scope'}}),
    async run({adapter,signal,isCurrent,timeoutMs,onValidationFailure}={}){
      const result=await runCandidate({context:c,contract,adapter,signal,isCurrent,timeoutMs,onValidationFailure});
      return result.status==='candidate'?{...result,schemaVersion:CLARITY_SCHEMA_VERSION}:result;
    }});
}

export const prepareSourceCheckedReflectRun=(context,profile,options)=>prepare(context,profile,options,false);
export const prepareSourceCheckedReviewRun=(context,profile,options)=>prepare(context,profile,options,true);
