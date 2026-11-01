// Loopback-only r5 preview. Fixture transport never contacts a model service.
import {createServer} from 'node:http';
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {handleApi} from '../server/api.mjs';
import {encryptKey} from '../server/secrets.mjs';
import {checkClarityContext} from '../public/clarity-v3-contract.mjs';
import {deriveConversationPolicy} from '../public/clarity-v3-intent.mjs';

const root=resolve(import.meta.dirname,'..'),assets=resolve(root,'public');
const contextKeys=['sessionId','revision','stage','allowNextStep','modeId','goal','statements','dialogue','claims'];
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
export function fixtureCandidate(input){
  const c=checkClarityContext(Object.fromEntries(contextKeys.map(key=>[key,input[key]]))),p=deriveConversationPolicy(c);
  const materials=p.materials,latest=materials.at(-1);
  if(!latest)throw new TypeError('fixture_no_materials');
  const base={modeId:'concern',goal:c.goal??'先听你说',reply:'',question:null,claims:[],finish:false,title:'目前的整理'};
  if(p.actionRequested){
    const value='我想说：'+latest.text;
    if(value.length>240)throw new TypeError('fixture_material_capacity');
    return {...base,reply:'这是一句按现有原话生成的模拟表达，可以修改或先不用。',finish:true,
      claims:[{type:'action',text:value,evidenceIds:[latest.id],derivation:'inferred',supersedes:[]}]};
  }
  if(p.reviewRequested){
    const groups=[];let current={text:'',ids:[]};
    for(const source of materials){
      if(source.text.length>240)throw new TypeError('fixture_material_capacity');
      const next=current.text?current.text+'\n'+source.text:source.text;
      if(next.length>240){groups.push(current);current={text:source.text,ids:[source.id]};}
      else{current.text=next;current.ids.push(source.id);}
    }
    if(current.text)groups.push(current);
    if(groups.length>3||groups.reduce((n,g)=>n+g.text.length,0)>480)throw new TypeError('fixture_material_capacity');
    if(p.allowInterpretation)return {...base,reply:'这是模拟占位，不代表真实模型的理解。',finish:true,
      claims:[{type:'unknown',text:'这里只是检查整理交互的模拟占位，尚未获得真实模型的理解。',evidenceIds:materials.map(m=>m.id),derivation:'stated',supersedes:[]}]};
    return {...base,reply:'这是按已经说过的话生成的模拟整理，你可以改成自己的意思。',finish:true,
      claims:groups.map(g=>({type:'event',text:g.text,evidenceIds:g.ids,derivation:'stated',supersedes:[]}))};
  }
  // A literal acknowledgement is deliberately not evidence of understanding.
  const literal=latest.text.length<=110?latest.text:latest.text.slice(0,110)+'…';
  base.reply='你刚刚写下：「'+literal+'」';
  if(p.allowInterpretation&&p.allowQuestion){
    const quote=latest.text.slice(0,32);
    base.question={text:'关于「'+quote+'」这一段，你还想补充什么？',target:'unknown',evidenceIds:[latest.id]};
  }
  return base;
}
export function createClarityV3Preview({fixture=false,delayMs=150}={}){
  if(typeof fixture!=='boolean'||!Number.isInteger(delayMs)||delayMs<150||delayMs>20000)throw new TypeError('invalid_preview_options');
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(resolve(root,'drizzle')).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(resolve(root,'drizzle',file),'utf8'));
  const DB={prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){return{success:true,meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}};}};}};
  // Never copy process.env credentials, local credential files or remote D1.
  // The labelled fixture owns a separate in-memory organizer row so the old
  // environment-key pilot's shared 18-call/budget limits cannot stop a demo.
  // Both strings are deliberately public synthetic values, never real keys.
  const fixtureSecret='AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
  const env={DB,...(fixture?{LIUBAI_SECRET_KEY:fixtureSecret}:{})};
  const ready=fixture?(async()=>{
    const encrypted=await encryptKey('opaque-synthetic-preview-credential',fixtureSecret);
    sqlite.prepare(`INSERT INTO organizer_config
      (id,provider_id,model_id,pricing_mode,input_rate,output_rate,call_limit,shared_budget_micros,encrypted_key,iv,enabled,revision,updated_at_ms)
      VALUES ('main','deepseek','deepseek-flash','catalog',2,8,NULL,NULL,?,?,1,1,?)`).run(encrypted.encrypted_key,encrypted.iv,Date.parse('2026-11-01T00:00:00Z'));
  })():Promise.resolve();
  // Keep a factory created without listen() from producing an unhandled
  // rejection. listen/request handling still await and surface the failure.
  ready.catch(()=>{});
  let modelCalls=0;
  const fixtureFetch=async(_endpoint,options)=>{
    modelCalls++;
    // Deliberately complete after an abort too: the real API/Host must discard
    // late results; no synthetic future answer or follow-up call is inserted.
    await new Promise(resolve=>setTimeout(resolve,delayMs));
    try{
      const body=JSON.parse(options.body),data=JSON.parse(body.messages.find(m=>m.role==='user').content),candidate=fixtureCandidate(data.context??data);
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(candidate)}}],usage:{prompt_tokens:1000,completion_tokens:300,total_tokens:1300}});
    }catch{return Response.json({error:{code:'fixture_material_capacity_or_context'}},{status:400});}
  };
  const server=createServer(async(req,res)=>{
    const send=(status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);};
    try{
      await ready;
      if(!/^(?:127\.0\.0\.1|localhost):\d+$/u.test(req.headers.host??'')){send(400,JSON.stringify({reason:'invalid_preview_host'}));return;}
      const url=new URL(req.url,`http://${req.headers.host}`);
      if(fixture&&url.pathname==='/__fixture-count'&&req.method==='GET'){send(200,JSON.stringify({synthetic:true,modelCalls,realModelCalls:0}));return;}
      if(url.pathname.startsWith('/api/')){
        if(!['/api/ai/status','/api/ai/generate'].includes(url.pathname)){send(404,JSON.stringify({reason:'not_found'}));return;}
        const chunks=[];let bytes=0;
        for await(const chunk of req){bytes+=chunk.length;if(bytes>100000){send(413,JSON.stringify({reason:'request_too_large'}));return;}chunks.push(chunk);}
        const body=Buffer.concat(chunks);
        if(!fixture&&url.pathname==='/api/ai/generate'){
          let data;try{data=JSON.parse(body.toString());}catch{send(400,JSON.stringify({status:'fallback',reason:'invalid_request'}));return;}
          if(data.sourceMode!=='personal'){send(503,JSON.stringify({status:'fallback',reason:'default_unavailable'}));return;}
        }
        const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        const response=await handleApi(new Request(url,{method:req.method,headers:req.headers,signal:controller.signal,...(body.length?{body}:{})}),env,
          fixture?{fetchImpl:fixtureFetch,now:()=>Date.parse('2026-11-01T00:00:00Z')}:{});
        if(!res.destroyed){res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}return;
      }
      if(req.method!=='GET'){send(405,'Method not allowed','text/plain; charset=utf-8');return;}
      if(['/admin','/admin/'].includes(url.pathname)){send(200,'本地预览不连接线上共享配置。真实模型测试请在 AI 设置中填写临时个人 Key。','text/plain; charset=utf-8');return;}
      const pathname=['/','/clarity-v3','/clarity-v3/'].includes(url.pathname)?'/clarity-v3.html':decodeURIComponent(url.pathname),file=resolve(assets,`.${pathname}`);
      if(!file.startsWith(assets+sep)||!existsSync(file)||!statSync(file).isFile()||file.endsWith('.test.mjs')){send(404,'Not found','text/plain; charset=utf-8');return;}
      let data=readFileSync(file);
      if(fixture&&extname(file)==='.html')data=data.toString().replace('<body class="clarity-v3">','<body class="clarity-v3"><p class="help-note fixture-banner" role="note">模拟回复 / 未调用真实AI。回应只用于检查页面、状态和保存，不代表理解或陪伴效果。</p>');
      if(fixture&&url.searchParams.get('textSize')==='200'&&extname(file)==='.html')data=data.toString().replace('</head>','<style>:root{font-size:38px}</style></head>');
      send(200,data,mime[extname(file)]??'application/octet-stream');
    }catch{if(!res.destroyed&&!res.headersSent)send(500,'Local preview unavailable','text/plain; charset=utf-8');else if(!res.destroyed)res.end();}
  });
  server.once('close',()=>sqlite.close());
  return{server,get modelCalls(){return modelCalls;},listen(port=4195){
    if(!Number.isInteger(port)||port<0||port>65535)throw new TypeError('invalid_preview_port');
    return ready.then(()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address());});}));
  },close(){return new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);let fixture=false,delayMs=150;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--fixture')fixture=true;
    else if(args[i]==='--delay-ms'&&args[i+1])delayMs=Number(args[++i]);
    else throw new TypeError('invalid_preview_cli');
  }
  const preview=createClarityV3Preview({fixture,delayMs}),port=Number(process.env.LIUBAI_PREVIEW_PORT??4195),address=await preview.listen(port);
  process.stdout.write(`${fixture?'Labelled synthetic fixture (0 real AI calls)':'Personal-key-only preview'}: http://127.0.0.1:${address.port}/\n`);
  const stop=()=>preview.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
