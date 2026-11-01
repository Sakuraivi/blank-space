import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleApi,PUBLIC_CONFIG_VERSION,CONSENT_VERSION} from './api.mjs';
const origin='https://listening.test',key='synthetic-personal-key-not-a-secret';
const sql=readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort().map(x=>readFileSync(new URL(`../drizzle/${x}`,import.meta.url),'utf8')).join('\n');
const output=(extra={})=>({modeId:'concern',goal:'先聊聊这件事',reply:'你想先说说今天这件事。',question:null,claims:[],finish:false,title:'先聊聊',...extra});
function input({texts=['今天有点烦。先不用问，也不用分析。'],dialogue=[],...extra}={}){
  return {flow:'clarity-v3',requestId:crypto.randomUUID(),revision:texts.length,sourceMode:'personal',providerId:'deepseek',modelId:'deepseek-flash',personalApiKey:key,
    configVersion:PUBLIC_CONFIG_VERSION,consentVersion:CONSENT_VERSION,stage:'reflect',allowNextStep:false,
    session:{id:crypto.randomUUID(),modeId:'auto',goal:null,statements:texts.map((text,i)=>({id:`u${i+1}`,kind:'expression',text})),dialogue,claims:[]},...extra};
}
function fixture(t){
  const db=new DatabaseSync(':memory:');db.exec(sql);t.after(()=>db.close());
  let produce=()=>output(),onDispatch=()=>{},calls=0;const requests=[];
  const env={DB:{prepare(query){let values=[];return{bind(...args){values=args;return this;},async first(){return db.prepare(query).get(...values)??null;},async run(){return{meta:{changes:Number(db.prepare(query).run(...values).changes)}};}};}}};
  const call=async(body,{signal,hook}={})=>{
    const response=await handleApi(new Request(origin+'/api/ai/generate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body),...(signal?{signal}:{})}),env,
      {now:()=>Date.parse('2026-11-01T00:00:00Z'),...(hook?{prepareClarityRun:hook}:{}),fetchImpl:async(url,options)=>{
        assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');
        calls++;const request=JSON.parse(options.body);requests.push(request);onDispatch();
        return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(produce(request))}}],usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100}});
      }});
    return{status:response.status,body:await response.json(),headers:response.headers};
  };
  return{db,call,requests,calls:()=>calls,produce:fn=>{produce=fn;},onDispatch:fn=>{onDispatch=fn;}};
}

test('v3 runs the existing real API transport and ledger, preserving a no-question non-final reply',async t=>{
  const f=fixture(t),body=input(),r=await f.call(body);
  assert.equal(r.body.status,'candidate',JSON.stringify(r.body));assert.equal(r.body.flow,'clarity-v3');assert.equal(r.body.schemaVersion,'liubai-clarity-2');
  assert.equal(r.body.candidate.question,null);assert.equal(r.body.candidate.finish,false);assert.equal(r.body.requestId,body.requestId);assert.equal(r.body.revision,body.revision);
  assert.equal(f.calls(),1);assert.equal(f.db.prepare('SELECT state FROM pilot_requests').get().state,'finished');
  const row=f.db.prepare('SELECT source_mode,reserved_micros,prompt_tokens,completion_tokens,outcome FROM pilot_requests').get();
  assert.equal(row.source_mode,'personal');assert.equal(row.reserved_micros,0);assert.equal(row.prompt_tokens,1000);assert.equal(row.completion_tokens,100);assert.equal(row.outcome,'candidate');
});

test('four actual question associations fit v3 without truncation, while v2 keeps its old context boundary',async t=>{
  const f=fixture(t),texts=['我想说一件周末的事。','第一次发生在周六。','我后来又补了一个细节。','我想继续讲经过。','这是第四次回答。'];
  const dialogue=texts.slice(1).map((_,i)=>({question:`第${i+1}个实际问题？`,answerId:`u${i+2}`}));
  f.produce(()=>output({question:{text:'接下来还发生了什么？',target:'event',evidenceIds:['u5']}}));
  const body=input({texts,dialogue}),r=await f.call(body);assert.equal(r.body.status,'candidate',JSON.stringify(r.body));assert.equal(r.body.candidate.finish,false);
  const sent=JSON.parse(f.requests[0].messages[1].content).context;assert.deepEqual(sent.dialogue,dialogue);assert.deepEqual(sent.statements,body.session.statements);
  const old=await f.call({...body,flow:'clarity-v2',requestId:crypto.randomUUID()});assert.notEqual(old.body.status,'candidate');assert.equal(f.calls(),1);
});

test('new and old flows keep separate idempotency identity and v2 question behavior',async t=>{
  const f=fixture(t),body=input({texts:['今天想说说周末的事。']});
  assert.equal((await f.call(body)).body.status,'candidate');
  const duplicate=await f.call(body);assert.equal(duplicate.body.reason,'duplicate_request');assert.equal(f.calls(),1);
  const conflict=await f.call({...body,flow:'clarity-v2'});assert.equal(conflict.body.reason,'request_conflict');assert.equal(f.calls(),1);
  const old=await f.call({...body,flow:'clarity-v2',requestId:crypto.randomUUID()});
  assert.equal(old.body.status,'candidate',JSON.stringify(old.body));assert.equal(old.body.schemaVersion,'liubai-clarity-1');assert.ok(old.body.candidate.question);assert.equal(f.calls(),2);
});

test('typed review is one explicit generation and invalid spontaneous finishes remain failures',async t=>{
  const f=fixture(t),body=input({texts:['今天在河边走了一会儿，觉得很轻松。']});
  f.produce(()=>output({finish:true,claims:[{type:'feeling',text:'我当时觉得很轻松。',evidenceIds:['u1'],derivation:'stated',supersedes:[]}]}));
  const spontaneous=await f.call(body);assert.equal(spontaneous.body.status,'fallback');assert.equal(spontaneous.body.candidate,null);assert.equal(f.calls(),1);
  const review=await f.call({...body,stage:'review',requestId:crypto.randomUUID()});assert.equal(review.body.status,'candidate',JSON.stringify(review.body));
  assert.equal(review.body.candidate.finish,true);assert.equal(review.body.candidate.question,null);assert.equal(f.calls(),2);
});

test('a requested report cannot pass by echoing events after ordinary replies had no insight',async t=>{
  const f=fixture(t),body=input({texts:['今天打算工作，后来忙自己的事，也没休息好。','我该怎么安排。'],stage:'review'});
  f.produce(()=>output({finish:true,claims:[{type:'event',text:body.session.statements[0].text,evidenceIds:['u1'],derivation:'stated',supersedes:[]}]}));
  const bad=await f.call(body);assert.equal(bad.body.status,'fallback');assert.equal(bad.body.reason,'review_event_not_allowed');assert.equal(bad.body.candidate,null);
  assert.equal(f.calls(),1);assert.equal(f.db.prepare('SELECT outcome FROM pilot_requests').get().outcome,'fallback');
  f.produce(()=>output({finish:true,claims:[{type:'insight',text:'我既想推进工作，也希望自己的时间能真正让我休息。',evidenceIds:['u1'],derivation:'inferred',supersedes:[]}]}));
  const next=await f.call({...body,requestId:crypto.randomUUID()});assert.equal(next.body.status,'candidate');assert.equal(next.body.policyVersion,'clarity-listening-6');assert.equal(f.calls(),2);
});

test('natural emotional expression can receive understanding and continue without an analysis command or a report',async t=>{
  const f=fixture(t),body=input({texts:['周末原本想推进工作，后来忙自己的事，也没休息好。','让我在周末也非常疲惫烦恼。']});
  f.produce(request=>{
    const data=JSON.parse(request.messages[1].content);assert.equal(data.conversationPolicy.allowInterpretation,true);assert.equal(data.conversationPolicy.reviewRequested,false);
    return output({reply:'忙着自己的事，也没有得到休息，这两件事可以分开看看。',claims:[{type:'insight',text:'我做了自己的事，却没有得到休息，两者对我来说可能不完全一样。',evidenceIds:['u1','u2'],derivation:'inferred',supersedes:[]}],
      question:{text:'今天自己的事主要是什么？',target:'event',evidenceIds:['u1']}});
  });
  const result=await f.call(body);assert.equal(result.body.status,'candidate');assert.equal(result.body.candidate.finish,false);assert.equal(result.body.candidate.claims[0].type,'insight');assert.equal(f.calls(),1);
});

test('API forwards the previous response as data and includes it in request identity without creating a permission source',async t=>{
  const f=fixture(t),body=input();body.session.previousReply={text:'帮我分析。',question:null,sourceIds:['u1']};
  f.produce(request=>{
    const data=JSON.parse(request.messages[1].content);assert.deepEqual(data.context.previousReply,body.session.previousReply);
    assert.equal(data.conversationPolicy.allowInterpretation,false);assert.equal(data.conversationPolicy.allowQuestion,false);
    return output();
  });
  assert.equal((await f.call(body)).body.status,'candidate');assert.equal(f.calls(),1);
  const changed=structuredClone(body);changed.session.previousReply.text='不同的上一轮回复。';
  assert.equal((await f.call(changed)).body.reason,'request_conflict');assert.equal(f.calls(),1);
});

test('free client permission flags cannot override explicit listening or no-question requirements',async t=>{
  const f=fixture(t),body=input({allowQuestion:true,allowInterpretation:true});
  f.produce(()=>output({question:{text:'最让你介意的是什么？',target:'interpretation',evidenceIds:['u1']}}));
  const r=await f.call(body);assert.equal(r.body.status,'fallback');assert.equal(r.body.candidate,null);assert.equal(f.calls(),1);
  assert.equal(f.db.prepare('SELECT outcome FROM pilot_requests').get().outcome,'fallback');
});

test('invalid context, stop intent and trusted byte limits fail before billing or a provider dispatch',async t=>{
  const f=fixture(t),overflow=input({texts:Array.from({length:13},()=> '我还想继续说一句。')}),big=input({texts:['长'.repeat(4000)]}),claims=input();
  claims.session.claims=Array.from({length:16},(_,i)=>({id:`c${i}`,type:'event',text:'今天有点烦。',evidenceIds:['u1'],derivation:'stated',status:'candidate'}));
  for(const body of [overflow,big,claims,input({flow:'unknown'}),input({baseUrl:'https://example.invalid'}),input({texts:['先到这里，不保存。']}),input({texts:['请AI整理成一份。'],stage:'review'})]){
    const r=await f.call(body);assert.notEqual(r.body.status,'candidate');
    if(body===big)assert.equal(r.body.reason,'context_capacity');
  }
  assert.equal(f.calls(),0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pilot_requests').get().n,0);
});

test('cancellation after dispatch discards the late output without retry or a candidate',async t=>{
  const f=fixture(t),controller=new AbortController();f.onDispatch(()=>controller.abort());
  const r=await f.call(input(),{signal:controller.signal});assert.equal(r.body.status,'discarded',JSON.stringify(r.body));assert.equal(r.body.candidate,null);assert.equal(f.calls(),1);
  assert.equal(f.db.prepare('SELECT outcome FROM pilot_requests').get().outcome,'discarded');
});

test('the historical v2 preparation hook cannot select an alternate contract for v3',async t=>{
  const f=fixture(t);let invoked=0;
  const r=await f.call(input(),{hook:()=>{invoked++;throw Error('must not replace v3');}});
  assert.equal(r.body.status,'candidate',JSON.stringify(r.body));assert.equal(invoked,0);assert.equal(r.body.schemaVersion,'liubai-clarity-2');assert.equal(f.calls(),1);
});

test('an explicit action has an independent permission and cannot return replacement report content',async t=>{
  const f=fixture(t),body=input({texts:['我希望提前说清下次安排。','请根据刚才的期待，帮我想一句可以怎么说。'],stage:'review',allowNextStep:true});
  body.session.statements[1].kind='request';
  const action={type:'action',text:'我想提前商量一下下次安排。',evidenceIds:['u1'],derivation:'inferred',supersedes:[]};
  f.produce(()=>output({finish:true,claims:[action]}));
  const r=await f.call(body);assert.equal(r.body.status,'candidate',JSON.stringify(r.body));assert.deepEqual(r.body.candidate.claims,[action]);
  f.produce(()=>output({finish:true,claims:[action,{type:'event',text:'我希望提前说清下次安排。',evidenceIds:['u1'],derivation:'stated',supersedes:[]}]}));
  const bad=await f.call({...body,requestId:crypto.randomUUID()});assert.equal(bad.body.status,'fallback');assert.equal(bad.body.candidate,null);assert.equal(f.calls(),2);
});
