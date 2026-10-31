// Isolated prompt-only reflect experiment. The original seven-field wire,
// validator and Host-owned concern question normalization remain unchanged.
import {checkClarityContext,CLARITY_SCHEMA_VERSION} from '../../public/clarity-contract.mjs';
import {buildClarityModelRequest,clarityInstructions,clarityTurnFocus,validateClarityResponse,CLARITY_POLICY_VERSION} from '../clarity.mjs';
import {clarityTurn} from '../clarity-turn.mjs';
import {runCandidate} from '../runtime.mjs';

export const GUIDED_REFLECT_POLICY='clarity-guided-reflect-1';
const EXPECTED_BASE_POLICY='clarity-warm-19';
const encoder=new TextEncoder();
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const fingerprint=c=>JSON.stringify([c.sessionId,c.revision,c.stage,c.allowNextStep,c.modeId,c.goal,
  c.statements.map(s=>[s.id,s.kind,s.text]),c.dialogue.map(d=>[d.question,d.answerId]),
  c.claims.map(v=>[v.id,v.type,v.text,v.evidenceIds,v.derivation,v.status])]);

// Pure fail-closed template check, useful for testing future base migrations.
// The actual preparer has no caller-supplied base/template override.
export function replaceGuidedReflectFocus(instructions,oldFocus,newFocus,basePolicyVersion){
  if(basePolicyVersion!==EXPECTED_BASE_POLICY)throw new TypeError('unsupported_guided_reflect_base');
  if(typeof instructions!=='string'||typeof oldFocus!=='string'||!oldFocus||typeof newFocus!=='string'||!newFocus||
    instructions.split(oldFocus).length!==2)throw new TypeError('guided_reflect_template_changed');
  const marker=`【本轮工作】\n${oldFocus}\n先核对最新原话`;
  if(!instructions.includes(marker))throw new TypeError('guided_reflect_template_changed');
  return instructions.replace(oldFocus,newFocus);
}

function guidedFocus(context){
  const plan=clarityTurn(context);
  const finish=plan.finish
    ? '本轮既有Host计划已要求收尾：finish=true，question=null。仅整理已经表达的材料，不能因下列场景判断追加一问，也不声称材料不足时已经想清楚。'
    : `若选择concern，本轮只补充${({event:'最近一次的具体经过',interpretation:'真正介意的部分',need:'具体期待'})[plan.target]}；question.text原样使用“${plan.question}”，target=${plan.target}，finish=false。这是已有Host缺口，不把候选场景当事实。`;
  return `先看本人当前想做什么，再选择场景；旧modeId和auto都不锁定答案，不要求本人先选模式。按以下顺序判断：
1. 先尊重停止、只留原话、不分析或不想继续回答的交流意愿，直接保留已有表达，不追加分析、建议或必答问题。
2. 正在比较真实可选方案、标准与取舍，或尚未决定选哪一种时，使用choice，问一个会影响取舍的缺口；不能因为有经历或顾虑就忽略明确的选择任务。
3. 已有本人具体经历，且实际影响、对这件事尚未证实的猜测、边界或期待还需要厘清时，使用concern。没有“烦、难过”等情绪词也可以需要梳理；不从沉默、额外安排或影响自动证明别人的动机，也不补本人未表达的感受与心理需要。
4. 本人只想留住开心、舒服或有意义的片刻，没有待厘清的冲突、猜测或取舍时，使用moment，忠实留下细节，不强造困扰。
5. 只有知识题、人物名称或兴趣话题，尚没有本人的待梳理经历/影响/选择时，使用moment简短承接，finish=false、claims=[]；不了解就诚实说不确定，用target=unknown问一个本人想聊的方面。不要从单个题名推测其在试探、介意或需要被理解，也不把模型知识写成用户经历。
模糊时只补一个贴合原话的问题，不把所有中性表达都归为知识闲聊，也不把所有个人经历都归为困扰。
${finish}
以上先尊重停止意愿，且不改变既有Host收尾约束。reply具体承接当前已知投入、影响或纠正，不能预用尚未获得的回答；开心片刻和选择也保持各自目的。`;
}

const questionEvidence=`【所有场景的问题来源】
只要question不是null，question.evidenceIds就必须是非空、去重的数组，只引用本次statements中真实存在且与问题相关的ID；moment、choice、concern全部遵守，target=unknown也不能填[]。知识或兴趣开场的问题依据是本人刚才提出的话题原句，不是模型知识、历史问题或旧claims。question=null时不另造来源字段；不要发明ID、从别处补ID或要求应用替你修字段。`;

export async function prepareGuidedReflectRun(context,profile){
  // Capture before SHA yields: the caller cannot mix source/model versions.
  const c=freeze(checkClarityContext(structuredClone(context))),p=freeze(structuredClone(profile));
  if(c.stage!=='reflect'||c.allowNextStep)throw new TypeError('unsupported_guided_reflect_scope');
  if(CLARITY_POLICY_VERSION!==EXPECTED_BASE_POLICY)throw new TypeError('unsupported_guided_reflect_base');
  const base=buildClarityModelRequest(c,p),baseInstructions=clarityInstructions(c),oldFocus=clarityTurnFocus(c);
  if(base.policyVersion!==EXPECTED_BASE_POLICY||base.instruction.text!==baseInstructions)throw new TypeError('guided_reflect_template_changed');
  const text=replaceGuidedReflectFocus(baseInstructions,oldFocus,guidedFocus(c),CLARITY_POLICY_VERSION)+`\n\n${questionEvidence}`;
  const requestData=freeze({...base,policyVersion:GUIDED_REFLECT_POLICY,instruction:{...base.instruction,text}});
  const contextBinding=fingerprint(c),profileBinding=JSON.stringify(p);
  const snapshotId=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(contextBinding))),v=>v.toString(16).padStart(2,'0')).join('');
  const matches=current=>{try{return fingerprint(checkClarityContext(structuredClone(current)))===contextBinding;}catch{return false;}};
  const contract=Object.freeze({buildModelRequest(current,activeProfile){
    if(!matches(current)||JSON.stringify(activeProfile)!==profileBinding)throw new TypeError('guided_reflect_binding_changed');
    return requestData;
  },validateCandidate(value,current){
    if(!matches(current))return {ok:false,reason:'stale_guided_reflect_context'};
    return validateClarityResponse(value,current);
  }});
  return Object.freeze({requestData,binding:freeze({snapshotId,schemaVersion:CLARITY_SCHEMA_VERSION,sessionId:c.sessionId,
    revision:c.revision,providerId:p.providerId,modelId:p.modelId}),async run({adapter,signal,isCurrent,timeoutMs,onValidationFailure}={}){
      return runCandidate({context:c,contract,adapter,signal,isCurrent,timeoutMs,onValidationFailure});
    }});
}
