// Isolated example-only treatment. Examples guide generation, not semantic proof.
import {checkClarityContext,CLARITY_SCHEMA_VERSION} from '../../public/clarity-contract.mjs';
import {runCandidate} from '../runtime.mjs';
import {prepareFaithfulDialogueReviewRun,FAITHFUL_DIALOGUE_REVIEW_POLICY} from './clarity-faithful-dialogue.mjs';
import {EXAMPLE_REVIEW_BLOCK,REVIEW_EXAMPLES_VERSION} from './clarity-review-examples.mjs';
export {EXAMPLE_REVIEW_BLOCK} from './clarity-review-examples.mjs';
export const EXAMPLE_REVIEW_POLICY='clarity-example-review-1';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const equal=(value,serialized)=>JSON.stringify(value)===serialized;

export async function prepareExampleReviewRun(context,profile){
  // Bind snapshots before the inherited asynchronous source preparation.
  const c=freeze(checkClarityContext(structuredClone(context))),p=freeze(structuredClone(profile));
  const base=await prepareFaithfulDialogueReviewRun(c,p);
  if(base.requestData.policyVersion!==FAITHFUL_DIALOGUE_REVIEW_POLICY||base.requestData.schemaVersion!=='liubai-material-retention-3'||
    base.requestData.output.format!=='json_text')throw new TypeError('unsupported_example_review_base');
  const contextBinding=JSON.stringify(c),profileBinding=JSON.stringify(p);
  const requestData=freeze({...base.requestData,policyVersion:EXAMPLE_REVIEW_POLICY,
    instruction:{...base.requestData.instruction,text:base.requestData.instruction.text+EXAMPLE_REVIEW_BLOCK}});
  const matches=current=>{try{return equal(checkClarityContext(structuredClone(current)),contextBinding);}catch{return false;}};
  const validate=(value,current)=>matches(current)?base.validateSelection(value,current):{ok:false,reason:'stale_example_review_context'};
  const contract=Object.freeze({buildModelRequest(current,activeProfile){
    if(!matches(current)||!equal(activeProfile,profileBinding))throw new TypeError('example_review_binding_changed');
    return requestData;
  },validateCandidate:validate});
  return Object.freeze({requestData,ledger:base.ledger,durationTrace:base.durationTrace,checkDuration:base.checkDuration,
    checkVisibleMaterial:base.checkVisibleMaterial,validateCandidate:validate,validateSelection:validate,
    binding:freeze({...base.binding,policyVersion:EXAMPLE_REVIEW_POLICY,exampleVersion:REVIEW_EXAMPLES_VERSION}),
    async run({adapter,signal,isCurrent,timeoutMs,onValidationFailure}={}){
      const result=await runCandidate({context:c,contract,adapter,signal,isCurrent,timeoutMs,onValidationFailure});
      return result.status==='candidate'?{...result,schemaVersion:CLARITY_SCHEMA_VERSION}:result;
    }});
}
