// Fixed, read-only audit targets. No fixture criteria or artifact labels are
// supplied to the model; the preparer receives only each exact input object.
import {checkClarityContext} from '../../public/clarity-contract.mjs';

export const AUDIT_LABEL='liubai-semantic-audit-preview-1';
export const AUDIT_ORIGIN='http://127.0.0.1:4199';
export const AUDIT_TTL_MS=20*60*1000;
export const AUDIT_ROUTE=Object.freeze({sourceMode:'default',providerId:'bailian',modelId:'deepseek-v4-pro-0813',defaultRevision:3});
export const validAuditRunId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,32}$/u.test(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

// Loading the final fresh file is explicit. Importing a CLI/Worker does not
// inspect withheld data before the policy has been frozen and installed.
export async function loadSemanticAuditFixtures(){
  const [known,fresh]=await Promise.all([import('../../ai/fixtures/clarity-semantic-audit-known.mjs'),import('../../ai/fixtures/clarity-semantic-audit-fresh.mjs')]);
  const groups=[known.SEMANTIC_AUDIT_KNOWN_SAMPLES,fresh.SEMANTIC_AUDIT_FRESH_SAMPLES];
  if(!Array.isArray(groups[0])||groups[0].length!==8||!Array.isArray(groups[1])||groups[1].length!==6)throw new TypeError('invalid_audit_fixture_count');
  const samples=groups.flatMap((group,index)=>group.map(sample=>{
    if(!sample||typeof sample.id!=='string'||!/^[a-zA-Z0-9_]{1,56}$/u.test(sample.id)||!exact(sample.input,['context','candidate','task']))throw new TypeError('invalid_audit_fixture');
    const input=structuredClone(sample.input);checkClarityContext(input.context);
    return {id:sample.id,input,expectedFindings:structuredClone(sample.expectedFindings),reviewReasons:structuredClone(sample.reviewReasons),
      ...(sample.origin===undefined?{}:{origin:structuredClone(sample.origin)}),group:index===0?'known':'fresh'};
  }));
  if(new Set(samples.map(sample=>sample.id)).size!==14)throw new TypeError('duplicate_audit_fixture');
  return freeze(samples);
}

export function auditRequestId(runId,caseId){
  if(!validAuditRunId(runId)||typeof caseId!=='string'||!/^[a-zA-Z0-9_]{1,56}$/u.test(caseId))throw new TypeError('invalid_audit_request_identity');
  return `audit1_${runId}_${caseId}`;
}

export function auditApiPayload(sample,runId,{configVersion,consentVersion}){
  const c=checkClarityContext(structuredClone(sample.input.context));
  // Preserve the source context identity. The reviewed candidate/task are
  // bound through the prepared request, not through extra public API fields.
  return {flow:'clarity-v2',...AUDIT_ROUTE,configVersion,consentVersion,requestId:auditRequestId(runId,sample.id),revision:c.revision,
    stage:c.stage,allowNextStep:c.allowNextStep,session:{id:c.sessionId,modeId:c.modeId,goal:c.goal,statements:c.statements,dialogue:c.dialogue,claims:c.claims}};
}
