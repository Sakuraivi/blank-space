import test from 'node:test';
import assert from 'node:assert/strict';
import {validateV3EmotionCorrection} from './clarity-v3-correction.mjs';

const ctx=(texts=['我很委屈。','不是委屈，是生气。'])=>({statements:texts.map((text,index)=>({id:`u${index+1}`,kind:'expression',text})),allowNextStep:false});
const claim=(text,evidenceIds=['u2'])=>({type:'feeling',text,evidenceIds,derivation:'stated',supersedes:[]});
const candidate=(text='生气。',extra={})=>({modeId:'concern',goal:'说说这次安排',reply:'你说的是生气。',question:null,claims:[claim(text)],finish:true,title:'这次安排',...extra});
const expectRejected=(value,context=ctx())=>assert.deepEqual(validateV3EmotionCorrection(value,context),{ok:false,reason:'correction_not_applied'});

test('the observed second-person negative/positive feeling passes unchanged with its actual correction source',()=>{
  const context=ctx(['我和邻居轮流照看花箱。','我不是委屈，是生气。']),raw={
    modeId:'moment',goal:'整理对临时浇花安排的不满与想谈的边界',
    reply:'你愿意继续一起照看花箱，气的是临时多出来的两次没先问过你，还占了你没补上的日语时间；你也还没和邻居谈过这个安排。',question:null,
    claims:[{type:'event',text:'我和邻居轮流照看花箱。',evidenceIds:['u1'],derivation:'stated',supersedes:[]},claim('你不是委屈，主要是生气。')],
    finish:true,title:'临时浇花安排与想提出的边界'};
  const original=structuredClone(raw),before=structuredClone(context),result=validateV3EmotionCorrection(raw,context);
  assert.equal(result.ok,true);assert.deepEqual(result.candidate,original);assert.equal(JSON.stringify(result.candidate),JSON.stringify(raw));
  assert.notEqual(result.candidate,raw);assert.notEqual(result.candidate.claims,raw.claims);assert.deepEqual(raw,original);assert.deepEqual(context,before);
});
test('finite I/you contrasts with 是 or 主要是 are recognized, without normalizing any output field',()=>{
  for(const subject of ['','我','你'])for(const positive of ['是','主要是','我是','我主要是','你是','你主要是']){
    const text=`${subject}不是委屈，${positive}生气。`,value=candidate(text,{reply:text,goal:text,title:text});
    const result=validateV3EmotionCorrection(value,ctx());assert.equal(result.ok,true,text);assert.deepEqual(result.candidate,value);
  }
  const c=ctx(['我很失落。','不是失落，是生气。我希望下次能提前说。']);
  const value=candidate('我不是失落，是生气。我希望下次能提前说。');assert.deepEqual(validateV3EmotionCorrection(value,c).candidate,value);
});
test('an actual reaffirmation of a denied emotion is still rejected across all original guarded fields',()=>{
  for(const text of ['我其实还是很委屈。','你现在还是委屈。','委屈。','我感到委屈。']){
    expectRejected(candidate(text));
    for(const field of ['reply','goal','title'])expectRejected(candidate('生气。',{[field]:text}));
  }
});
test('a valid contrast cannot hide another denied-emotion assertion later in the same sentence or after a quote',()=>{
  for(const text of [
    '你不是委屈，主要是生气，但你还是委屈。',
    '你不是委屈，是生气，可是我很委屈。',
    '我不是委屈，是生气。我还是委屈。',
    '你不是委屈，是生气；不过你又委屈。',
    '你不是委屈，是生气，但你也有点委屈。',
    '她说“先等等。”你很委屈。',
  ])expectRejected(candidate(text));
});
test('a claim contrast requires the matching actual correction source, never merely some valid source',()=>{
  const value=candidate('你不是委屈，主要是生气。');value.claims[0].evidenceIds=['u1'];expectRejected(value);
  const c=ctx(['我很委屈。','不是委屈，是生气。','不是难过，是焦虑。']);
  value.claims[0].evidenceIds=['u3'];expectRejected(value,c);
  value.claims[0].evidenceIds=['u1','u2'];assert.equal(validateV3EmotionCorrection(value,c).ok,true);
  expectRejected(candidate('你不是委屈，是轻松。'));
});
test('quoted or third-party source statements cannot reverse a real own-emotion correction',()=>{
  for(const invalid of ['她说“不是生气，是委屈。”','她不是生气，是委屈。','“不是生气，是委屈。”']){
    const c=ctx(['我很委屈。','不是委屈，是生气。',invalid]),value=candidate('我很委屈。');value.claims[0].evidenceIds=['u3'];expectRejected(value,c);
  }
  // No recognized own correction means this guard is not applicable. It does
  // not manufacture an emotion denial from somebody else's words.
  for(const text of ['她说“不是委屈，是生气。”','她不是委屈，是生气。']){
    const c=ctx([text]),value=candidate('我很委屈。');value.claims[0].evidenceIds=['u1'];
    assert.deepEqual(validateV3EmotionCorrection(value,c).candidate,value);
  }
});
test('balanced nested output quotations stay untouched; a real own reference following them is still checked',()=>{
  const quoted='她说“老师说“先等等。”我很委屈。”',value=candidate(quoted,{reply:quoted});
  assert.deepEqual(validateV3EmotionCorrection(value,ctx()).candidate,value);
  expectRejected(candidate('她说“老师说“先等等。””我很委屈。'));
  expectRejected(candidate('她说“我很委屈。'));
});
test('newer own corrections update the denied set; an old positive half cannot be hidden inside a contrast',()=>{
  const c=ctx(['我很委屈。','不是委屈，是生气。','不是生气，是委屈。']);
  assert.equal(validateV3EmotionCorrection(candidate('我很委屈。'),c).ok,true);
  const value=candidate('我不是委屈，是生气。');value.claims[0].evidenceIds=['u2'];expectRejected(value,c);
  value.claims[0]=claim('你不是生气，主要是委屈。',['u3']);value.reply='你说的是委屈。';assert.equal(validateV3EmotionCorrection(value,c).ok,true);
});
test('the finite vocabulary and unsupported negation stay explicit rather than pretending to be a general classifier',()=>{
  const unknown=ctx(['我很沮丧。','不是沮丧，是释然。']),value=candidate('我很沮丧。');
  assert.deepEqual(validateV3EmotionCorrection(value,unknown).candidate,value);
  const exact=ctx(['我很烦。','不是烦，是生气。']);
  assert.equal(validateV3EmotionCorrection(candidate('我很烦躁。'),exact).ok,true);expectRejected(candidate('我很烦。'),exact);
  // These plausible negations lie outside the intentionally finite exemption.
  // A failure preserves the text; it is not proof the emotion was affirmed.
  for(const text of ['你并非委屈，而是生气。','你不是委屈。'])expectRejected(candidate(text));
});
test('every supported source emotion keeps the old affirmative-denial guard and exact authorized contrast',()=>{
  for(const word of ['失落','生气','愤怒','难过','委屈','焦虑','害怕','担心','开心','轻松','烦躁','烦','紧张','内疚','羞愧','疲惫']){
    const positive=word==='生气'?'轻松':'生气',context=ctx([`我很${word}。`,`不是${word}，是${positive}。`]);
    const affirmed=candidate(`我很${word}。`,{reply:`你说的是${positive}。`});expectRejected(affirmed,context);
    const allowed=candidate(`你不是${word}，主要是${positive}。`,{reply:`你说的是${positive}。`});
    assert.equal(validateV3EmotionCorrection(allowed,context).ok,true,word);
  }
});
