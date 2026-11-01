// v3-only finite correction check. It observes candidate text; it never rewrites
// a response, removes a source, or claims to classify all Chinese negation.
import {groundingPlan} from './clarity-grounding.mjs';

// Same finite vocabulary as the existing source correction parser. Longest
// first keeps the distinct known words 烦躁/烦 from becoming a prefix match.
const emotions=['失落','生气','愤怒','难过','委屈','焦虑','害怕','担心','开心','轻松','烦躁','烦','紧张','内疚','羞愧','疲惫'];
const emotionPattern=[...emotions].sort((a,b)=>b.length-a.length).join('|');
const prefix='(?:其实|现在|还是|仍然|又|也|觉得|感到|很|挺|有些|有点|主要|是|不是|并非|并不|的感受是|的情绪是)*';
const connective='(?:(?:但是|不过|可是|但)\\s*)?';
const reference=()=>new RegExp(`(^|[。！？!?；;，,\\n])(\\s*${connective}(?:我|你)?${prefix})(${emotionPattern})`,'gu');
const contrast=new RegExp(`^\\s*${connective}(?:我|你)?不是(${emotionPattern})[，,]\\s*(?:我|你)?(?:主要)?是(${emotionPattern})(?=[。！？!?；;，,\\n]|$)`,'u');

function outsideQuotes(text){
  const pairs={'“':'”','「':'」','『':'』','"':'"'},ends=[],parts=[];
  let part='',unclosed='';
  for(const ch of text){
    if(ends.length){
      unclosed+=ch;
      if(ch===ends.at(-1))ends.pop();else if(pairs[ch])ends.push(pairs[ch]);
      if(!ends.length)unclosed='';
    }else if(pairs[ch]){
      parts.push(part);part='';ends.push(pairs[ch]);unclosed=ch;
    }else part+=ch;
  }
  parts.push(part);return {parts,unclosed};
}

function invalidEmotionReference(text,denied,authorized){
  const {parts,unclosed}=outsideQuotes(text);
  // An unclosed quote cannot silently hide a denied word. This conservative
  // fallback does not assert whether an unfinished quotation was about self.
  if(unclosed&&[...denied].some(word=>unclosed.includes(word)))return true;
  for(const part of parts){
    for(const match of part.matchAll(reference())){
      const word=match[3];if(!denied.has(word))continue;
      const fromBoundary=part.slice(match.index+match[1].length);
      const pair=contrast.exec(fromBoundary);
      // Only this exact finite contrast is exempt. Subsequent clauses are
      // still scanned, so a later affirmative old emotion is never masked.
      if(pair&&pair[1]===word&&!denied.has(pair[2])&&authorized.some(fix=>fix.from===pair[1]&&fix.to===pair[2]))continue;
      return true;
    }
  }
  return false;
}

export function validateV3EmotionCorrection(candidate,context){
  // Caller supplies v3's material-only context, including its finite canonical
  // source-correction plan. The person's stored statements are never changed.
  const {corrections}=groundingPlan(context),denied=new Set();
  for(const fix of corrections){denied.delete(fix.to);denied.add(fix.from);}
  const fail=()=>({ok:false,reason:'correction_not_applied'});
  if(denied.size){
    for(const claim of candidate.claims){
      const authorized=corrections.filter(fix=>claim.evidenceIds.includes(fix.sourceId));
      if(invalidEmotionReference(claim.text,denied,authorized))return fail();
    }
    for(const text of [candidate.reply,candidate.goal,candidate.title])if(invalidEmotionReference(text,denied,corrections))return fail();
  }
  return {ok:true,candidate:structuredClone(candidate)};
}
