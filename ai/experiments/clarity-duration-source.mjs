// Isolated surface-form check, not a quantity reasoner or a fact validator.
// Host chooses the personal-reflection purpose before any model call.
import {checkClarityContext} from '../../public/clarity-contract.mjs';

export const DURATION_SOURCE_VERSION='clarity-duration-source-1';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const COVERAGE=Object.freeze({coverage:'duration_surface_forms_only',semanticTruth:'unverified',attribution:'unverified'});
const NUMERALS='0-9０-９〇零一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟点半几数½¼¾';
const WIDE_NUMBER=`(?:[负+＋－−﹣-]\\s*)?[${NUMERALS}.．][${NUMERALS}个来余多eE_\\s.．,，、/／:：~～〜—–−+＋至到-]*`;
const WIDE_UNIT='(?:毫秒|小时|分钟|钟头|时辰|刻钟|秒钟|(?:星期|周)(?![一二三四五六七日天末])|钟|分|秒|天|日|月|年|(?:milliseconds?|seconds?|minutes?|hours?|secs?|mins?|hrs?|ms|[hms])(?![a-z]))';
const WIDE_ATOM=new RegExp(`${WIDE_NUMBER}${WIDE_UNIT}半?`,'giu');
const CHINESE='(?:[一二两三四五六七八九]|十[一二三四五六七八九]?|[二三四五六七八九]十[一二三四五六七八九]?)';
const INTEGER='(?:0|[1-9][0-9]*)';
const NUMBER=`(?:${INTEGER}|${CHINESE})`;
const STRICT_ATOM=new RegExp(`^(?:(?:${NUMBER})(?:个)?小时(?:半)?|(?:${NUMBER})个半小时|半(?:个)?小时|(?:${NUMBER})分钟)$`,'u');
const PREFIX=['不超过','不多于','不少于','不低于','不高于','差不多','整整','最近','大约','大概','大致','约莫','将近','接近','不到','没到','不够','不满','未满','不足','少于','小于','超过','多于','大于','至少','最少','至多','最多','不止','近','约'];
const SUFFIX=['左右','上下','以上','以下','以内','以外','有余','出头','多','余','许','整'];
// Bare 约/多/余 also occur as verbs or ordinary words (约好、多走、业余).
// Only explicit multi-character bounds are unambiguous away from an atom.
const MODIFIER=new RegExp([...PREFIX,...SUFFIX].filter(word=>word.length>1).sort((a,b)=>b.length-a.length).join('|')+'|约\\s*(?=花|用|耗|需|等|持续|历时|走|为|是)','gu');
const NEGATION=/(?:不是|并非|没有|不曾|未曾|没用|没花|没等|没走|未用|未花|未到|不对|不准确|不需要|不用|不必|没$)/u;
const SEPARATOR=/[。！？!?；;，,\n]/u;
const NUMBER_CHAR=new RegExp(`[${NUMERALS}]`,'u');
const ENGLISH_ALIAS=/\b(?:half|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:an?|and\s+a\s+half)\s+)?(?:hours?|minutes?|seconds?)\b/giu;
const ENGLISH_UNIT=/\b(?:milliseconds?|seconds?|minutes?|hours?|secs?|mins?|hrs?|ms|[hms])\b/giu;
const qualifiers=Object.freeze({prefixes:[...PREFIX],suffixes:[...SUFFIX]});
const issue=(reason,start,end,text)=>({reason,start,end,text});

function quoteSpans(text){
  const pairs=new Map([['“','”'],['「','」'],['『','』'],['‘','’'],['"','"'],["'","'"]]);
  const stack=[],spans=[];
  for(let i=0;i<text.length;i++){
    const char=text[i],top=stack.at(-1);
    if(top&&char===top.close){spans.push({start:top.start,end:i+1});stack.pop();}
    else if(pairs.has(char))stack.push({start:i,close:pairs.get(char)});
  }
  spans.push(...stack.map(v=>({start:v.start,end:text.length})));return spans;
}
function clauseFor(text,start,end){
  let left=start,right=end;while(left>0&&!SEPARATOR.test(text[left-1]))left--;
  while(right<text.length&&!SEPARATOR.test(text[right]))right++;return {start:left,end:right};
}
function scan(text,{source=false}={}){
  const forms=[],issues=[];
  for(const match of text.matchAll(WIDE_ATOM)){
    const raw=match[0];let start=match.index,end=start+raw.length;
    const prefix=PREFIX.find(word=>text.slice(0,start).endsWith(word));if(prefix)start-=prefix.length;
    const suffix=SUFFIX.find(word=>text.startsWith(word,end));if(suffix)end+=suffix.length;
    const form={start,end,text:text.slice(start,end)};forms.push(form);
    // Whitespace does not make a known adjacent qualifier disappear. This
    // narrow grammar refuses the separated form instead of guessing its scope.
    if(PREFIX.some(word=>new RegExp(`${word}\\s+$`,'u').test(text.slice(0,start)))||
      SUFFIX.some(word=>new RegExp(`^\\s+${word}`,'u').test(text.slice(end))))
      issues.push(issue('spaced_duration_qualifier_unsupported',start,end,form.text));
    const adjacentBefore=text[start-1]??'',adjacentAfter=text[end]??'';
    if(!STRICT_ATOM.test(raw)||/[a-z0-9第]/iu.test(adjacentBefore)||/[a-z0-9钟]/iu.test(adjacentAfter)||NUMBER_CHAR.test(adjacentAfter))
      issues.push(issue('unsupported_duration_form',start,end,form.text));
  }
  for(const match of text.matchAll(ENGLISH_ALIAS))issues.push(issue('unsupported_duration_alias',match.index,match.index+match[0].length,match[0]));
  for(const match of text.matchAll(ENGLISH_UNIT))if(!forms.some(form=>match.index>=form.start&&match.index+match[0].length<=form.end))
    issues.push(issue('unsupported_unparsed_english_duration',match.index,match.index+match[0].length,match[0]));
  // Adjacent atoms form a compound duration, outside this check's grammar.
  for(let i=1;i<forms.length;i++){
    const between=text.slice(forms[i-1].end,forms[i].start);
    if(!between||/^\s*(?:到|至|[-—–~～〜/／])\s*$/u.test(between))
      issues.push(issue(!between?'unsupported_compound_duration':'unsupported_duration_range',forms[i-1].start,forms[i].end,text.slice(forms[i-1].start,forms[i].end)));
  }
  const clauses=new Map();
  for(const form of forms){const clause=clauseFor(text,form.start,form.end);clauses.set(`${clause.start}:${clause.end}`,clause);}
  for(const clause of clauses.values()){
    const withoutForms=text.slice(clause.start,clause.end).split('').map((char,i)=>forms.some(f=>clause.start+i>=f.start&&clause.start+i<f.end)?' ':char).join('');
    for(const match of withoutForms.matchAll(MODIFIER))issues.push(issue('non_adjacent_duration_qualifier',clause.start+match.index,clause.start+match.index+match[0].length,match[0]));
    if(source&&NEGATION.test(withoutForms))issues.push(issue('negated_duration_source',clause.start,clause.end,text.slice(clause.start,clause.end)));
  }
  if(source){for(const quote of quoteSpans(text))if(forms.some(form=>form.start<quote.end&&form.end>quote.start))
    issues.push(issue('quoted_duration_source',quote.start,quote.end,text.slice(quote.start,quote.end)));}
  return {forms,issues};
}

function candidateTexts(candidate){
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return null;
  const fields=[];
  for(const name of ['goal','title','reply']){
    if(!Object.hasOwn(candidate,name)){if(name==='goal')continue;return null;}
    if(typeof candidate[name]!=='string')return null;fields.push({field:name,text:candidate[name]});
  }
  if(Object.hasOwn(candidate,'question')&&candidate.question!==null){
    if(!candidate.question||typeof candidate.question!=='object'||typeof candidate.question.text!=='string')return null;
    fields.push({field:'question.text',text:candidate.question.text});
  }
  if(!Array.isArray(candidate.claims))return null;
  for(const [index,claim] of candidate.claims.entries()){
    if(!claim||typeof claim!=='object'||typeof claim.text!=='string')return null;
    fields.push({field:`claims[${index}].text`,text:claim.text});
  }
  return fields;
}

export function prepareDurationSourceCheck(context,{purpose}={}){
  const captured=freeze(checkClarityContext(structuredClone(context)));
  const sourceForms=[],issues=[],skippedRequestIds=[];
  if(purpose!=='personal_reflection')issues.push({reason:'unsupported_duration_purpose'});
  for(const source of captured.statements){
    if(source.kind==='request'){skippedRequestIds.push(source.id);continue;}
    const scanned=scan(source.text,{source:true});
    sourceForms.push(...scanned.forms.map(form=>({sourceId:source.id,...form})));
    issues.push(...scanned.issues.map(value=>({sourceId:source.id,...value})));
    // A correction with quantity text may revise earlier values. This version
    // never chooses the current value, retires an old value, or resolves scope.
    if(source.kind==='correction'&&NUMBER_CHAR.test(source.text))issues.push({sourceId:source.id,reason:'quantity_correction_unsupported'});
  }
  const trace=freeze({version:DURATION_SOURCE_VERSION,purpose,status:issues.length?'unsupported':'ready',...COVERAGE,sourceForms,skippedRequestIds,issues,
    supportedGrammar:{asciiIntegers:'0 or nonzero-leading positive integers',chineseIntegers:'1..99; 二/两 remain distinct',units:['小时','分钟'],
      hourForms:['N小时','N个小时','N小时半','N个小时半','N个半小时','半小时','半个小时'],qualifiers},
    limitations:['No conversion, arithmetic, current-value resolution, event ownership or sum verification.',
      'No general counts or times-of-day validation. Unsupported forms and ambiguous qualifier/correction/quote scopes fail closed.',
      'The recognizer covers its declared unit spellings, not every language or grammar for expressing duration.']});
  const binding=freeze({version:DURATION_SOURCE_VERSION,purpose,sessionId:captured.sessionId,revision:captured.revision,
    sourceSignature:JSON.stringify(captured.statements.map(({id,kind,text})=>({id,kind,text})))});
  return Object.freeze({binding,trace,check(candidate){
    if(trace.status!=='ready')return freeze({ok:false,status:'unsupported',reason:'unsupported_duration_context',...COVERAGE,sourceForms:trace.sourceForms,issues:trace.issues,outputForms:[]});
    const fields=candidateTexts(candidate);
    if(!fields)return freeze({ok:false,status:'unsupported',reason:'unsupported_candidate_text_shape',...COVERAGE,sourceForms:trace.sourceForms,issues:[],outputForms:[]});
    const outputForms=[],outputIssues=[];
    for(const {field,text} of fields){
      const scanned=scan(text);outputIssues.push(...scanned.issues.map(value=>({field,...value})));
      outputForms.push(...scanned.forms.map(form=>({field,...form,matchingSourceSpans:sourceForms.filter(source=>source.text===form.text)})));
    }
    if(outputIssues.length)return freeze({ok:false,status:'unsupported',reason:'unsupported_duration_output',...COVERAGE,sourceForms:trace.sourceForms,issues:outputIssues,outputForms});
    const added=outputForms.filter(form=>form.matchingSourceSpans.length===0);
    return freeze({ok:added.length===0,status:added.length?'rejected':'passed',reason:added.length?'new_duration_surface_form':null,...COVERAGE,
      sourceForms:trace.sourceForms,issues:added.map(({field,start,end,text})=>({field,start,end,text,reason:'new_duration_surface_form'})),outputForms});
  }});
}
