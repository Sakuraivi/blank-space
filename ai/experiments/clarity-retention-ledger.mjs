// Derived working-material view only. No database, model classification or
// credential ownership. A question link describes provenance, not meaning.
import {checkClarityContext} from '../../public/clarity-contract.mjs';
import {buildMaterialIndex} from './clarity-materials.mjs';
import {CONCERN_QUESTIONS,expressionParts} from '../clarity-turn.mjs';
import {parseExplicitEmotionCorrection,inspectSourceEmotion} from '../clarity-grounding.mjs';

export const RETENTION_LEDGER_VERSION='liubai-material-retention-1';
const encoder=new TextEncoder();
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digestPattern=/^[a-f0-9]{64}$/u;
const sourceKinds=new Set(['expression','correction','request']);
const issue=(issues,code)=>{if(!issues.includes(code))issues.push(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(value)))),v=>v.toString(16).padStart(2,'0')).join('');

function capturePrevious(value,current){
  if(value===undefined)return null;
  const previous=structuredClone(value);
  if(!plain(previous)||previous.version!==RETENTION_LEDGER_VERSION||previous.sessionId!==current.sessionId||
    !Number.isSafeInteger(previous.revision)||previous.revision<0||previous.revision>current.revision||
    !digestPattern.test(previous.snapshotId??'')||!Array.isArray(previous.sources)||!previous.sources.length||previous.sources.length>12||
    !Array.isArray(previous.units)||previous.units.length>48000||!Array.isArray(previous.questionAssociations)||previous.questionAssociations.length>3)
    throw new TypeError('invalid_retention_previous');
  const ids=new Set(),keys=new Set();
  for(const source of previous.sources){
    if(!plain(source)||typeof source.id!=='string'||!/^u\d+$/u.test(source.id)||ids.has(source.id)||!sourceKinds.has(source.kind)||!digestPattern.test(source.digest??''))throw new TypeError('invalid_retention_previous');
    ids.add(source.id);
  }
  for(const unit of previous.units){
    if(!plain(unit)||typeof unit.key!=='string'||!unit.key||unit.key.length>300||keys.has(unit.key)||!ids.has(unit.sourceId))throw new TypeError('invalid_retention_previous');
    keys.add(unit.key);
  }
  for(const link of previous.questionAssociations){
    if(!plain(link)||!ids.has(link.sourceId)||typeof link.question!=='string'||!link.question.trim()||link.question.length>160||!Number.isSafeInteger(link.turn)||link.turn<1||link.turn>3)throw new TypeError('invalid_retention_previous');
  }
  return freeze(previous);
}

function sourceChanges(previous,sources,associations,revision,issues){
  if(!previous)return {addedSourceIds:sources.map(s=>s.id),removedSourceIds:[],sourceVersionChanges:[]};
  const old=new Map(previous.sources.map(s=>[s.id,s]));
  const current=new Map(sources.map(s=>[s.id,s]));
  const addedSourceIds=sources.filter(s=>!old.has(s.id)).map(s=>s.id);
  const removedSourceIds=previous.sources.filter(s=>!current.has(s.id)).map(s=>s.id);
  const sourceVersionChanges=sources.filter(s=>old.has(s.id)&&s.digest!==old.get(s.id).digest)
    .map(s=>({sourceId:s.id,previousDigest:old.get(s.id).digest,currentDigest:s.digest}));
  const sameOrder=equal(previous.sources.map(s=>s.id),sources.slice(0,previous.sources.length).map(s=>s.id));
  const associationsChanged=!equal(previous.questionAssociations,associations);
  if(previous.revision===revision&&(addedSourceIds.length||removedSourceIds.length||sourceVersionChanges.length||!sameOrder||associationsChanged))throw new TypeError('retention_revision_reused');
  if(sourceVersionChanges.length)issue(issues,'source_edit_requires_review');
  if(removedSourceIds.length)issue(issues,'source_removal_requires_review');
  if(!sameOrder)issue(issues,'source_order_requires_review');
  return {addedSourceIds,removedSourceIds,sourceVersionChanges};
}

export async function buildRetentionLedger(context,{previous}={}){
  // Capture both inputs before the first SHA await. Later caller edits cannot
  // splice a second version into this snapshot or its change observations.
  const c=freeze(checkClarityContext(structuredClone(context))),prior=capturePrevious(previous,c);
  const [index,sources]=await Promise.all([
    buildMaterialIndex(c),
    Promise.all(c.statements.map(async source=>({id:source.id,kind:source.kind,digest:await hash([source.id,source.kind,source.text])}))),
  ]);
  const issues=[],bySource=new Map(sources.map(s=>[s.id,s])),questionAssociations=index.answers.map(link=>({...link}));
  if(!prior&&c.revision!==c.statements.length)issue(issues,'missing_revision_history');
  const changes=sourceChanges(prior,sources,questionAssociations,c.revision,issues);
  if(c.statements.some(s=>s.kind!=='request'&&expressionParts(s.text).controls.length))issue(issues,'unsupported_control_scope');
  const units=[];
  for(const anchor of index.anchors){
    const source=bySource.get(anchor.sourceId),links=questionAssociations.filter(link=>link.sourceId===anchor.sourceId).map(link=>({
      question:link.question,turn:link.turn,target:Object.keys(CONCERN_QUESTIONS).find(target=>CONCERN_QUESTIONS[target]===link.question)??null,
    }));
    const unit={id:`r${units.length+1}`,key:`${anchor.sourceId}:${source.digest}:${anchor.start}:${anchor.end}`,anchorId:anchor.id,
      sourceId:anchor.sourceId,kind:anchor.sourceKind,sourceDigest:source.digest,start:anchor.start,end:anchor.end,quote:anchor.quote,
      renderedStart:anchor.start,renderedEnd:anchor.end,text:anchor.quote,status:anchor.selectable?'active':'unresolved',
      reason:anchor.selectable?null:'unsupported_control_scope',retiredBy:null,questionLinks:links,projection:null};
    const fix=parseExplicitEmotionCorrection(anchor.quote);
    if(fix&&anchor.selectable){
      if(fix.from===fix.to||!anchor.quote.endsWith(fix.positiveText)){
        unit.status='unresolved';unit.reason='unsupported_emotion_correction';issue(issues,unit.reason);
      }else{
        unit.text=fix.positiveText;unit.renderedStart=anchor.end-fix.positiveText.length;
        unit.projection={kind:'explicit_emotion_correction',from:fix.from,to:fix.to};
        // Only earlier active units can retire. Never recompute activity from
        // the final denied-word set: A -> B -> A must not revive the first A.
        for(const earlier of units.filter(u=>u.status==='active')){
          const projectedOld=earlier.projection?.to===fix.from;
          const reference=projectedOld?{referencesDenied:true,pureFirstPerson:true}:inspectSourceEmotion(earlier.text,fix.from);
          if(!reference.referencesDenied)continue;
          if(reference.pureFirstPerson){
            earlier.status='retired';earlier.reason='explicit_emotion_correction';
            earlier.retiredBy={sourceId:unit.sourceId,anchorId:unit.anchorId,from:fix.from,to:fix.to};
          }else{
            // A mixed/negative/second-person source is not safe to delete.
            // Keep its full bytes in history and refuse this experiment.
            earlier.status='unresolved';earlier.reason='nonretirable_emotion_reference';issue(issues,earlier.reason);
          }
        }
      }
    }
    if(unit.status==='unresolved')issue(issues,unit.reason);
    units.push(unit);
  }
  for(const source of sources.filter(s=>s.kind==='correction')){
    if(!units.some(unit=>unit.sourceId===source.id&&unit.projection))issue(issues,'unsupported_revision_scope');
  }
  const active=units.filter(unit=>unit.status==='active'),retainedText=active.map(unit=>unit.text).join('\n');
  if(!active.length)issue(issues,'no_active_material');
  if(retainedText.length>240)issue(issues,'retained_material_too_large');
  const oldKeys=new Set(prior?.units.map(u=>u.key)??[]),newKeys=new Set(units.map(u=>u.key));
  Object.assign(changes,{addedKeys:units.filter(u=>!oldKeys.has(u.key)).map(u=>u.key),unchangedKeys:units.filter(u=>oldKeys.has(u.key)).map(u=>u.key),
    removedKeys:(prior?.units??[]).filter(u=>!newKeys.has(u.key)).map(u=>u.key)});
  return freeze({version:RETENTION_LEDGER_VERSION,sessionId:c.sessionId,revision:c.revision,snapshotId:index.snapshotId,
    sources,units,questionAssociations,changes,retainedText,retainedEvidenceIds:[...new Set(active.map(u=>u.sourceId))],
    activeAnchorIds:active.map(u=>u.anchorId),retainedLength:retainedText.length,reportReady:issues.length===0,issues,
    semanticCoverage:'unverified',associationMeaning:'literal_question_answer_provenance_only',
    activityMeaning:'retained_literal_source_not_proof_of_current_intent',
    correctionScope:'explicit_first_person_pure_feeling_only',historyAuthority:'current_context_only_not_model_claims'});
}
