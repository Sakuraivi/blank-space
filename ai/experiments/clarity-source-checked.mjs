// Isolated Host-scoped duration provenance guard. Surface-form provenance is
// not factual, attribution or psychological verification.
import {checkClarityContext,CLARITY_SCHEMA_VERSION} from '../../public/clarity-contract.mjs';
import {validateClarityResponse} from '../clarity.mjs';
import {clarityTurn} from '../clarity-turn.mjs';
import {runCandidate} from '../runtime.mjs';
import {prepareGuidedReflectRun} from './clarity-guided-reflect.mjs';
import {prepareFaithfulRetainedConcernRun} from './clarity-retained-concern.mjs';
import {prepareDurationSourceCheck} from './clarity-duration-source.mjs';

export const SOURCE_CHECKED_REFLECT_POLICY='clarity-source-checked-reflect-2';
export const SOURCE_CHECKED_REVIEW_POLICY='clarity-source-checked-review-2';
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const purposes=['personal_reflection','knowledge_opener'];
const unchanged=(a,b)=>JSON.stringify(a)===b;
function compactReflectContract(text,c){
  const start='【输出契约】',end='【所有场景的问题来源】';
  if(text.split(start).length!==2||text.split(end).length!==2||text.indexOf(start)>=text.indexOf(end))throw new TypeError('source_checked_template_changed');
  const contract=`【输出契约】
只输出七字段JSON：{"modeId":"concern","goal":"本次目标","reply":"陈述","question":{"text":"一个问题？","target":"event","evidenceIds":["u1"]},"claims":[],"finish":false,"title":"标题"}。
modeId仅moment/concern/choice。goal<=80、reply<=300、title<=60字符且非空。question=null或恰好text/target/evidenceIds；target仅event/interpretation/need/tradeoff/unknown/correction，text<=160，来源真实非空去重。finish=true必须question=null且有1–3条claim；否则必须有一个不重复历史的问题。
claims至多3条，每条仅type/text/evidenceIds/derivation/supersedes；text非空<=240，总text<=480。type仅event/thought/feeling/need/option/tradeoff/unknown/insight/action；本轮不允许action。derivation仅stated/inferred。evidenceIds仅statements真实ID，非空去重；supersedes只用历史claims的id，数组无重复且跨条不重复，不用u开头材料ID或自编ID，无替换填[]。禁止输出id/status/label等额外字段。未收尾通常0–1条新增线索，不逐轮重写报告；兴趣claims=[]。unknown用陈述，reply不提问。outputConstraints只列合法ID，不是用户材料。
当前stage=${c.stage}，已答${c.dialogue.length}题；stage=review或已答3题必须finish=true。既有Host收尾/停止优先，其他依本轮工作。缺材料留白，不造洞察。

`;
  return text.slice(0,text.indexOf(start))+contract+text.slice(text.indexOf(end));
}
const groundedRules=`只承接已说出的经历、投入、影响及自述原因；不为反复想、不舒服或犹豫新造心理过程，“可能”不是依据，已明说的原因也不删。时长连同数量、单位和限定逐字沿用，不换算/加总或把每次当总计。无需重复数字也可承接已知影响。`;
const continuationRules=`【具体承接与开放追问】
${groundedRules}
待弄清的内容用一个真实问题补充，不先替本人解释。choice沿用已说的标准，开放地问一个未知经历或限制；不重复问最在意什么，不预置两个驱动力/期待供二选一，不封闭未提到的可能。只在question提问。
`;
const reviewRules=`【有依据的收尾】
${groundedRules}
本轮只整理，不再提问；unknown陈述未决，以已说材料形成区分，不新造心理原因或替本人选择。`;
const durationRules=`【本次应用检查的有限范围】
所有文字含问题都核对时长原形；原话没有的新时长/换算/合计拒绝，换mode或称猜测也不豁免。sourceForms只是源词形，不认证归属、当前值、每次/总计或解释；仍须忠实保留对象、约数、否定与条件。知识是否适用只由Host决定。`;

async function prepare(context,profile,{purpose='personal_reflection'}={},review=false){
  const c=freeze(checkClarityContext(structuredClone(context))),p=freeze(structuredClone(profile));
  if(!purposes.includes(purpose)||c.allowNextStep||review&&purpose!=='personal_reflection')throw new TypeError('unsupported_source_checked_scope');
  if(c.stage!==(review?'review':'reflect'))throw new TypeError('unsupported_source_checked_stage');
  const duration=purpose==='personal_reflection'?prepareDurationSourceCheck(c,{purpose}):null;
  if(duration&&duration.trace.status!=='ready')throw new TypeError('unsupported_duration_source_scope');
  const contextBinding=JSON.stringify(c),profileBinding=JSON.stringify(p);
  const base=await(review?prepareFaithfulRetainedConcernRun:prepareGuidedReflectRun)(c,p);
  const finishing=review||clarityTurn(c).finish;
  const baseInstructions=review?base.requestData.instruction.text:compactReflectContract(base.requestData.instruction.text,c);
  const policyVersion=review?SOURCE_CHECKED_REVIEW_POLICY:SOURCE_CHECKED_REFLECT_POLICY;
  const durationTrace=duration?.trace??freeze({status:'not_applicable',coverage:'not_applicable_host_knowledge_scope',
    semanticTruth:'not_evaluated',attribution:'not_evaluated',sourceForms:[]});
  const input=JSON.parse(base.requestData.input.content);
  input.durationSourcePolicy={purpose,coverage:durationTrace.coverage,sourceForms:durationTrace.sourceForms,
    meaning:'来源词形，不是事实、归属、当前值或推断正确的认证。'};
  const requestData=freeze({...base.requestData,policyVersion,input:{...base.requestData.input,content:JSON.stringify(input)},
    instruction:{...base.requestData.instruction,text:baseInstructions+`\n\n${finishing?reviewRules:continuationRules}`+(duration?`\n\n${durationRules}`:'')}});
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
