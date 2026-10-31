// Isolated dialogue policy. Prompt constraints do not certify semantic truth.
// Keep v5 request/validator behavior available for historical replay.
import {checkClarityContext,CLARITY_SCHEMA_VERSION} from '../../public/clarity-contract.mjs';
import {clarityTurn} from '../clarity-turn.mjs';
import {runCandidate} from '../runtime.mjs';
import {prepareSourceCheckedReflectRun,prepareSourceCheckedReviewRun,
  SOURCE_CHECKED_REFLECT_POLICY,SOURCE_CHECKED_REVIEW_POLICY} from './clarity-source-checked.mjs';

export const FAITHFUL_DIALOGUE_REFLECT_POLICY='clarity-faithful-dialogue-reflect-1';
export const FAITHFUL_DIALOGUE_REVIEW_POLICY='clarity-faithful-dialogue-review-1';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const equal=(a,b)=>JSON.stringify(a)===b;
function between(text,start,end,replacement){
  if(text.split(start).length!==2||text.split(end).length!==2||text.indexOf(start)>=text.indexOf(end))throw new TypeError('faithful_dialogue_template_changed');
  return text.slice(0,text.indexOf(start))+replacement+text.slice(text.indexOf(end));
}
const shared=`总结保持原意的范围、程度、对象和条件；已说A、介意B可以同时成立，不自动推出不介意A、只介意B或B是唯一原因。没有明确排除就不替本人排除；明确的否定、愿意和决定也不弱化。所有文字含goal/title/问题都遵守；标题用具体事项命名，压缩时保留决定含义的对象与限定，难以简写就只留事项，不把影响强化为另一结果或评价。`;
const howToRespond=`【如何接话】
reply用一两句自然陈述承接本轮具体投入、影响或顾虑，简单开场可以更短，不凑字数。准确并列两份顾虑也有价值；仅当现有材料支持一个有用区分时才指出，不要求每轮再造洞察。不能用泛泛夸赞、安慰、性格评价、心理成因或第三方动机来填空；温柔来自听准本人说的细节。
${shared}
只在question提问，一次补一个尚缺的信息。先看本人已说了什么，再找回答确实会改变整理的未知，不重复确认已明确的目的。choice从个人标准及尚未知的实际安排、限制或经历找缺口，答案可支持、反驳或与当前猜测无关；不预设某因素有利于本人已说的标准、不只寻找支持某选项的正例，不邀请证明模型的解释。不替本人预置两个驱动力或期待，也不从选项名称补出好处与影响。
知识/兴趣题先简短回答明确问的内容；已说想了解什么就不再问是否想了解它。需要继续时，从未提供的具体好奇或接触展开，不假定本人已有相关经历，不另塞准备/改善任务。不了解的事实如实说不确定，不把模型知识归为用户经历。
新问题与已知材料自然相接，reply不重复问句。若Host已要求停止/收尾，question=null，不再追加问题。用户可答没有、不知道或停在这里。

`;
const closing=`【忠实承接的收尾】
${shared}
本轮只整理，不再提问；具体承接已说的经历、投入、影响和两难，不新增心理成因，不替本人选择。时长沿用源原形和限定，不换算加总。新的认识只能说明已有材料支持的关系，不能靠排除另一份顾虑显得更清楚。
`;

// Only the declared, version-bound instruction section changes. No optional
// caller text/template override and no mutation of the v5 request objects.
export function faithfulDialogueInstructions(text,{review,finishing,purpose,basePolicyVersion}){
  if(basePolicyVersion!==(review?SOURCE_CHECKED_REVIEW_POLICY:SOURCE_CHECKED_REFLECT_POLICY)||
    typeof review!=='boolean'||typeof finishing!=='boolean'||!['personal_reflection','knowledge_opener'].includes(purpose))throw new TypeError('unsupported_faithful_dialogue_base');
  if(review&&(!finishing||purpose!=='personal_reflection'))throw new TypeError('unsupported_faithful_dialogue_scope');
  let updated=text;
  if(!review){
    updated=between(updated,'【如何接话】','【材料边界】',howToRespond);
    // Remove the obsolete appended continuation rules, which duplicated and
    // competed with the main section. Preserve the separate duration rules.
    const oldTail=finishing?'【有依据的收尾】':'【具体承接与开放追问】';
    if(updated.split(oldTail).length!==2)throw new TypeError('faithful_dialogue_template_changed');
    if(purpose==='personal_reflection')updated=between(updated,oldTail,'【本次应用检查的有限范围】',finishing?closing:'');
    else updated=updated.slice(0,updated.indexOf(oldTail));
  }else updated=between(updated,'【有依据的收尾】','【本次应用检查的有限范围】',closing);
  return updated;
}

async function prepare(context,profile,options={},review=false){
  // Capture both before the inherited asynchronous source snapshot preparation.
  const c=freeze(checkClarityContext(structuredClone(context))),p=freeze(structuredClone(profile));
  const purpose=options.purpose??'personal_reflection';
  const base=await(review?prepareSourceCheckedReviewRun:prepareSourceCheckedReflectRun)(c,p,{purpose});
  const contextBinding=JSON.stringify(c),profileBinding=JSON.stringify(p);
  const policyVersion=review?FAITHFUL_DIALOGUE_REVIEW_POLICY:FAITHFUL_DIALOGUE_REFLECT_POLICY;
  const requestData=freeze({...base.requestData,policyVersion,instruction:{...base.requestData.instruction,
    text:faithfulDialogueInstructions(base.requestData.instruction.text,{review,finishing:review||clarityTurn(c).finish,purpose,
      basePolicyVersion:base.requestData.policyVersion})}});
  const matches=current=>{try{return equal(checkClarityContext(structuredClone(current)),contextBinding);}catch{return false;}};
  const validate=(value,current)=>matches(current)?base.validateCandidate(value,current):{ok:false,reason:'stale_faithful_dialogue_context'};
  const contract=Object.freeze({buildModelRequest(current,activeProfile){
    if(!matches(current)||!equal(activeProfile,profileBinding))throw new TypeError('faithful_dialogue_binding_changed');return requestData;
  },validateCandidate:validate});
  return Object.freeze({requestData,durationTrace:base.durationTrace,checkDuration:base.checkDuration,validateCandidate:validate,
    ...(review?{ledger:base.ledger,checkVisibleMaterial:base.checkVisibleMaterial,validateSelection:validate}:{}),
    binding:freeze({...base.binding,policyVersion}),
    async run({adapter,signal,isCurrent,timeoutMs,onValidationFailure}={}){
      const result=await runCandidate({context:c,contract,adapter,signal,isCurrent,timeoutMs,onValidationFailure});
      return result.status==='candidate'?{...result,schemaVersion:CLARITY_SCHEMA_VERSION}:result;
    }});
}
export const prepareFaithfulDialogueReflectRun=(context,profile,options)=>prepare(context,profile,options,false);
export const prepareFaithfulDialogueReviewRun=(context,profile,options)=>prepare(context,profile,options,true);
