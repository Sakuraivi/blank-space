import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildRetentionLedger,RETENTION_LEDGER_VERSION} from './clarity-retention-ledger.mjs';
import {CONCERN_QUESTIONS} from '../clarity-turn.mjs';

const context=(texts,extra={})=>({sessionId:'retention_synthetic',revision:texts.length,stage:'review',allowNextStep:false,modeId:'concern',goal:'理清这次表达',
  statements:texts.map((text,i)=>typeof text==='string'?{id:`u${i+1}`,kind:'expression',text}:structuredClone(text)),dialogue:[],claims:[],...extra});
const artifact=()=>JSON.parse(readFileSync(new URL('../evaluations/2026-11-01-material-set-v2.json',import.meta.url),'utf8'));
const realContext=id=>artifact().live.samples.find(sample=>sample.caseId===id).calls.at(-1).context;

test('the actual full dialogue retains every literal concern and conditional expectation',async()=>{
  const c=realContext('V2_FULL_DIALOGUE'),before=structuredClone(c),ledger=await buildRetentionLedger(c);
  assert.equal(ledger.version,RETENTION_LEDGER_VERSION);assert.equal(ledger.reportReady,true);assert.equal(ledger.retainedLength,228);
  assert.equal(ledger.units.length,8);assert.equal(ledger.units.every(u=>u.status==='active'),true);
  assert.match(ledger.retainedText,/怕拒绝以后见面尴尬/u);assert.match(ledger.retainedText,/我没空就一起找其他办法/u);
  assert.match(ledger.retainedText,/周二、周五/u);assert.match(ledger.retainedText,/各花了半小时/u);
  const links=ledger.units.filter(u=>u.sourceId==='u4').flatMap(u=>u.questionLinks);
  assert.ok(links.length);assert.ok(links.every(link=>link.target==='need'&&link.question===CONCERN_QUESTIONS.need));
  assert.deepEqual(c,before);assert.equal(ledger.semanticCoverage,'unverified');
});

test('the actual frequency example preserves yesterday exception and the stated mild feeling',async()=>{
  const ledger=await buildRetentionLedger(realContext('V2_FREQUENCY_EXCEPTION'));
  assert.equal(ledger.reportReady,true);assert.equal(ledger.retainedLength,129);
  assert.match(ledger.retainedText,/昨天那次柜号是对的/u);assert.match(ledger.retainedText,/我当时有点烦/u);
  assert.match(ledger.retainedText,/那两次我各多走了十分钟/u);
});

test('actual correction retires only old pure feeling and projects the real positive suffix',async()=>{
  const c=realContext('V2_CORRECTED_FEELING'),ledger=await buildRetentionLedger(c);
  assert.equal(ledger.reportReady,true);assert.equal(ledger.retainedLength,100);
  const old=ledger.units.find(u=>u.quote==='我很失落。'),positive=ledger.units.find(u=>u.quote==='不是失落，是生气。');
  assert.equal(old.status,'retired');assert.deepEqual(old.retiredBy,{sourceId:'u2',anchorId:positive.anchorId,from:'失落',to:'生气'});
  assert.equal(positive.status,'active');assert.equal(positive.text,'生气。');
  assert.equal(c.statements.find(s=>s.id===positive.sourceId).text.slice(positive.renderedStart,positive.renderedEnd),positive.text);
  assert.match(ledger.retainedText,/生气。/u);assert.doesNotMatch(ledger.retainedText,/失落/u);
  assert.match(ledger.retainedText,/并不是不能分享/u);assert.match(ledger.retainedText,/先征求我的同意/u);
});

test('A to B to A retires earlier spans one way and does not revive the initial A',async()=>{
  const ledger=await buildRetentionLedger(context(['我很失落。','不是失落，是生气。','不是生气，是失落。']));
  assert.equal(ledger.reportReady,true);assert.deepEqual(ledger.units.map(u=>u.status),['retired','retired','active']);
  assert.equal(ledger.retainedText,'失落。');assert.equal(ledger.activeAnchorIds.length,1);
  assert.equal(ledger.units[0].retiredBy.sourceId,'u2');assert.equal(ledger.units[1].retiredBy.sourceId,'u3');
});

test('only earlier matching pure feelings retire, never unrelated earlier material or later sources',async()=>{
  const ledger=await buildRetentionLedger(context(['我很难过。','我很失落。','不是失落，是生气。','我又失落。']));
  assert.equal(ledger.units[0].status,'active');assert.equal(ledger.units[1].status,'retired');
  assert.equal(ledger.units[2].status,'active');assert.equal(ledger.units[3].status,'active');
  // The later unsignalled feeling change remains literal material; only the
  // prepared report's grounding gate can decide whether its narrow scope fits.
  assert.match(ledger.retainedText,/我又失落/u);
});

for(const text of ['我很失落，也迟到了半小时。','我很失落，但周六已经留了一天。','我并不失落。','你很失落。','失落。','我很失落？'])
  test(`unsafe prior reference stays intact and refuses retirement: ${text}`,async()=>{
    const ledger=await buildRetentionLedger(context([text,'不是失落，是生气。']));
    assert.equal(ledger.reportReady,false);assert.ok(ledger.issues.includes('nonretirable_emotion_reference'));
    assert.equal(ledger.units[0].status,'unresolved');assert.equal(ledger.units[0].quote,text);assert.equal(ledger.units[0].text,text);
    assert.equal(ledger.units[0].retiredBy,null);assert.equal(ledger.units[1].text,'生气。');
  });

test('quoted and third-person emotions do not become the person whose own feeling was corrected',async()=>{
  const c=context(['她说：“我很失落。”她还说“教练讲『先等一等。』”。','小周很失落。','我很失落。','不是失落，是生气。']);
  const ledger=await buildRetentionLedger(c);
  assert.equal(ledger.reportReady,true);
  assert.equal(ledger.units[0].status,'active');assert.equal(ledger.units[1].status,'active');assert.equal(ledger.units[2].status,'retired');
  assert.match(ledger.retainedText,/她说：“我很失落。”/u);assert.match(ledger.retainedText,/小周很失落/u);
  // This ledger is literal only. The existing downstream compiler may still
  // conservatively refuse a quoted denied word; readiness is not its verdict.
});

test('ordinary correction kind does not identify a semantic replacement target',async()=>{
  const ledger=await buildRetentionLedger(context(['我打算周六跑步。',{id:'u2',kind:'correction',text:'我把前面改成去散步。'}]));
  assert.equal(ledger.reportReady,false);assert.ok(ledger.issues.includes('unsupported_revision_scope'));
  assert.equal(ledger.units.every(u=>u.status==='active'),true);assert.equal(ledger.units.every(u=>u.retiredBy===null),true);
  assert.match(ledger.retainedText,/跑步/u);assert.match(ledger.retainedText,/散步/u);
});

test('self-contrasting same emotion does not authorize deleting an earlier sentence',async()=>{
  const ledger=await buildRetentionLedger(context(['我很失落。','不是失落，是失落。']));
  assert.equal(ledger.reportReady,false);assert.ok(ledger.issues.includes('unsupported_emotion_correction'));
  assert.equal(ledger.units[0].status,'active');assert.equal(ledger.units[0].retiredBy,null);
});

test('request and operational controls are not report material or a hidden analysis permission',async()=>{
  const c=context(['我留了一个下午。','不要分析。',{id:'u3',kind:'request',text:'请帮我想一个行动。'}]);
  const ledger=await buildRetentionLedger(c);
  assert.equal(ledger.reportReady,false);assert.ok(ledger.issues.includes('unsupported_control_scope'));
  assert.equal(ledger.retainedText,'我留了一个下午。');assert.equal(ledger.units.length,1);
  assert.equal(ledger.sources.length,3);
});

test('mixed control material stays intact as unresolved, not spliced into an invented quote',async()=>{
  const ledger=await buildRetentionLedger(context(['今天开心，只想留住这一句，不需要分析或建议。']));
  assert.equal(ledger.reportReady,false);assert.equal(ledger.units.length,1);
  assert.equal(ledger.units[0].status,'unresolved');assert.equal(ledger.units[0].quote,'今天开心，只想留住这一句，不需要分析或建议。');
});

test('UTF16 offsets, CRLF, decimals and equal original sentences retain independent identities',async()=>{
  const c=context(['  我留了1.5小时🪴。\r\n先等等。先等等。','先等等。']);
  const ledger=await buildRetentionLedger(c);assert.equal(ledger.reportReady,true);
  assert.equal(ledger.units.length,4);assert.equal(new Set(ledger.units.map(u=>u.key)).size,4);
  for(const unit of ledger.units){const source=c.statements.find(s=>s.id===unit.sourceId);
    assert.equal(source.text.slice(unit.start,unit.end),unit.quote);assert.equal(source.text.slice(unit.renderedStart,unit.renderedEnd),unit.text);}
  assert.equal(ledger.units[0].start,2);assert.equal(ledger.units[0].quote,'我留了1.5小时🪴。');
  assert.equal(ledger.retainedText,'我留了1.5小时🪴。\n先等等。\n先等等。\n先等等。');
});

test('caller changes after the first await cannot mix context or previous material versions',async()=>{
  const initial=context(['原来的材料。']),previous=await buildRetentionLedger(initial),next=context(['原来的材料。','后来的补充。']);
  const nextBefore=structuredClone(next),pending=buildRetentionLedger(next,{previous});
  next.statements[0].text='已改写的材料。';next.revision++;
  const ledger=await pending;assert.equal(ledger.revision,2);assert.equal(ledger.retainedText,'原来的材料。\n后来的补充。');
  assert.deepEqual(ledger,await buildRetentionLedger(nextBefore,{previous}));
  assert.equal(Object.isFrozen(ledger),true);assert.equal(Object.isFrozen(ledger.units[0]),true);
  assert.throws(()=>{ledger.units[0].text='偷偷改写';},TypeError);
});

test('different lone-surrogate source strings cannot share a JSON source digest',async()=>{
  const a=await buildRetentionLedger(context(['\ud800。'])),b=await buildRetentionLedger(context(['\ud801。']));
  assert.notEqual(a.sources[0].digest,b.sources[0].digest);assert.notEqual(a.units[0].key,b.units[0].key);
});

test('append reuses exact source identities but source edits never reinsert old text or keys',async()=>{
  const previous=await buildRetentionLedger(context(['原话。']));
  const appended=await buildRetentionLedger(context(['原话。','补充。']),{previous});
  assert.equal(appended.reportReady,true);assert.deepEqual(appended.changes.unchangedKeys,[previous.units[0].key]);
  assert.equal(appended.changes.addedKeys.length,1);assert.notEqual(appended.snapshotId,previous.snapshotId);
  const changed=context(['改过的原话。'],{revision:2});
  const edited=await buildRetentionLedger(changed,{previous});
  assert.equal(edited.reportReady,false);assert.ok(edited.issues.includes('source_edit_requires_review'));
  assert.equal(edited.retainedText,'改过的原话。');assert.doesNotMatch(edited.retainedText,/^原话/u);
  assert.deepEqual(edited.changes.removedKeys,[previous.units[0].key]);assert.equal(edited.changes.unchangedKeys.length,0);
  assert.equal(edited.changes.sourceVersionChanges.length,1);
});

test('missing bootstrap history, future or foreign previous frames and reused revisions fail closed',async()=>{
  const c=context(['原话。']),previous=await buildRetentionLedger(c);
  const missing=await buildRetentionLedger({...c,revision:3});
  assert.equal(missing.reportReady,false);assert.ok(missing.issues.includes('missing_revision_history'));
  await assert.rejects(buildRetentionLedger({...c,sessionId:'other_session'},{previous}),/invalid_retention_previous/u);
  await assert.rejects(buildRetentionLedger(c,{previous:{...previous,revision:2}}),/invalid_retention_previous/u);
  await assert.rejects(buildRetentionLedger(context(['改过。']),{previous}),/retention_revision_reused/u);
  await assert.rejects(buildRetentionLedger(c,{previous:{...previous,version:'other-version'}}),/invalid_retention_previous/u);
});

test('same revision cannot silently change question associations; unknown question text is provenance only',async()=>{
  const c=context(['第一句。','第二句。'],{dialogue:[{question:CONCERN_QUESTIONS.need,answerId:'u2'}]}),previous=await buildRetentionLedger(c);
  const changed=structuredClone(c);changed.dialogue[0].question='你想说哪件事？';
  await assert.rejects(buildRetentionLedger(changed,{previous}),/retention_revision_reused/u);
  changed.revision++;
  const ledger=await buildRetentionLedger(changed,{previous});
  assert.equal(ledger.units[1].questionLinks[0].target,null);assert.equal(ledger.units[1].questionLinks[0].question,'你想说哪件事？');
  assert.equal(ledger.semanticCoverage,'unverified');assert.deepEqual(ledger.changes.unchangedKeys,previous.units.map(u=>u.key));
  assert.notEqual(ledger.snapshotId,previous.snapshotId);
});

test('removed/reordered sources do not revive former text under a source-order assumption',async()=>{
  const c=context(['甲。','乙。']),previous=await buildRetentionLedger(c);
  const removed=await buildRetentionLedger(context(['甲。'],{revision:3}),{previous});
  assert.equal(removed.reportReady,false);assert.ok(removed.issues.includes('source_removal_requires_review'));assert.equal(removed.retainedText,'甲。');
  const reordered=structuredClone(c);reordered.revision++;reordered.statements.reverse();
  const ledger=await buildRetentionLedger(reordered,{previous});assert.equal(ledger.reportReady,false);assert.ok(ledger.issues.includes('source_order_requires_review'));
  assert.equal(ledger.retainedText,'乙。\n甲。');
});

test('oversized whole active material is preserved in the ledger but not truncated into a report',async()=>{
  const text='长'.repeat(240)+'。',ledger=await buildRetentionLedger(context([text]));
  assert.equal(ledger.reportReady,false);assert.ok(ledger.issues.includes('retained_material_too_large'));
  assert.equal(ledger.retainedLength,241);assert.equal(ledger.retainedText,text);assert.equal(ledger.units[0].text,text);
});

test('model candidates are never independent literal material or a reason to resurrect old text',async()=>{
  const c=context(['我留了一个下午。']);c.claims=[{id:'old_model_claim',type:'insight',text:'我的真正需要是被重视。',evidenceIds:['u1'],derivation:'inferred',status:'stale'}];
  const ledger=await buildRetentionLedger(c);assert.equal(ledger.reportReady,true);assert.equal(ledger.retainedText,'我留了一个下午。');
  assert.doesNotMatch(ledger.retainedText,/真正需要|重视/u);assert.equal(ledger.semanticCoverage,'unverified');
});
