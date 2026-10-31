import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as state from '../public/clarity-state.mjs';
import { validateClarityCandidate } from '../public/clarity-contract.mjs';
import { validateClarityResponse } from './clarity.mjs';
import { createSession, makeReview, confirmedRecord } from '../public/core.mjs';
import { inputs, c01Candidate } from './fixtures/clarity-c01.mjs';
const store = initial => { let value = initial ?? null; return { getItem: () => value, setItem: (_, next) => { value = next; } }; };
function reply(s, candidate) {
  const ticket = state.beginClarityRequest(s);
  const result = state.applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: candidate ?? c01Candidate(ticket.context) });
  assert.equal(result.ok, true, JSON.stringify(result)); return ticket;
}
function complete() { const s = state.createClaritySession(); for (const input of inputs) { state.addExpression(s, input); reply(s); } return s; }
const candidateClaim = (type, text, evidenceIds = ['u1'], supersedes = []) => ({ type, text, evidenceIds, supersedes, derivation: 'stated' });
const finished = claims => ({ modeId: 'concern', goal: '理清安排与顾虑', title: '这次想清楚的安排', reply: '经过和具体期待可以一起留下。', question: null, claims, finish: true });

test('the same finishing batch retains both its insight and its concrete need through save and read-back', () => {
  const s = state.createClaritySession(); state.addExpression(s, '我专门空出两天，又怕催促对方。我希望能确认后续安排。');
  reply(s, finished([
    candidateClaim('event', '我专门空出两天。'),
    candidateClaim('insight', '我想把安排问清楚，同时担心开口像在催促。'),
    candidateClaim('need', '我希望对方明确说下次什么时候有空。'),
  ]));
  const block = s.review.blocks.find(b => b.id === 'insight');
  assert.match(block.text, /同时担心开口像在催促/); assert.match(block.text, /下次什么时候有空/);
  assert.deepEqual(block.claimIds, s.claims.filter(c => ['insight', 'need'].includes(c.type)).map(c => c.id));
  const storage = store(), saved = state.saveClarityRecord(s, storage);
  assert.equal(saved.ok, true); assert.equal(s.callCount, 1);
  assert.deepEqual(state.readRecordEntries(storage)[0].record.review, saved.record.review);
  assert.match(state.recordText(saved.record), /像在催促/); assert.match(state.recordText(saved.record), /什么时候有空/);
});

test('a fresh finishing batch does not revive an older unsuperseded expectation in the same group', () => {
  const s = state.createClaritySession(); state.addExpression(s, '朋友取消了约定，我希望至少早点告诉我。');
  reply(s, { ...finished([candidateClaim('need', '我希望至少提前告诉我。')]), finish: false,
    question: { text: '现在更希望怎样安排？', target: 'need', evidenceIds: ['u1'] } });
  const old = s.claims[0];
  state.addExpression(s, '现在更希望对方主动提出新时间。又怕开口像在催促。');
  reply(s, finished([
    candidateClaim('event', '朋友取消了约定。'),
    candidateClaim('insight', '我想说清期待，也怕开口像在催促。', ['u2']),
    candidateClaim('need', '我更希望对方主动提出新时间。', ['u2']),
  ]));
  assert.equal(old.archived, false); // Missing supersedes is not an automatic withdrawal.
  const block = s.review.blocks.find(b => b.id === 'insight');
  assert.match(block.text, /主动提出新时间/); assert.match(block.text, /像在催促/);
  assert.doesNotMatch(block.text, /提前告诉我/); assert.ok(!block.claimIds.includes(old.id));
});

test('deduplicated visible text keeps every contributing claim ID for confirmation and editing', () => {
  const s = state.createClaritySession(); state.addExpression(s, '我想清楚了，希望对方主动给新时间。');
  reply(s, finished([
    candidateClaim('event', '我想清楚了。'),
    candidateClaim('insight', '我想清楚了：希望对方主动给新时间。'),
    candidateClaim('need', '希望对方主动给新时间。'),
  ]));
  const ids = s.claims.filter(c => ['insight', 'need'].includes(c.type)).map(c => c.id);
  const block = s.review.blocks.find(b => b.id === 'insight');
  assert.equal(block.text, '我想清楚了：希望对方主动给新时间。'); assert.deepEqual(block.claimIds, ids);
  state.editClarityBlock(s, 'insight', '我希望收到一个明确的新时间。');
  for (const claim of s.claims.filter(c => ids.includes(c.id))) {
    assert.equal(claim.status, 'edited'); assert.equal(claim.text, '我希望收到一个明确的新时间。');
  }
  assert.equal(state.saveClarityRecord(s, store()).ok, true);
  assert.ok(s.claims.filter(c => ids.includes(c.id)).every(c => c.status === 'confirmed' && c.locked));
});

test('fresh group composition keeps edited review authoritative and blocks stale saves', () => {
  const s = complete(); state.editClarityBlock(s, 'insight', '我现在只想把自己的周末安排好。');
  const edited = s.claims.find(c => c.status === 'edited'), ticket = state.beginClarityRequest(s);
  const model = finished([
    candidateClaim('event', '朋友取消了约定。'),
    candidateClaim('insight', '模型想把这段改成继续约见。', ['u1'], [edited.id]),
    candidateClaim('need', '模型仍建议向对方确认安排。', ['u1']),
  ]);
  assert.equal(state.applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: model }).ok, true);
  assert.equal(edited.archived, false); assert.equal(edited.status, 'edited');
  assert.equal(s.review.blocks.find(b => b.id === 'insight').text, '我现在只想把自己的周末安排好。');
  assert.equal(s.stale, true); assert.equal(state.saveClarityRecord(s, store()).reason, 'review_stale');
  state.acknowledgeClarityReview(s); const saved = state.saveClarityRecord(s, store());
  assert.equal(saved.ok, true); assert.match(state.recordText(saved.record), /只想把自己的周末安排好/);
  assert.doesNotMatch(state.recordText(saved.record), /模型仍建议|继续约见/);
  assert.equal(s.claims.find(c => c.type === 'need' && c.text.startsWith('模型仍')).status, 'candidate');
});

for (const all of [false, true]) test(`refused ${all ? 'all' : 'partial'} replacements preserve the corresponding confirmed visible blocks`, () => {
  const s = complete(); assert.equal(state.saveClarityRecord(s, store()).ok, true);
  const before = structuredClone(s.review);
  state.addExpression(s, '我还想再看看这些安排。');
  const ticket = state.beginClarityRequest(s), candidate = c01Candidate(ticket.context);
  candidate.claims.forEach((claim, index) => { claim.supersedes = all || index === 0 ? before.blocks[index].claimIds : []; });
  assert.equal(validateClarityCandidate(candidate, ticket.context).ok, true);
  assert.equal(state.applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate }).ok, true);
  const protectedBlocks = all ? before.blocks : before.blocks.slice(0, 1);
  for (const block of protectedBlocks) assert.deepEqual(s.review.blocks.find(b => b.id === block.id), block);
  assert.equal(s.stale, true); assert.equal(state.saveClarityRecord(s, store()).reason, 'review_stale');
  state.acknowledgeClarityReview(s); assert.equal(state.saveClarityRecord(s, store()).ok, true);
});

test('an absent finishing group does not revive an old expectation; explicit local composition stays incremental', () => {
  const s = state.createClaritySession(); state.addExpression(s, '我希望先确定安排。');
  reply(s, { ...finished([candidateClaim('need', '我希望先确定安排。')]), finish: false,
    question: { text: '还有哪些想留下的？', target: 'event', evidenceIds: ['u1'] } });
  const old = s.claims[0]; state.addExpression(s, '现在我已经不想再问了，先安排自己的周末。');
  reply(s, finished([candidateClaim('event', '现在我已经不想再问了，先安排自己的周末。', ['u2'])]));
  assert.equal(s.review.blocks.some(b => b.id === 'insight'), false);
  assert.equal(state.composeClarityReview(s, '空的完成批', []).blocks.length, 0);
  assert.equal(state.composeClarityReview(s, '显式保留工作线索').blocks.find(b => b.id === 'insight').text, old.text);
  old.status = 'stale';
  assert.equal(state.composeClarityReview(s, '不复活过期线索', []).blocks.some(b => b.id === 'insight'), false);
});

test('a grounded final correction cannot resurrect old feelings or third-party guesses through composition or saving', () => {
  const s = state.createClaritySession(); state.addExpression(s, '朋友取消了，我很失落。我总觉得她是不想见我。');
  const submit = candidate => {
    const ticket = state.beginClarityRequest(s), checked = validateClarityResponse(candidate, ticket.context);
    assert.equal(checked.ok, true, JSON.stringify(checked));
    assert.equal(state.applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: checked.candidate }).ok, true);
  };
  submit({ ...finished([candidateClaim('feeling', '我很失落。'), candidateClaim('thought', '我总觉得她是不想见我。')]), finish: false,
    question: { text: '具体发生了什么？', target: 'event', evidenceIds: ['u1'] } });
  state.addExpression(s, '不是失落，是生气。她后来已经约了新时间，我也不再猜她不想见我了。希望先记下这件事。');
  submit(finished([candidateClaim('event', '生气。\n她后来已经约了新时间，我也不再猜她不想见我了。', ['u2'])]));
  assert.equal(s.review.blocks.length, 1);
  const saved = state.saveClarityRecord(s, store()); assert.equal(saved.ok, true);
  assert.doesNotMatch(state.recordText(saved.record), /我很失落|我总觉得/);
  assert.match(state.recordText(saved.record), /生气/); assert.match(state.recordText(saved.record), /已经约了新时间/);
});

test('C01: four sends produce three linked blocks; the fifth primary action saves without a call', () => {
  const s = complete();
  assert.equal(s.callCount, 4); assert.equal(s.dialogue.length, 3); assert.equal(s.stage, 'reviewing');
  assert.deepEqual(s.review.blocks.map(b => b.label), ['你说过的', '这次分清了', '还留着的问号']);
  assert.match(s.review.blocks[1].text, /主动重约/); assert.match(s.review.blocks[2].text, /仍不知道/);
  const storage = store(), saved = state.saveClarityRecord(s, storage);
  assert.equal(saved.ok, true); assert.equal(s.stage, 'kept'); assert.equal(s.callCount, 4);
  const persisted = JSON.parse(storage.getItem())[0];
  assert.equal(persisted.formatVersion, 2); assert.equal(persisted.statements, undefined); assert.equal(persisted.claims, undefined);
  assert.equal(persisted.review.blocks[0].claimIds, undefined); assert.equal(persisted.review.blocks[0].edited, undefined);
});
test('a late response after a correction cannot overwrite new wording', () => {
  const s = state.createClaritySession(); state.addExpression(s, inputs[0]); const ticket = state.beginClarityRequest(s);
  state.reviseExpression(s, 'u1', '我是生气，不是失落。');
  assert.equal(state.applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: c01Candidate(ticket.context) }).reason, 'inactive');
  assert.equal(s.statements[0].text, '我是生气，不是失落。'); assert.equal(s.claims.length, 0);
});
test('manual edits keep authoritative wording and sources; new model text cannot replace them', () => {
  const s = complete(); state.editClarityBlock(s, 'insight', '其实我只想知道，这个周末还要不要空着。');
  assert.equal(state.wireSession(s).claims.find(c => c.status === 'edited').text, s.review.blocks[1].text);
  const edited = s.claims.find(c => c.status === 'edited');
  assert.match(s.statements.find(u => u.id === edited.evidenceIds[0]).text, /这个周末/);
  const ticket = state.beginClarityRequest(s), c = c01Candidate(ticket.context); c.claims[1].supersedes.push(edited.id);
  state.applyClarityReply(s, ticket, { flow: 'clarity-v2', requestId: ticket.requestId, revision: ticket.revision, status: 'candidate', candidate: c });
  assert.match(s.review.blocks.find(b => b.id === 'insight').text, /这个周末/); assert.equal(s.stale, true);
  assert.equal(state.saveClarityRecord(s, store()).reason, 'review_stale');
  state.acknowledgeClarityReview(s); assert.equal(state.saveClarityRecord(s, store()).ok, true);
});
test('edited upstream material invalidates a review and only visible claims can be confirmed', () => {
  const s = complete(); state.reviseExpression(s, 'u4', '现在我不想再约，只想安排自己的周末。');
  assert.equal(state.saveClarityRecord(s, store()).reason, 'review_stale');
  s.claims.push({ id: 'hidden', type: 'insight', text: '未显示的理解', status: 'stale', archived: false });
  state.acknowledgeClarityReview(s); assert.equal(s.claims.at(-1).archived, true);
  assert.equal(state.saveClarityRecord(s, store()).ok, true); assert.notEqual(s.claims.at(-1).status, 'confirmed');
});
test('remove every block, restore, and regenerate without resurrecting user removals', () => {
  const s = complete(); s.review.blocks.map(b => b.id).forEach(id => state.removeClarityBlock(s, id));
  assert.equal(state.saveClarityRecord(s, store()).reason, 'empty_review');
  state.restoreClarityBlock(s); assert.equal(s.review.blocks.length, 1);
  reply(s); assert.deepEqual(s.review.blocks.map(b => b.id), ['unknown']);
  state.restoreClarityBlock(s); state.restoreClarityBlock(s);
  assert.equal(s.review.blocks.length, 3); assert.equal(state.saveClarityRecord(s, store()).ok, true);
});
test('failed storage never reports saved; corrupt records are not overwritten', () => {
  const s = complete(); assert.equal(state.saveClarityRecord(s, { getItem: () => null, setItem: () => { throw Error('quota'); } }).reason, 'storage_failed');
  assert.equal(s.stage, 'reviewing'); assert.equal(s.dirty, true);
  const corrupt = store('{broken'); assert.equal(state.saveClarityRecord(s, corrupt).reason, 'storage_failed'); assert.equal(corrupt.getItem(), '{broken');
});
test('V1 is readable and retained verbatim; exporting excludes details and transient data by default', () => {
  const old = createSession('moment'); old.story = '周末散步。'; old.review = makeReview(old); old.confirmed = true;
  const raw = confirmedRecord(old); assert.ok(raw);
  const storage = store(JSON.stringify([raw])); const s = complete(); state.addClarityNote(s, '仅在详情中保留。');
  const { record } = state.saveClarityRecord(s, storage);
  assert.deepEqual(JSON.parse(storage.getItem())[1], raw); assert.ok(state.readClarityRecord(raw));
  assert.doesNotMatch(state.recordText(record), /仅在详情/); assert.match(state.recordText(record, { details: true }), /仅在详情/);
  const long = structuredClone(record); long.review.blocks[0].text = '长'.repeat(20000); assert.ok(state.readClarityRecord(long));
});

test('new saves stay independent when the legacy app rewrites its own records', () => {
  const old = createSession('moment'); old.story = '旧版散步记录。'; old.review = makeReview(old); old.confirmed = true;
  const oldPayload = JSON.stringify([confirmedRecord(old)]), values = new Map([['liubai.records.v1', oldPayload]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(state.readRecordEntries(storage)[0].record.id, old.id);
  const s = complete(); assert.equal(state.saveClarityRecord(s, storage).ok, true);
  assert.equal(values.get('liubai.records.v1'), oldPayload);
  assert.notEqual(state.RECORD_STORE, 'liubai.records.v1');
  storage.setItem('liubai.records.v1', '[]'); // The already-open legacy UI saves/deletes later.
  assert.deepEqual(state.readRecordEntries(storage).map(x => x.record.id), [s.id, old.id]);
  const legacyOnly = JSON.parse(storage.getItem('liubai.records.v1'));
  assert.equal(legacyOnly.length, 0);
});

test('an explicitly emptied new store never resurrects the legacy snapshot', () => {
  const old = createSession('moment'); old.story = '还在旧版的记录。'; old.review = makeReview(old); old.confirmed = true;
  const oldPayload = JSON.stringify([confirmedRecord(old)]), values = new Map([['liubai.records.v1', oldPayload]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(state.readRecordEntries(storage).length, 1);
  storage.setItem(state.RECORD_STORE, '[]');
  assert.deepEqual(state.readRecordEntries(storage), []);
  assert.equal(values.get('liubai.records.v1'), oldPayload);
});

test('new-store corruption or a failed write never overwrites legacy records', () => {
  const legacy = '[]', values = new Map([['liubai.records.v1', legacy], [state.RECORD_STORE, '{broken']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: () => { throw Error('quota'); } };
  assert.equal(state.saveClarityRecord(complete(), storage).reason, 'storage_failed');
  assert.equal(values.get(state.RECORD_STORE), '{broken');
  values.delete(state.RECORD_STORE);
  assert.equal(state.saveClarityRecord(complete(), storage).reason, 'storage_failed');
  assert.equal(values.get('liubai.records.v1'), legacy);
  assert.equal(values.has(state.RECORD_STORE), false);
});
test('new text after preview requires reconsideration; local review never invents later answers', () => {
  const s = state.createClaritySession(); state.addExpression(s, '只想把今天这一句话留住。'); state.openClarityReview(s);
  assert.equal(s.review.blocks[0].text, '只想把今天这一句话留住。'); assert.equal(s.callCount, 0);
  state.addExpression(s, '还有些不同的想法。'); assert.equal(s.stale, true);
});
test('a follow-up question cannot silently validate an old preview after new material', () => {
  const s = state.createClaritySession(); state.addExpression(s, inputs[0]); reply(s); state.openClarityReview(s);
  state.addExpression(s, inputs[1]); reply(s);
  assert.equal(s.stage, 'exploring'); assert.equal(s.stale, true);
  state.openClarityReview(s); assert.equal(state.saveClarityRecord(s, store()).reason, 'review_stale');
});
test('later feelings and thoughts cannot evict the concrete event from the report', () => {
  const s = complete();
  s.claims.push({ id: 'new_feeling', type: 'feeling', text: '不是失落，是生气。', status: 'candidate', evidenceIds: ['u3'] },
    { id: 'new_thought', type: 'thought', text: '又怕开口显得在逼对方。', status: 'candidate', evidenceIds: ['u3'] });
  const review = state.composeClarityReview(s);
  assert.match(review.blocks[0].text, /专门空出来/); assert.match(review.blocks[0].text, /是生气/); assert.match(review.blocks[0].text, /在逼对方/);
  assert.equal(review.blocks.length, 3); assert.equal(review.blocks[0].claimIds.length, 3);
});
test('an explicit expectation in response to a needs question routes the next request to review', () => {
  const s = state.createClaritySession(); state.addExpression(s, inputs[0]); reply(s);
  s.question = { text: '你希望怎样安排？', target: 'need', evidenceIds: ['u1'] };
  state.addExpression(s, inputs[3]); const ticket = state.beginClarityRequest(s);
  assert.equal(ticket.context.stage, 'review'); assert.equal(ticket.context.allowNextStep, false);
  const repeat = c01Candidate({ ...ticket.context, stage: 'reflect' });
  assert.equal(validateClarityCandidate(repeat, ticket.context).reason, 'question_not_allowed');
});
test('historical incremental C01 evidence remains readable but its incomplete final cannot silently pull old claims into a new report', () => {
  const report = JSON.parse(readFileSync(new URL('./evaluations/2026-10-31-c01.json', import.meta.url), 'utf8'));
  const s = state.createClaritySession();
  for (const call of report.calls.slice(0, 4)) {
    const context = JSON.parse(call.input.messages[1].content);
    state.addExpression(s, context.statements.at(-1).text); reply(s, JSON.parse(call.output.choices[0].message.content));
  }
  assert.equal(s.stage, 'reviewing');
  assert.equal(s.review.blocks.some(b => b.id === 'context'), false);
  assert.match(s.review.blocks.find(b => b.id === 'insight').text, /新时间/);
  assert.equal(s.review.blocks.length, 2); assert.equal(state.saveClarityRecord(s, store()).ok, true);
  assert.ok(s.claims.some(c => c.type === 'event' && /两个周六/.test(c.text)), 'The original historical material is retained, but not silently displayed as a fresh final claim');
});
test('one active request, explicit retries beyond five, and unrequested action rejection', () => {
  const s = state.createClaritySession(); state.addExpression(s, inputs[0]);
  let t = state.beginClarityRequest(s); assert.throws(() => state.beginClarityRequest(s), /request_in_progress/);
  const bad = c01Candidate(t.context); bad.claims[0].type = 'action'; assert.equal(validateClarityCandidate(bad, t.context).reason, 'action_not_allowed');
  state.failClarityRequest(s, t, 'network_error'); assert.equal(s.callCount, 1);
  for (let i = 1; i < 8; i++) { t = state.beginClarityRequest(s); state.failClarityRequest(s, t, 'network_error'); }
  assert.equal(s.callCount,8); state.openClarityReview(s); assert.equal(state.saveClarityRecord(s, store()).ok, true);
});
